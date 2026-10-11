"""Measurement computation: operator inputs -> computed schema-2.1 rows.

The renderer sends only what the operator did (kind, name, clicked pixels, per-point
target, line references, colour, note); the engine computes every value (B2). Rules:

* **2D distance / 2D curve** — the Z_ref plane (inference contract): no per-pixel depth
  enters the value (C1.8); each point's own window depth is sampled as metadata only
  (``endpoint_dz_frac`` / ``point_dz_frac``, flag ``endpoint_dz`` above 10 %);
  ``uncertainty = value · z_mad / z_median``.
* **3D distance / 3D curve** — depth per point from ``depth_for_pixel`` (contract C1 with
  the KNN fallback), pinhole back-projection; ``uncertainty = sqrt(σ_d² + Σ snap²)`` where
  the KNN snap distance is added un-projected (never below the snap); curves carry
  per-segment dz with ``segment_depth_jump`` flags and a Z_ref cross-check (C1.7).
* **Angles** — 2D angles in normalised image coordinates (u/fx, v/fy, i.e. the Z_ref plane),
  3D 3-point angles from provenance-backed points, 4-point angles between two lines of the
  same kind (``angle_3d_4point`` / ``angle_2d_4point``; a mixed pair is rejected).
* Nothing ever falls back from 3D to 2D. A rejection keeps the row with ``null`` value and
  a reason (``"p2:knn_too_far"``, ``"point_3:pixel_out_of_image"``, ``"too_few_points"``).
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from . import labels
from .constants import (
    ENDPOINT_DZ_FLAG_FRAC,
    KNN_K,
    MAX_SAFE_INT,
    SEGMENT_JUMP_ABS_M,
    SEGMENT_JUMP_FRAC,
    UNCERTAINTY_BASIS,
)
from .depthlookup import FrameContext, depth_for_pixel, pixel_index, window_stats
from .errors import Unprocessable
from .geometry import (
    Intrinsics,
    angle_3point,
    angle_between_lines,
    angle_from_horizontal_2d,
    assign_color,
    backproject_point,
    curve_length_2d,
    curve_length_3d,
    distance_2d_image_plane,
    distance_3d,
    propagate_distance_uncertainty,
)
from .maskstats import point_in_bbox
from .provenance import TARGETS, DepthProvenance
from .session_schema import (
    VIEW_ID,
    AngleMeasurement,
    CurveMeasurement,
    LineMeasurement,
    SessionDocument,
    flat_measurements,
    iso_now,
)

INPUT_KINDS: tuple[str, ...] = tuple(labels.INPUT_KINDS)
LINE_INPUTS = frozenset({"distance_2d", "distance_3d"})
CURVE_INPUTS = frozenset({"curve_2d", "curve_3d"})
ANGLE_INPUTS = frozenset(
    {"angle_2d_3point", "angle_3d_3point", "angle_2d_from_horizontal", "angle_4point"}
)
FIXED_POINT_COUNTS: dict[str, int] = {
    "distance_2d": 2,
    "distance_3d": 2,
    "angle_2d_3point": 3,
    "angle_3d_3point": 3,
    "angle_2d_from_horizontal": 2,
    "angle_4point": 0,
}
MAX_CURVE_POINTS = 500
MAX_MEASUREMENTS = 500
MAX_NAME_LEN = 200
MAX_NOTE_LEN = 2000
COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
PLANE_UNCERTAINTY_BASIS = "z_mad_over_z_median"
SIGMA_ONLY_BASIS = "sigma_d_1pct"

Row = LineMeasurement | CurveMeasurement | AngleMeasurement


# ----- operator input --------------------------------------------------------------------------


def _is_number(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _is_safe_id(x: Any) -> bool:
    """A positive integral number that survives JavaScript and SQLite (≤ 2**53 - 1)."""
    if not _is_number(x) or not math.isfinite(float(x)) or int(x) != x:
        return False
    return 1 <= int(x) <= MAX_SAFE_INT


@dataclass(frozen=True)
class MeasurementInput:
    """What the operator did; the only thing the renderer sends for a measurement."""

    id: int
    kind: str
    name: str = ""
    points: tuple[tuple[float, float], ...] = ()
    targets: tuple[str, ...] = ()
    line_a_id: int | None = None
    line_b_id: int | None = None
    color: str | None = None
    note: str = ""

    @classmethod
    def from_dict(cls, d: Any, *, index: int | None = None) -> MeasurementInput:
        if not isinstance(d, dict):
            raise Unprocessable(
                "measurement must be an object",
                code="invalid_measurement",
                details={"index": index, "problems": {"_": "not an object"}},
            )
        problems: dict[str, str] = {}
        raw_id = d.get("id")
        if not _is_safe_id(raw_id):
            problems["id"] = f"a positive integer up to {MAX_SAFE_INT} is required"
        kind = d.get("kind")
        if kind not in INPUT_KINDS:
            problems["kind"] = f"unknown kind {kind!r}; expected one of {list(INPUT_KINDS)}"
        name = d.get("name", "")
        if name is None:
            name = ""
        if not isinstance(name, str) or len(name) > MAX_NAME_LEN:
            problems["name"] = f"a string of at most {MAX_NAME_LEN} characters is required"
        points: list[tuple[float, float]] = []
        raw_points = d.get("points", [])
        if raw_points is None:
            raw_points = []
        if not isinstance(raw_points, list):
            problems["points"] = "a list of [u, v] pairs is required"
        else:
            for i, p in enumerate(raw_points):
                if (
                    not isinstance(p, (list, tuple))
                    or len(p) != 2
                    or not all(_is_number(x) and math.isfinite(float(x)) for x in p)
                ):
                    problems["points"] = f"point {i} must be two finite numbers"
                    break
                points.append((float(p[0]), float(p[1])))
        if kind in FIXED_POINT_COUNTS and "points" not in problems:
            expected = FIXED_POINT_COUNTS[kind]
            if len(points) != expected:
                problems["points"] = f"{kind} needs exactly {expected} points, got {len(points)}"
        if kind in CURVE_INPUTS and len(points) > MAX_CURVE_POINTS:
            problems["points"] = f"a curve takes at most {MAX_CURVE_POINTS} points"
        raw_targets = d.get("targets")
        targets: list[str]
        if raw_targets is None:
            targets = ["camel"] * len(points)
        elif not isinstance(raw_targets, list) or len(raw_targets) != len(points):
            targets = []
            problems["targets"] = "targets must list one of 'camel' | 'ground' per point"
        else:
            targets = [str(t) for t in raw_targets]
            bad = [t for t in targets if t not in TARGETS]
            if bad:
                problems["targets"] = f"unknown target(s) {bad}; expected 'camel' or 'ground'"
        line_a_id = d.get("line_a_id")
        line_b_id = d.get("line_b_id")
        if kind == "angle_4point":
            for key, value in (("line_a_id", line_a_id), ("line_b_id", line_b_id)):
                if not _is_safe_id(value):
                    problems[key] = "angle_4point needs two positive line ids"
            if "line_a_id" not in problems and "line_b_id" not in problems:
                if int(line_a_id) == int(line_b_id):
                    problems["line_b_id"] = "the two lines must differ"
        else:
            line_a_id = line_b_id = None
        color = d.get("color")
        if color is not None and (not isinstance(color, str) or not COLOR_RE.match(color)):
            problems["color"] = "color must be '#RRGGBB'"
        note = d.get("note", "") or ""
        if not isinstance(note, str) or len(note) > MAX_NOTE_LEN:
            problems["note"] = f"a string of at most {MAX_NOTE_LEN} characters is required"
        if problems:
            raise Unprocessable(
                f"invalid measurement at index {index}",
                code="invalid_measurement",
                details={"index": index, "id": raw_id, "problems": problems},
            )
        return cls(
            id=int(raw_id),
            kind=str(kind),
            name=name,
            points=tuple(points),
            targets=tuple(targets),
            line_a_id=int(line_a_id) if line_a_id is not None else None,
            line_b_id=int(line_b_id) if line_b_id is not None else None,
            color=color.upper() if isinstance(color, str) else None,
            note=note,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "name": self.name,
            "points": [list(p) for p in self.points],
            "targets": list(self.targets),
            "line_a_id": self.line_a_id,
            "line_b_id": self.line_b_id,
            "color": self.color,
            "note": self.note,
        }


def parse_inputs(raw: Any) -> list[MeasurementInput]:
    if not isinstance(raw, list):
        raise Unprocessable("measurements must be a list", code="invalid_measurement")
    if len(raw) > MAX_MEASUREMENTS:
        raise Unprocessable(
            f"at most {MAX_MEASUREMENTS} measurements per session",
            code="too_many_measurements",
            details={"count": len(raw)},
        )
    inputs = [MeasurementInput.from_dict(d, index=i) for i, d in enumerate(raw)]
    seen: set[int] = set()
    dup: set[int] = set()
    for m in inputs:
        (dup if m.id in seen else seen).add(m.id)
    if dup:
        raise Unprocessable(
            "measurement ids must be unique across all kinds",
            code="duplicate_measurement_ids",
            details={"ids": sorted(dup)},
        )
    return inputs


# ----- helpers -----------------------------------------------------------------------------


def _z_ref(ctx: FrameContext) -> float:
    z = ctx.z_ref.get("z_ref_m")
    if z is None or not math.isfinite(z) or z <= 0:
        raise Unprocessable(
            "the frame has no valid Z_ref",
            code="frame_no_valid_depth",
            details={"z_ref": ctx.z_ref},
        )
    return float(z)


def _plane_rel_uncertainty(ctx: FrameContext) -> float | None:
    mad = ctx.z_ref.get("z_mad_mean_abs_dev_m")
    median = ctx.z_ref.get("z_median_m")
    if mad is None or median is None or median <= 0:
        return None
    return float(mad) / float(median)


def _in_image(ctx: FrameContext, u: float, v: float) -> bool:
    ui, vi = pixel_index(u, v)
    return 0 <= ui < ctx.width and 0 <= vi < ctx.height


def plane_metadata(ctx: FrameContext, u: float, v: float, target: str) -> DepthProvenance:
    """2D rows only: the point's own window depth as metadata (never KNN, never the value)."""
    if not _in_image(ctx, u, v):
        return DepthProvenance.rejected(
            "pixel_out_of_image", target=target, inside_depth_bbox=False
        )
    ui, vi = pixel_index(u, v)
    ws = window_stats(ctx, ui, vi)
    direct = ws["window_median_m"] if ws["direct_valid"] else None
    return DepthProvenance(
        source=None,
        depth_m=None,
        target=target,
        inside_mask=ws["inside_mask"],
        inside_depth_bbox=point_in_bbox(ui, vi, ctx.depth_valid_bbox),
        window_n_total=ws["window_n_total"],
        window_n_valid=ws["window_n_valid"],
        window_n_in_mask=ws["window_n_in_mask"],
        window_restricted_to_mask=ws["window_restricted_to_mask"],
        window_median_m=ws["window_median_m"],
        window_spread_m=ws["window_spread_m"],
        k_requested=KNN_K,
        k_used=0,
        direct_depth_m=direct,
        flags=[],
        reason="",
    )


def _dz_frac(depth: float | None, z_ref: float) -> float | None:
    if depth is None:
        return None
    return abs(float(depth) - z_ref) / z_ref


def _norm(p: Sequence[float], K: Intrinsics) -> tuple[float, float]:
    """Normalised image coordinates: angles in the Z_ref plane, independent of fx != fy."""
    return (float(p[0]) / K.fx, float(p[1]) / K.fy)


def _union(lists: Iterable[Iterable[str]]) -> list[str]:
    out: list[str] = []
    for items in lists:
        for item in items:
            if item not in out:
                out.append(item)
    return out


def _snap_terms(provs: Iterable[DepthProvenance]) -> list[float]:
    return [
        float(p.nn_dist_m_max) for p in provs if p.ok and p.is_knn and p.nn_dist_m_max is not None
    ]


def _point_reasons(labels_: Sequence[str], provs: Sequence[DepthProvenance]) -> list[str]:
    return [f"{lab}:{p.reason}" for lab, p in zip(labels_, provs, strict=True) if p.reason]


# ----- per kind ----------------------------------------------------------------------------


def _distance_2d(inp: MeasurementInput, ctx: FrameContext, **row_kw: Any) -> LineMeasurement:
    z = _z_ref(ctx)
    (u1, v1), (u2, v2) = inp.points
    metas = [
        plane_metadata(ctx, u, v, t) for (u, v), t in zip(inp.points, inp.targets, strict=True)
    ]
    row = LineMeasurement(
        p1_px=(u1, v1),
        p2_px=(u2, v2),
        measurement_type="distance_2d",
        z_constant_m=z,
        p1_depth=metas[0],
        p2_depth=metas[1],
        uncertainty_basis=PLANE_UNCERTAINTY_BASIS,
        **row_kw,
    )
    reasons = _point_reasons(("p1", "p2"), metas)
    if reasons:
        row.rejection_reason = " / ".join(reasons)
        return row
    distance = distance_2d_image_plane((u1, v1), (u2, v2), ctx.intrinsics, z_constant_m=z)
    rel = _plane_rel_uncertainty(ctx)
    row.distance_m = distance
    row.uncertainty_m = distance * rel if rel is not None else None
    dz = [_dz_frac(m.direct_depth_m, z) for m in metas]
    row.endpoint_dz_frac = dz
    row.flags = (
        ["endpoint_dz"] if any(x is not None and x > ENDPOINT_DZ_FLAG_FRAC for x in dz) else []
    )
    row.confidence = "low" if row.flags else "high"
    return row


def _distance_3d(inp: MeasurementInput, ctx: FrameContext, **row_kw: Any) -> LineMeasurement:
    K = ctx.intrinsics
    provs = [
        depth_for_pixel(u, v, ctx, target=t)
        for (u, v), t in zip(inp.points, inp.targets, strict=True)
    ]
    pts = [
        backproject_point(u, v, p.depth_m, K) if p.ok else None
        for (u, v), p in zip(inp.points, provs, strict=True)
    ]
    row = LineMeasurement(
        p1_px=inp.points[0],
        p2_px=inp.points[1],
        p1_3d=pts[0],
        p2_3d=pts[1],
        measurement_type="distance_3d",
        p1_depth=provs[0],
        p2_depth=provs[1],
        flags=_union(p.flags for p in provs),
        n_points_knn=sum(1 for p in provs if p.ok and p.is_knn),
        **row_kw,
    )
    reasons = _point_reasons(("p1", "p2"), provs)
    if reasons:
        row.rejection_reason = " / ".join(reasons)
        return row
    distance = distance_3d(pts[0], pts[1])  # type: ignore[arg-type]
    sigma = propagate_distance_uncertainty(pts[0], pts[1], provs[0].depth_m, provs[1].depth_m)  # type: ignore[arg-type]
    snaps = _snap_terms(provs)
    sigma2 = sigma * sigma if math.isfinite(sigma) else 0.0
    row.distance_m = distance
    row.uncertainty_m = math.sqrt(sigma2 + sum(s * s for s in snaps))
    row.uncertainty_basis = UNCERTAINTY_BASIS if snaps else SIGMA_ONLY_BASIS
    row.confidence = "low" if any(p.low_confidence for p in provs) else "high"
    return row


def _curve_2d(inp: MeasurementInput, ctx: FrameContext, **row_kw: Any) -> CurveMeasurement:
    z = _z_ref(ctx)
    metas = [
        plane_metadata(ctx, u, v, t) for (u, v), t in zip(inp.points, inp.targets, strict=True)
    ]
    row = CurveMeasurement(
        points_px=list(inp.points),
        measurement_type="curve_2d",
        z_constant_m=z,
        point_depth=metas,
        n_points=len(inp.points),
        uncertainty_basis=PLANE_UNCERTAINTY_BASIS,
        **row_kw,
    )
    if len(inp.points) < 2:
        row.rejection_reason = "too_few_points"
        return row
    reasons = _point_reasons([f"point_{i + 1}" for i in range(len(metas))], metas)
    if reasons:
        row.rejection_reason = " / ".join(reasons)
        return row
    total, segments = curve_length_2d(list(inp.points), ctx.intrinsics, z)
    rel = _plane_rel_uncertainty(ctx)
    row.total_length_m = total
    row.segment_lengths_m = segments
    row.uncertainty_m = total * rel if rel is not None else None
    row.point_dz_frac = [_dz_frac(m.direct_depth_m, z) for m in metas]
    row.flags = (
        ["endpoint_dz"]
        if any(x is not None and x > ENDPOINT_DZ_FLAG_FRAC for x in row.point_dz_frac)
        else []
    )
    row.confidence = "low" if row.flags else "high"
    return row


def _curve_3d(inp: MeasurementInput, ctx: FrameContext, **row_kw: Any) -> CurveMeasurement:
    K = ctx.intrinsics
    provs = [
        depth_for_pixel(u, v, ctx, target=t)
        for (u, v), t in zip(inp.points, inp.targets, strict=True)
    ]
    pts = [
        backproject_point(u, v, p.depth_m, K) if p.ok else None
        for (u, v), p in zip(inp.points, provs, strict=True)
    ]
    row = CurveMeasurement(
        points_px=list(inp.points),
        measurement_type="curve_3d",
        z_constant_m=None,
        points_3d=pts,
        point_depth=provs,
        n_points=len(inp.points),
        n_direct=sum(1 for p in provs if p.ok and not p.is_knn),
        n_knn=sum(1 for p in provs if p.ok and p.is_knn),
        flags=_union(p.flags for p in provs),
        **row_kw,
    )
    if len(inp.points) < 2:
        row.rejection_reason = "too_few_points"
        return row
    reasons = _point_reasons([f"point_{i + 1}" for i in range(len(provs))], provs)
    if reasons:
        row.rejection_reason = " / ".join(reasons)
        return row
    points_3d = [p for p in pts if p is not None]
    total, segments = curve_length_3d(points_3d)
    dz = [points_3d[i + 1][2] - points_3d[i][2] for i in range(len(points_3d) - 1)]
    segment_flags = [
        ["segment_depth_jump"]
        if abs(dz[i]) > max(SEGMENT_JUMP_ABS_M, SEGMENT_JUMP_FRAC * segments[i])
        else []
        for i in range(len(segments))
    ]
    sigma2 = 0.0
    for i in range(len(points_3d) - 1):
        s = propagate_distance_uncertainty(
            points_3d[i],
            points_3d[i + 1],
            provs[i].depth_m,
            provs[i + 1].depth_m,  # type: ignore[arg-type]
        )
        if math.isfinite(s):
            sigma2 += s * s
    snaps = _snap_terms(provs)
    cross, _ = curve_length_2d(list(inp.points), K, _z_ref(ctx))
    n_flagged = sum(1 for f in segment_flags if f)
    row.total_length_m = total
    row.segment_lengths_m = segments
    row.segment_dz_m = dz
    row.segment_flags = segment_flags
    row.cross_check_2d_m = cross
    row.uncertainty_m = math.sqrt(sigma2 + sum(s * s for s in snaps))
    row.uncertainty_basis = UNCERTAINTY_BASIS if snaps else SIGMA_ONLY_BASIS
    row.n_flagged = n_flagged
    if n_flagged:
        row.flags = _union([row.flags, ["segment_depth_jump"]])
    row.confidence = "low" if n_flagged or any(p.low_confidence for p in provs) else "high"
    return row


def _angle_2d_3point(inp: MeasurementInput, ctx: FrameContext, **row_kw: Any) -> AngleMeasurement:
    vertex, a, b = inp.points
    row = AngleMeasurement(
        measurement_type="angle_2d_3point",
        view=VIEW_ID,
        vertex_px=vertex,
        endpoint_a_px=a,
        endpoint_b_px=b,
        **row_kw,
    )
    reasons = [
        f"{lab}:pixel_out_of_image"
        for lab, p in zip(("vertex", "a", "b"), inp.points, strict=True)
        if not _in_image(ctx, *p)
    ]
    if reasons:
        row.rejection_reason = " / ".join(reasons)
        return row
    K = ctx.intrinsics
    theta = angle_3point(_norm(vertex, K), _norm(a, K), _norm(b, K))
    if not math.isfinite(theta):
        row.rejection_reason = "degenerate_ray"
        return row
    row.angle_deg = theta
    row.confidence = "high"
    return row


def _angle_3d_3point(inp: MeasurementInput, ctx: FrameContext, **row_kw: Any) -> AngleMeasurement:
    K = ctx.intrinsics
    provs = [
        depth_for_pixel(u, v, ctx, target=t)
        for (u, v), t in zip(inp.points, inp.targets, strict=True)
    ]
    pts = [
        backproject_point(u, v, p.depth_m, K) if p.ok else None
        for (u, v), p in zip(inp.points, provs, strict=True)
    ]
    vertex, a, b = inp.points
    row = AngleMeasurement(
        measurement_type="angle_3d_3point",
        view=VIEW_ID,
        vertex_px=vertex,
        endpoint_a_px=a,
        endpoint_b_px=b,
        vertex_3d=pts[0],
        endpoint_a_3d=pts[1],
        endpoint_b_3d=pts[2],
        vertex_depth=provs[0],
        endpoint_a_depth=provs[1],
        endpoint_b_depth=provs[2],
        flags=_union(p.flags for p in provs),
        **row_kw,
    )
    reasons = _point_reasons(("vertex", "a", "b"), provs)
    if reasons:
        row.rejection_reason = " / ".join(reasons)
        return row
    theta = angle_3point(pts[0], pts[1], pts[2])  # type: ignore[arg-type]
    if not math.isfinite(theta):
        row.rejection_reason = "degenerate_ray"
        return row
    row.angle_deg = theta
    row.confidence = "low" if any(p.low_confidence for p in provs) else "high"
    return row


def _angle_from_horizontal(
    inp: MeasurementInput, ctx: FrameContext, **row_kw: Any
) -> AngleMeasurement:
    p1, p2 = inp.points
    row = AngleMeasurement(
        measurement_type="angle_2d_from_horizontal",
        view=VIEW_ID,
        endpoint_a_px=p1,
        endpoint_b_px=p2,
        **row_kw,
    )
    reasons = [
        f"{lab}:pixel_out_of_image"
        for lab, p in zip(("p1", "p2"), inp.points, strict=True)
        if not _in_image(ctx, *p)
    ]
    if reasons:
        row.rejection_reason = " / ".join(reasons)
        return row
    K = ctx.intrinsics
    theta = angle_from_horizontal_2d(_norm(p1, K), _norm(p2, K))
    if not math.isfinite(theta):
        row.rejection_reason = "zero_length"
        return row
    row.angle_deg = theta
    row.confidence = "high"
    return row


def _angle_4point(
    inp: MeasurementInput,
    ctx: FrameContext,
    *,
    lines_by_id: dict[int, LineMeasurement],
    **row_kw: Any,
) -> AngleMeasurement:
    row = AngleMeasurement(
        line_a_id=inp.line_a_id,
        line_b_id=inp.line_b_id,
        measurement_type="angle_3d_4point",
        view=VIEW_ID,
        **row_kw,
    )
    la = lines_by_id.get(inp.line_a_id or -1)
    lb = lines_by_id.get(inp.line_b_id or -1)
    if la is None or lb is None:
        row.rejection_reason = "line_not_found"
        return row
    kinds = {la.measurement_type, lb.measurement_type}
    if len(kinds) > 1:
        row.rejection_reason = "mixed_line_kinds"
        return row
    if kinds == {"distance_2d"}:
        row.measurement_type = "angle_2d_4point"
    if not la.is_valid or not lb.is_valid:
        row.rejection_reason = "referenced_line_invalid"
        return row
    if row.measurement_type == "angle_3d_4point":
        theta = angle_between_lines(la.p1_3d, la.p2_3d, lb.p1_3d, lb.p2_3d)  # type: ignore[arg-type]
        row.flags = _union([la.flags, lb.flags])
        row.confidence = "low" if "low" in (la.confidence, lb.confidence) else "high"
    else:
        K = ctx.intrinsics
        theta = angle_between_lines(
            _norm(la.p1_px, K), _norm(la.p2_px, K), _norm(lb.p1_px, K), _norm(lb.p2_px, K)
        )
        row.confidence = "high"
    if not math.isfinite(theta):
        row.rejection_reason = "degenerate_lines"
        row.confidence = None
        return row
    row.angle_deg = theta
    return row


_BUILDERS = {
    "distance_2d": _distance_2d,
    "distance_3d": _distance_3d,
    "curve_2d": _curve_2d,
    "curve_3d": _curve_3d,
    "angle_2d_3point": _angle_2d_3point,
    "angle_3d_3point": _angle_3d_3point,
    "angle_2d_from_horizontal": _angle_from_horizontal,
}


def compute_row(
    inp: MeasurementInput,
    ctx: FrameContext,
    *,
    order: int,
    created_at: str | None = None,
    lines_by_id: dict[int, LineMeasurement] | None = None,
) -> Row:
    """One operator input -> one computed row (never raises for a measurement problem)."""
    common: dict[str, Any] = {
        "id": inp.id,
        "name": inp.name,
        "order": order,
        "display_color": inp.color or assign_color(order),
        "note": inp.note,
        "targets": list(inp.targets),
        "created_at": created_at or iso_now(),
    }
    if inp.kind == "angle_4point":
        return _angle_4point(inp, ctx, lines_by_id=lines_by_id or {}, **common)
    if inp.kind in LINE_INPUTS or inp.kind in CURVE_INPUTS:
        common["view"] = VIEW_ID
    return _BUILDERS[inp.kind](inp, ctx, **common)


def input_kind_of(measurement_type: str) -> str:
    return (
        "angle_4point"
        if measurement_type in ("angle_3d_4point", "angle_2d_4point")
        else measurement_type
    )


def compute_rows(
    ctx: FrameContext,
    inputs: Sequence[MeasurementInput],
    *,
    previous: dict[int, tuple[str, str]] | None = None,
) -> tuple[list[LineMeasurement], list[AngleMeasurement], list[CurveMeasurement]]:
    """All inputs -> rows; lines first so 4-point angles can reference any line (B2)."""
    previous = previous or {}

    def created(inp: MeasurementInput) -> str | None:
        prev = previous.get(inp.id)
        return prev[1] if prev is not None and prev[0] == inp.kind else None

    lines: list[LineMeasurement] = []
    curves: list[CurveMeasurement] = []
    angles: list[AngleMeasurement] = []
    for order, inp in enumerate(inputs):
        if inp.kind in LINE_INPUTS:
            row = compute_row(inp, ctx, order=order, created_at=created(inp))
            assert isinstance(row, LineMeasurement)
            lines.append(row)
    lines_by_id = {line.id: line for line in lines}
    for order, inp in enumerate(inputs):
        if inp.kind in CURVE_INPUTS:
            row = compute_row(inp, ctx, order=order, created_at=created(inp))
            assert isinstance(row, CurveMeasurement)
            curves.append(row)
        elif inp.kind in ANGLE_INPUTS:
            row = compute_row(
                inp, ctx, order=order, created_at=created(inp), lines_by_id=lines_by_id
            )
            assert isinstance(row, AngleMeasurement)
            angles.append(row)
    return lines, angles, curves


def previous_created(doc: SessionDocument) -> dict[int, tuple[str, str]]:
    return {
        int(r["id"]): (input_kind_of(r["measurement_type"]), str(r["created_at"]))
        for r in flat_measurements(doc)
    }


def apply_inputs(
    doc: SessionDocument,
    ctx: FrameContext,
    inputs: Sequence[MeasurementInput],
    *,
    next_measurement_id: int | None = None,
) -> SessionDocument:
    """Recompute every row of ``doc`` from ``inputs`` (deterministic; created_at kept)."""
    lines, angles, curves = compute_rows(ctx, inputs, previous=previous_created(doc))
    doc.lines, doc.angles, doc.curves = lines, angles, curves
    max_id = max((m.id for m in inputs), default=0)
    # never goes backwards: a deleted id is never handed out again
    doc.next_measurement_id = min(
        MAX_SAFE_INT,
        max(int(doc.next_measurement_id or 1), int(next_measurement_id or 1), max_id + 1, 1),
    )
    return doc


# ----- views for the API / report -----------------------------------------------------------


def row_to_input(row: dict[str, Any]) -> dict[str, Any]:
    """The exact input that reproduces a stored row (what the Redux store edits)."""
    kind = input_kind_of(row["measurement_type"])
    family = row.get("family")
    if family == "lines":
        points = [row["p1_px"], row["p2_px"]]
    elif family == "curves":
        points = list(row["points_px"])
    elif kind in ("angle_2d_3point", "angle_3d_3point"):
        points = [row["vertex_px"], row["endpoint_a_px"], row["endpoint_b_px"]]
    elif kind == "angle_2d_from_horizontal":
        points = [row["endpoint_a_px"], row["endpoint_b_px"]]
    else:
        points = []
    targets = list(row.get("targets") or [])
    if len(targets) != len(points):
        targets = ["camel"] * len(points)
    return {
        "id": int(row["id"]),
        "kind": kind,
        "name": row.get("name") or "",
        "points": [list(p) for p in points],
        "targets": targets,
        "line_a_id": row.get("line_a_id"),
        "line_b_id": row.get("line_b_id"),
        "color": row.get("display_color") or None,
        "note": row.get("note") or "",
    }


def present_rows(doc: SessionDocument) -> list[dict[str, Any]]:
    """Flat ordered rows with ``kind``, ``family``, ``input_kind``, ``input`` and the
    bilingual ``presentation`` block (B16)."""
    z_ref = doc.frame_metadata.get("z_ref", {}).get("z_ref_m")
    out: list[dict[str, Any]] = []
    for row in flat_measurements(doc):
        row["input_kind"] = input_kind_of(row["measurement_type"])
        row["input"] = row_to_input(row)
        row["presentation"] = labels.describe_row(row, z_ref_m=z_ref)
        out.append(row)
    return out


def present_row(row: Row, *, family: str, z_ref_m: float | None) -> dict[str, Any]:
    d = row.to_dict()
    d["kind"] = row.measurement_type
    d["family"] = family
    d["input_kind"] = input_kind_of(row.measurement_type)
    d["input"] = row_to_input(d)
    d["presentation"] = labels.describe_row(d, z_ref_m=z_ref_m)
    return d


def family_of_row(row: Row) -> str:
    if isinstance(row, LineMeasurement):
        return "lines"
    if isinstance(row, CurveMeasurement):
        return "curves"
    return "angles"


def summarize(doc: SessionDocument) -> dict[str, Any]:
    """Counts for the History row, the overlay footer and the report ("N of M snapped")."""
    rows = [*doc.lines, *doc.angles, *doc.curves]
    n_points = 0
    n_knn = 0
    for line in doc.lines:
        if line.measurement_type == "distance_3d":
            for p in (line.p1_depth, line.p2_depth):
                if p is not None and p.ok:
                    n_points += 1
                    n_knn += int(p.is_knn)
    for curve in doc.curves:
        if curve.measurement_type == "curve_3d":
            for p in curve.point_depth:
                if p.ok:
                    n_points += 1
                    n_knn += int(p.is_knn)
    for angle in doc.angles:
        if angle.measurement_type == "angle_3d_3point":
            for p in (angle.vertex_depth, angle.endpoint_a_depth, angle.endpoint_b_depth):
                if p is not None and p.ok:
                    n_points += 1
                    n_knn += int(p.is_knn)
    return {
        "n_measurements": len(rows),
        "n_rejected": sum(1 for r in rows if r.rejection_reason),
        "n_low_confidence": sum(1 for r in rows if r.confidence == "low"),
        "n_points": n_points,
        "n_points_knn": n_knn,
        "snapped_text": labels.snapped_summary(n_knn, n_points),
    }
