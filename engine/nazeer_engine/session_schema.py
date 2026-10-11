"""``session.json`` schema 2.1 (contract C3.6, decisions B3, B20).

The parent's containers and field names are kept (``schema_version``, ``session_id``,
``camel_id``, ``library_versions``, ``views``, ``view_metadata``, ``lines``, ``angles``,
``curves``; the parent row fields keep their names) so the parent can *read* a 2.1 file.
Everything the engine adds (status, revision, outputs, per-point provenance, curve_3d,
flags, confidence, ...) is listed in both ``to_dict`` and ``from_dict`` of its class; a
round-trip test iterates ``dataclasses.fields`` so no field can be dropped silently.

The engine refuses any file whose ``schema_version`` is not ``"2.1"`` (B20).
"""

from __future__ import annotations

import hashlib
import re
import secrets
from dataclasses import dataclass, field, fields
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import jsonsafe
from .constants import CONSTANTS_STAMP, ENGINE_VERSION, SESSION_SCHEMA_VERSION
from .errors import CorruptFileError, UnsupportedSchemaVersion
from .fsio import read_json, write_json
from .provenance import DepthProvenance

VIEW_ID = "frame"  # B3: one view inside the parent-compatible containers
STATUSES: tuple[str, ...] = ("open", "finalized", "exported")
LINE_TYPES: tuple[str, ...] = ("distance_2d", "distance_3d")
CURVE_TYPES: tuple[str, ...] = ("curve_2d", "curve_3d")
ANGLE_TYPES: tuple[str, ...] = (
    "angle_3d_4point",
    "angle_2d_4point",
    "angle_2d_3point",
    "angle_3d_3point",
    "angle_2d_from_horizontal",
)
ALL_MEASUREMENT_TYPES: tuple[str, ...] = LINE_TYPES + CURVE_TYPES + ANGLE_TYPES
CONFIDENCES: tuple[str | None, ...] = ("high", "low", None)
SESSION_ID_RE = re.compile(r"^\d{8}_\d{6}_[0-9a-f]{6}$")
LANGUAGES: tuple[str, ...] = ("ar", "en", "both")
RUBRIC_VARIANTS: tuple[str, ...] = ("mjaheem", "maghateer")


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def new_session_id(now: datetime | None = None) -> str:
    """``YYYYmmdd_HHMMSS_<6 hex>`` (sortable, ASCII, collision-safe within a second)."""
    stamp = (now or datetime.now(UTC)).strftime("%Y%m%d_%H%M%S")
    return f"{stamp}_{secrets.token_hex(3)}"


# ----- (de)serialisation helpers -----------------------------------------------------------


def _opt_tuple(value: Any, n: int) -> tuple[float, ...] | None:
    if value is None or (isinstance(value, list | tuple) and len(value) == 0):
        return None
    out = tuple(float(x) for x in value)
    if len(out) != n:
        raise ValueError(f"expected {n} coordinates, got {len(out)}")
    return out


def _list_of_tuples(value: Any, n: int) -> list[tuple[float, ...]]:
    return [tuple(float(x) for x in p)[:n] for p in (value or [])]


def _list_of_opt_tuples(value: Any, n: int) -> list[tuple[float, ...] | None]:
    return [_opt_tuple(p, n) for p in (value or [])]


def _opt_prov(value: Any) -> DepthProvenance | None:
    if value is None:
        return None
    if isinstance(value, DepthProvenance):
        return value
    return DepthProvenance.from_dict(value)


def _prov_dict(value: DepthProvenance | None) -> dict[str, Any] | None:
    return value.to_dict() if value is not None else None


def _opt_float(value: Any) -> float | None:
    return None if value is None else float(value)


def _opt_float_list(value: Any) -> list[float | None]:
    return [None if x is None else float(x) for x in (value or [])]


def _str_list(value: Any) -> list[str]:
    return [str(x) for x in (value or [])]


# ----- rows --------------------------------------------------------------------------------


@dataclass
class LineMeasurement:
    """``distance_2d`` (Z_ref plane, no per-pixel depth) or ``distance_3d`` (two provenance
    records, back-projected endpoints)."""

    id: int
    view: str
    name: str
    p1_px: tuple[float, float]
    p2_px: tuple[float, float]
    p1_3d: tuple[float, float, float] | None = None
    p2_3d: tuple[float, float, float] | None = None
    distance_m: float | None = None
    uncertainty_m: float | None = None
    rejection_reason: str = ""
    created_at: str = field(default_factory=iso_now)
    measurement_type: str = "distance_3d"
    z_constant_m: float | None = None
    # --- 2.1 additions ---
    order: int = 0
    display_color: str = ""
    note: str = ""
    targets: list[str] = field(default_factory=lambda: ["camel", "camel"])
    p1_depth: DepthProvenance | None = None
    p2_depth: DepthProvenance | None = None
    endpoint_dz_frac: list[float | None] | None = None
    flags: list[str] = field(default_factory=list)
    confidence: str | None = None
    n_points_knn: int = 0
    uncertainty_basis: str | None = None

    @property
    def is_valid(self) -> bool:
        return self.distance_m is not None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "view": self.view,
            "name": self.name,
            "p1_px": list(self.p1_px),
            "p2_px": list(self.p2_px),
            "p1_3d": list(self.p1_3d) if self.p1_3d is not None else None,
            "p2_3d": list(self.p2_3d) if self.p2_3d is not None else None,
            "distance_m": self.distance_m,
            "uncertainty_m": self.uncertainty_m,
            "rejection_reason": self.rejection_reason,
            "created_at": self.created_at,
            "measurement_type": self.measurement_type,
            "z_constant_m": self.z_constant_m,
            "order": self.order,
            "display_color": self.display_color,
            "note": self.note,
            "targets": list(self.targets),
            "p1_depth": _prov_dict(self.p1_depth),
            "p2_depth": _prov_dict(self.p2_depth),
            "endpoint_dz_frac": (
                list(self.endpoint_dz_frac) if self.endpoint_dz_frac is not None else None
            ),
            "flags": list(self.flags),
            "confidence": self.confidence,
            "n_points_knn": self.n_points_knn,
            "uncertainty_basis": self.uncertainty_basis,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> LineMeasurement:
        return cls(
            id=int(d["id"]),
            view=str(d.get("view", VIEW_ID)),
            name=str(d.get("name", "")),
            p1_px=_opt_tuple(d["p1_px"], 2) or (0.0, 0.0),
            p2_px=_opt_tuple(d["p2_px"], 2) or (0.0, 0.0),
            p1_3d=_opt_tuple(d.get("p1_3d"), 3),
            p2_3d=_opt_tuple(d.get("p2_3d"), 3),
            distance_m=_opt_float(d.get("distance_m")),
            uncertainty_m=_opt_float(d.get("uncertainty_m")),
            rejection_reason=str(d.get("rejection_reason") or ""),
            created_at=str(d.get("created_at") or iso_now()),
            measurement_type=str(d.get("measurement_type", "distance_3d")),
            z_constant_m=_opt_float(d.get("z_constant_m")),
            order=int(d.get("order", 0)),
            display_color=str(d.get("display_color") or ""),
            note=str(d.get("note") or ""),
            targets=_str_list(d.get("targets")) or ["camel", "camel"],
            p1_depth=_opt_prov(d.get("p1_depth")),
            p2_depth=_opt_prov(d.get("p2_depth")),
            endpoint_dz_frac=(
                _opt_float_list(d["endpoint_dz_frac"])
                if d.get("endpoint_dz_frac") is not None
                else None
            ),
            flags=_str_list(d.get("flags")),
            confidence=(str(d["confidence"]) if d.get("confidence") is not None else None),
            n_points_knn=int(d.get("n_points_knn", 0)),
            uncertainty_basis=(
                str(d["uncertainty_basis"]) if d.get("uncertainty_basis") is not None else None
            ),
        )


@dataclass
class AngleMeasurement:
    id: int
    name: str
    line_a_id: int | None = None
    line_b_id: int | None = None
    angle_deg: float | None = None
    rejection_reason: str = ""
    created_at: str = field(default_factory=iso_now)
    measurement_type: str = "angle_3d_4point"
    view: str = ""
    vertex_px: tuple[float, float] | None = None
    endpoint_a_px: tuple[float, float] | None = None
    endpoint_b_px: tuple[float, float] | None = None
    vertex_3d: tuple[float, float, float] | None = None
    endpoint_a_3d: tuple[float, float, float] | None = None
    endpoint_b_3d: tuple[float, float, float] | None = None
    # --- 2.1 additions ---
    order: int = 0
    display_color: str = ""
    note: str = ""
    targets: list[str] = field(default_factory=list)
    vertex_depth: DepthProvenance | None = None
    endpoint_a_depth: DepthProvenance | None = None
    endpoint_b_depth: DepthProvenance | None = None
    flags: list[str] = field(default_factory=list)
    confidence: str | None = None

    @property
    def is_valid(self) -> bool:
        return self.angle_deg is not None

    def to_dict(self) -> dict[str, Any]:
        def _l(v: tuple[float, ...] | None) -> list[float] | None:
            return list(v) if v is not None else None

        return {
            "id": self.id,
            "name": self.name,
            "line_a_id": self.line_a_id,
            "line_b_id": self.line_b_id,
            "angle_deg": self.angle_deg,
            "rejection_reason": self.rejection_reason,
            "created_at": self.created_at,
            "measurement_type": self.measurement_type,
            "view": self.view,
            "vertex_px": _l(self.vertex_px),
            "endpoint_a_px": _l(self.endpoint_a_px),
            "endpoint_b_px": _l(self.endpoint_b_px),
            "vertex_3d": _l(self.vertex_3d),
            "endpoint_a_3d": _l(self.endpoint_a_3d),
            "endpoint_b_3d": _l(self.endpoint_b_3d),
            "order": self.order,
            "display_color": self.display_color,
            "note": self.note,
            "targets": list(self.targets),
            "vertex_depth": _prov_dict(self.vertex_depth),
            "endpoint_a_depth": _prov_dict(self.endpoint_a_depth),
            "endpoint_b_depth": _prov_dict(self.endpoint_b_depth),
            "flags": list(self.flags),
            "confidence": self.confidence,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> AngleMeasurement:
        la, lb = d.get("line_a_id"), d.get("line_b_id")
        return cls(
            id=int(d["id"]),
            name=str(d.get("name", "")),
            line_a_id=int(la) if la is not None else None,
            line_b_id=int(lb) if lb is not None else None,
            angle_deg=_opt_float(d.get("angle_deg")),
            rejection_reason=str(d.get("rejection_reason") or ""),
            created_at=str(d.get("created_at") or iso_now()),
            measurement_type=str(d.get("measurement_type", "angle_3d_4point")),
            view=str(d.get("view") or ""),
            vertex_px=_opt_tuple(d.get("vertex_px"), 2),
            endpoint_a_px=_opt_tuple(d.get("endpoint_a_px"), 2),
            endpoint_b_px=_opt_tuple(d.get("endpoint_b_px"), 2),
            vertex_3d=_opt_tuple(d.get("vertex_3d"), 3),
            endpoint_a_3d=_opt_tuple(d.get("endpoint_a_3d"), 3),
            endpoint_b_3d=_opt_tuple(d.get("endpoint_b_3d"), 3),
            order=int(d.get("order", 0)),
            display_color=str(d.get("display_color") or ""),
            note=str(d.get("note") or ""),
            targets=_str_list(d.get("targets")),
            vertex_depth=_opt_prov(d.get("vertex_depth")),
            endpoint_a_depth=_opt_prov(d.get("endpoint_a_depth")),
            endpoint_b_depth=_opt_prov(d.get("endpoint_b_depth")),
            flags=_str_list(d.get("flags")),
            confidence=(str(d["confidence"]) if d.get("confidence") is not None else None),
        )


@dataclass
class CurveMeasurement:
    """``curve_2d`` (chord sum in the Z_ref plane) or ``curve_3d`` (per-point provenance,
    per-segment dz with ``segment_depth_jump`` flags, a Z_ref cross-check)."""

    id: int
    view: str
    name: str
    points_px: list[tuple[float, float]]
    measurement_type: str = "curve_2d"
    z_constant_m: float | None = None
    total_length_m: float | None = None
    segment_lengths_m: list[float] = field(default_factory=list)
    display_color: str = ""
    rejection_reason: str = ""
    created_at: str = field(default_factory=iso_now)
    # --- 2.1 additions ---
    order: int = 0
    note: str = ""
    targets: list[str] = field(default_factory=list)
    points_3d: list[tuple[float, float, float] | None] = field(default_factory=list)
    point_depth: list[DepthProvenance] = field(default_factory=list)
    point_dz_frac: list[float | None] = field(default_factory=list)
    segment_dz_m: list[float | None] = field(default_factory=list)
    segment_flags: list[list[str]] = field(default_factory=list)
    cross_check_2d_m: float | None = None
    uncertainty_m: float | None = None
    n_points: int = 0
    n_direct: int = 0
    n_knn: int = 0
    n_flagged: int = 0
    flags: list[str] = field(default_factory=list)
    confidence: str | None = None
    shape_note: str = "polyline"
    uncertainty_basis: str | None = None

    @property
    def is_valid(self) -> bool:
        return self.total_length_m is not None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "view": self.view,
            "name": self.name,
            "points_px": [list(p) for p in self.points_px],
            "measurement_type": self.measurement_type,
            "z_constant_m": self.z_constant_m,
            "total_length_m": self.total_length_m,
            "segment_lengths_m": list(self.segment_lengths_m),
            "display_color": self.display_color,
            "rejection_reason": self.rejection_reason,
            "created_at": self.created_at,
            "order": self.order,
            "note": self.note,
            "targets": list(self.targets),
            "points_3d": [list(p) if p is not None else None for p in self.points_3d],
            "point_depth": [p.to_dict() for p in self.point_depth],
            "point_dz_frac": list(self.point_dz_frac),
            "segment_dz_m": list(self.segment_dz_m),
            "segment_flags": [list(f) for f in self.segment_flags],
            "cross_check_2d_m": self.cross_check_2d_m,
            "uncertainty_m": self.uncertainty_m,
            "n_points": self.n_points,
            "n_direct": self.n_direct,
            "n_knn": self.n_knn,
            "n_flagged": self.n_flagged,
            "flags": list(self.flags),
            "confidence": self.confidence,
            "shape_note": self.shape_note,
            "uncertainty_basis": self.uncertainty_basis,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CurveMeasurement:
        return cls(
            id=int(d["id"]),
            view=str(d.get("view") or VIEW_ID),
            name=str(d.get("name", "")),
            points_px=[(float(p[0]), float(p[1])) for p in d.get("points_px", [])],
            measurement_type=str(d.get("measurement_type", "curve_2d")),
            z_constant_m=_opt_float(d.get("z_constant_m")),
            total_length_m=_opt_float(d.get("total_length_m")),
            segment_lengths_m=[float(x) for x in d.get("segment_lengths_m", [])],
            display_color=str(d.get("display_color") or ""),
            rejection_reason=str(d.get("rejection_reason") or ""),
            created_at=str(d.get("created_at") or iso_now()),
            order=int(d.get("order", 0)),
            note=str(d.get("note") or ""),
            targets=_str_list(d.get("targets")),
            points_3d=_list_of_opt_tuples(d.get("points_3d"), 3),
            point_depth=[DepthProvenance.from_dict(p) for p in d.get("point_depth", [])],
            point_dz_frac=_opt_float_list(d.get("point_dz_frac")),
            segment_dz_m=_opt_float_list(d.get("segment_dz_m")),
            segment_flags=[_str_list(f) for f in d.get("segment_flags", [])],
            cross_check_2d_m=_opt_float(d.get("cross_check_2d_m")),
            uncertainty_m=_opt_float(d.get("uncertainty_m")),
            n_points=int(d.get("n_points", 0)),
            n_direct=int(d.get("n_direct", 0)),
            n_knn=int(d.get("n_knn", 0)),
            n_flagged=int(d.get("n_flagged", 0)),
            flags=_str_list(d.get("flags")),
            confidence=(str(d["confidence"]) if d.get("confidence") is not None else None),
            shape_note=str(d.get("shape_note") or "polyline"),
            uncertainty_basis=(
                str(d["uncertainty_basis"]) if d.get("uncertainty_basis") is not None else None
            ),
        )


# ----- document-level blocks ---------------------------------------------------------------


@dataclass
class Outputs:
    overlay_version: int = 0
    overlay_file: str | None = None
    overlay_sha256: str | None = None
    overlay_width: int | None = None
    overlay_height: int | None = None
    overlay_frame_height: int | None = None
    overlay_footer_px: int | None = None
    # the report model gets a new version on every finalize and every report-input change;
    # an upload must name the one it printed (X-Report-Model-Sha256)
    report_model_version: int = 0
    report_model_file: str | None = None
    report_model_sha256: str | None = None
    report_version: int = 0
    report_file: str | None = None
    report_sha256: str | None = None
    # what the current report_file was sealed with (stale when either moved on)
    report_overlay_version: int = 0
    report_model_version_sealed: int = 0
    manifest_file: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {f.name: getattr(self, f.name) for f in fields(self)}

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> Outputs:
        d = d or {}
        return cls(**{f.name: d[f.name] for f in fields(cls) if f.name in d})


@dataclass
class ReportInputs:
    """ADR-D7 explicit inputs (never browser-side storage): set at finalize (B22)."""

    language: str = "both"
    rubric_variant: str = "mjaheem"
    names: dict[str, str] = field(default_factory=lambda: {"judge": "", "council": "", "event": ""})
    observations: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "language": self.language,
            "rubric_variant": self.rubric_variant,
            "names": dict(self.names),
            "observations": dict(self.observations),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> ReportInputs:
        d = d or {}
        names = {"judge": "", "council": "", "event": ""}
        names.update({str(k): str(v) for k, v in (d.get("names") or {}).items()})
        return cls(
            language=str(d.get("language") or "both"),
            rubric_variant=str(d.get("rubric_variant") or "mjaheem"),
            names=names,
            observations={str(k): str(v) for k, v in (d.get("observations") or {}).items()},
        )


@dataclass
class SessionDocument:
    """The engine's session (the parent's ``MeasurementSession`` + the 2.1 additions)."""

    session_id: str
    camel_id: str = ""
    views: dict[str, dict[str, Any]] = field(default_factory=dict)
    lines: list[LineMeasurement] = field(default_factory=list)
    angles: list[AngleMeasurement] = field(default_factory=list)
    library_versions: dict[str, Any] = field(default_factory=dict)
    view_metadata: dict[str, dict[str, Any]] = field(default_factory=dict)
    curves: list[CurveMeasurement] = field(default_factory=list)
    schema_version: str = SESSION_SCHEMA_VERSION
    # --- 2.1 additions ---
    operator: str = ""
    notes: str = ""
    status: str = "open"
    revision: int = 0
    created_at: str = field(default_factory=iso_now)
    updated_at: str = field(default_factory=iso_now)
    engine: dict[str, Any] = field(
        default_factory=lambda: {"version": ENGINE_VERSION, "constants": dict(CONSTANTS_STAMP)}
    )
    outputs: Outputs = field(default_factory=Outputs)
    outputs_stale: bool = False
    report_stale: bool = False
    next_measurement_id: int = 1
    report_inputs: ReportInputs = field(default_factory=ReportInputs)

    # ----- convenience -----
    @property
    def frame_view(self) -> dict[str, Any]:
        return self.views.get(VIEW_ID, {})

    @property
    def frame_metadata(self) -> dict[str, Any]:
        return self.view_metadata.get(VIEW_ID, {})

    def n_measurements(self) -> int:
        return len(self.lines) + len(self.angles) + len(self.curves)

    def n_rejected(self) -> int:
        rows = [*self.lines, *self.angles, *self.curves]
        return sum(1 for r in rows if r.rejection_reason)

    # ----- serialisation -----
    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "session_id": self.session_id,
            "camel_id": self.camel_id,
            "library_versions": dict(self.library_versions),
            "views": self.views,
            "view_metadata": self.view_metadata,
            "lines": [m.to_dict() for m in self.lines],
            "angles": [a.to_dict() for a in self.angles],
            "curves": [c.to_dict() for c in self.curves],
            "operator": self.operator,
            "notes": self.notes,
            "status": self.status,
            "revision": self.revision,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "engine": self.engine,
            "outputs": self.outputs.to_dict(),
            "outputs_stale": self.outputs_stale,
            "report_stale": self.report_stale,
            "next_measurement_id": self.next_measurement_id,
            "report_inputs": self.report_inputs.to_dict(),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> SessionDocument:
        version = str(d.get("schema_version", ""))
        if version != SESSION_SCHEMA_VERSION:
            raise UnsupportedSchemaVersion(
                f"unsupported session schema_version {version!r} (engine writes "
                f"{SESSION_SCHEMA_VERSION}; the parent's 2.0 files are never opened)",
                details={"schema_version": version, "expected": SESSION_SCHEMA_VERSION},
            )
        status = str(d.get("status", "open"))
        if status not in STATUSES:
            raise UnsupportedSchemaVersion(
                f"unknown session status {status!r}", details={"status": status}
            )
        return cls(
            schema_version=version,
            session_id=str(d["session_id"]),
            camel_id=str(d.get("camel_id") or ""),
            views=dict(d.get("views") or {}),
            lines=[LineMeasurement.from_dict(x) for x in d.get("lines") or []],
            angles=[AngleMeasurement.from_dict(x) for x in d.get("angles") or []],
            library_versions=dict(d.get("library_versions") or {}),
            view_metadata=dict(d.get("view_metadata") or {}),
            curves=[CurveMeasurement.from_dict(x) for x in d.get("curves") or []],
            operator=str(d.get("operator") or ""),
            notes=str(d.get("notes") or ""),
            status=status,
            revision=int(d.get("revision", 0)),
            created_at=str(d.get("created_at") or iso_now()),
            updated_at=str(d.get("updated_at") or iso_now()),
            engine=dict(d.get("engine") or {"version": ENGINE_VERSION, "constants": {}}),
            outputs=Outputs.from_dict(d.get("outputs")),
            outputs_stale=bool(d.get("outputs_stale", False)),
            report_stale=bool(d.get("report_stale", False)),
            next_measurement_id=int(d.get("next_measurement_id", 1)),
            report_inputs=ReportInputs.from_dict(d.get("report_inputs")),
        )


# ----- helpers -----------------------------------------------------------------------------


def family_of(measurement_type: str) -> str:
    if measurement_type in LINE_TYPES:
        return "lines"
    if measurement_type in CURVE_TYPES:
        return "curves"
    if measurement_type in ANGLE_TYPES:
        return "angles"
    raise ValueError(f"unknown measurement_type {measurement_type!r}")


def flat_measurements(doc: SessionDocument) -> list[dict[str, Any]]:
    """Every row as a dict with ``kind`` and ``family``, ordered by (order, id) (B16)."""
    rows: list[dict[str, Any]] = []
    for family, items in (("lines", doc.lines), ("angles", doc.angles), ("curves", doc.curves)):
        for row in items:
            d = row.to_dict()
            d["kind"] = row.measurement_type
            d["family"] = family
            d["input_kind"] = (
                "angle_4point"
                if row.measurement_type in ("angle_3d_4point", "angle_2d_4point")
                else row.measurement_type
            )
            rows.append(d)
    rows.sort(key=lambda r: (int(r.get("order", 0)), int(r["id"])))
    return rows


def document_etag(doc: SessionDocument) -> str:
    """Strong validator for ``If-Match``: changes with *any* persisted change (revision,
    status, outputs, report inputs, ...), not only the revision; readable prefix
    ``r<revision>``."""
    digest = hashlib.sha256(jsonsafe.dumps_canonical(doc.to_dict()).encode("utf-8")).hexdigest()
    return f'"r{doc.revision}-{digest[:16]}"'


def required_report_texts(doc: SessionDocument) -> list[str]:
    """The operator-entered strings the PDF text probe looks for (C3.7): every measurement
    name, the judge / council / event names and the camel id. The print page must render each
    in an embedded face (a synthesized bold lands in a Type3 font whose text is unsearchable)."""
    texts = [r.name for r in [*doc.lines, *doc.angles, *doc.curves] if r.name]
    texts += [value for value in doc.report_inputs.names.values() if value]
    if doc.camel_id:
        texts.append(doc.camel_id)
    return texts


def _input_of_row(row: dict[str, Any]) -> dict[str, Any]:
    if row["family"] == "lines":
        points = [row["p1_px"], row["p2_px"]]
    elif row["family"] == "curves":
        points = list(row["points_px"])
    else:
        points = [row.get("vertex_px"), row.get("endpoint_a_px"), row.get("endpoint_b_px")]
    return {
        "id": row["id"],
        "kind": row["input_kind"],
        "name": row["name"],
        "points": points,
        "targets": row.get("targets") or [],
        "color": row.get("display_color") or "",
        "note": row.get("note") or "",
        "line_a_id": row.get("line_a_id"),
        "line_b_id": row.get("line_b_id"),
        "order": row.get("order", 0),
    }


def document_input_sha256(doc: SessionDocument) -> str:
    """Hash of the operator-input part only (computed fields never change it) — used for
    the idempotent-replay rule of C3.4."""
    payload = {
        "camel_id": doc.camel_id,
        "operator": doc.operator,
        "notes": doc.notes,
        "measurements": [_input_of_row(r) for r in flat_measurements(doc)],
    }
    return hashlib.sha256(jsonsafe.dumps_canonical(payload).encode("utf-8")).hexdigest()


def empty_document(
    *,
    session_id: str,
    camel_id: str = "",
    operator: str = "",
    notes: str = "",
    view: dict[str, Any] | None = None,
    view_metadata: dict[str, Any] | None = None,
    library_versions: dict[str, Any] | None = None,
) -> SessionDocument:
    now = iso_now()
    return SessionDocument(
        session_id=session_id,
        camel_id=camel_id,
        operator=operator,
        notes=notes,
        views={VIEW_ID: dict(view or {})},
        view_metadata={VIEW_ID: dict(view_metadata or {})},
        library_versions=dict(library_versions or {}),
        created_at=now,
        updated_at=now,
    )


def load_session(path: Path | str) -> SessionDocument:
    """Strict load: an unparsable file or a wrong shape is ``CorruptFileError`` (C3.3);
    an unknown schema version is ``UnsupportedSchemaVersion`` (B20)."""
    data = read_json(path)
    if not isinstance(data, dict):
        raise CorruptFileError("session.json is not a JSON object", details={"path": str(path)})
    try:
        return SessionDocument.from_dict(data)
    except UnsupportedSchemaVersion:
        raise
    except (KeyError, ValueError, TypeError, AttributeError, OverflowError) as exc:
        raise CorruptFileError(
            f"session.json does not have the 2.1 shape: {type(exc).__name__}: {exc}",
            details={"path": str(path), "error": f"{type(exc).__name__}: {exc}"},
        ) from exc


def save_session(doc: SessionDocument, path: Path | str) -> bytes:
    return write_json(path, doc.to_dict(), prefix=".session_")
