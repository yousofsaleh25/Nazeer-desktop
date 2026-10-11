"""Measurement geometry, vendored from the parent repo's ``four_view/measure.py``
(byte-equivalent math, same signatures) plus the engine's additions:

* ``Intrinsics.from_dict`` / ``to_dict``;
* ``backproject_point`` (pinhole only; the depth is supplied by ``depthlookup``);
* ``curve_length_3d`` (contract C1.7; D7 test: it changes when depth changes);
* ``format_angle``.

Conventions: camera X right, Y down, Z forward (OpenCV / pyrealsense2 colour stream).
``distance_2d_image_plane`` and ``curve_length_2d`` have **no depth input** at all: 2D
rows are structurally unable to read per-pixel depth (C1.8).
"""

from __future__ import annotations

import colorsys
import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .constants import DEPTH_MAX_M, DEPTH_MIN_M, DEPTH_WINDOW, SIGMA_D_FRAC

Point2 = tuple[float, float]
Point3 = tuple[float, float, float]

GOLDEN_RATIO = 1.6180339887498949
COLOR_SATURATION = 0.62
COLOR_LIGHTNESS = 0.46


@dataclass
class Intrinsics:
    """Pinhole intrinsics of the colour stream (``cx``/``cy`` = RealSense ``ppx``/``ppy``)."""

    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Intrinsics:
        return cls(
            fx=float(d["fx"]),
            fy=float(d["fy"]),
            cx=float(d["cx"]),
            cy=float(d["cy"]),
            width=int(d["width"]),
            height=int(d["height"]),
        )

    @classmethod
    def from_json(cls, path: Path | str) -> Intrinsics:
        with open(path, encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh))

    def to_dict(self) -> dict[str, Any]:
        return {
            "fx": self.fx,
            "fy": self.fy,
            "cx": self.cx,
            "cy": self.cy,
            "width": self.width,
            "height": self.height,
        }


# ----- depth sampling (parent rule, kept for parity tests) ---------------------------------


def _median_depth(depth_m: np.ndarray, u: float, v: float, half: int) -> tuple[float, int]:
    """(median_depth_m, n_valid) over a (2*half+1)² window; invalid pixels skipped."""
    h, w = depth_m.shape
    ui, vi = int(round(u)), int(round(v))
    if not (0 <= ui < w and 0 <= vi < h):
        return float("nan"), 0
    u0, u1 = max(0, ui - half), min(w, ui + half + 1)
    v0, v1 = max(0, vi - half), min(h, vi + half + 1)
    window = depth_m[v0:v1, u0:u1].astype(np.float64)
    finite = np.isfinite(window) & (window >= DEPTH_MIN_M) & (window <= DEPTH_MAX_M)
    valid = window[finite]
    if valid.size == 0:
        return float("nan"), 0
    return float(np.median(valid)), int(valid.size)


def backproject_pixel(
    u: float,
    v: float,
    depth_m: np.ndarray,
    K: Intrinsics,
    *,
    window: int = DEPTH_WINDOW,
) -> tuple[Point3 | None, str, float]:
    """Parent rule: window median of valid depth, >= 30 % of the nominal window valid.

    Returns ``(point_3d_or_None, reason, depth_used_m)``. The engine's own click path is
    ``depthlookup.depth_for_pixel`` (richer provenance, KNN fallback); this function is
    kept byte-equivalent to the parent for parity tests and for the 2D endpoint metadata.
    """
    half = max(1, window // 2)
    d, n_valid = _median_depth(depth_m, u, v, half)
    if not math.isfinite(d) or n_valid == 0:
        return None, f"depth_invalid_at_({u:.0f},{v:.0f}): no_valid_samples", float("nan")
    n_window = (2 * half + 1) ** 2
    if n_valid / n_window < 0.30:
        return None, f"depth_window_sparse: {n_valid}/{n_window} valid", d
    return backproject_point(u, v, d, K), "", d


def backproject_point(u: float, v: float, depth_m: float, K: Intrinsics) -> Point3:
    """Pinhole back-projection of pixel (u, v) at a known depth (no sampling)."""
    x = (u - K.cx) * depth_m / K.fx
    y = (v - K.cy) * depth_m / K.fy
    return (float(x), float(y), float(depth_m))


# ----- distances ---------------------------------------------------------------------------


def distance_3d(p1: Sequence[float], p2: Sequence[float]) -> float:
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    dz = p2[2] - p1[2]
    return float(math.sqrt(dx * dx + dy * dy + dz * dz))


def distance_2d_image_plane(
    p1_px: Sequence[float],
    p2_px: Sequence[float],
    K: Intrinsics,
    *,
    z_constant_m: float,
) -> float:
    """Image-plane distance with both points on the plane Z = ``z_constant_m``.

    No dz term and no per-pixel depth sampling by construction (D7). NaN when the plane
    depth is non-finite or non-positive.
    """
    if not math.isfinite(z_constant_m) or z_constant_m <= 0:
        return float("nan")
    inv_fx = z_constant_m / K.fx
    inv_fy = z_constant_m / K.fy
    dx = (p2_px[0] - p1_px[0]) * inv_fx
    dy = (p2_px[1] - p1_px[1]) * inv_fy
    return float(math.sqrt(dx * dx + dy * dy))


def curve_length_2d(
    points_px: Sequence[Sequence[float]],
    K: Intrinsics,
    z_constant_m: float,
) -> tuple[float, list[float]]:
    """Chord sum of the polyline through ``points_px`` in the Z = ``z_constant_m`` plane.

    A piecewise-linear approximation: it under-estimates the arc length of a smooth curve
    (label it "polyline", never "arc length"). Raises ``ValueError`` below 2 points.
    """
    if len(points_px) < 2:
        raise ValueError(f"curve_length_2d needs >=2 points, got {len(points_px)}")
    seg_lens: list[float] = []
    for i in range(len(points_px) - 1):
        seg_lens.append(
            distance_2d_image_plane(
                tuple(points_px[i]), tuple(points_px[i + 1]), K, z_constant_m=z_constant_m
            )
        )
    return float(sum(seg_lens)), seg_lens


def curve_length_3d(points_3d: Sequence[Sequence[float]]) -> tuple[float, list[float]]:
    """Chord sum of the polyline through 3D points (metres). Contract C1.7.

    Every control point must already be back-projected with its own depth, so the result
    changes when any point's depth changes (D7 adversarial test). Raises ``ValueError``
    below 2 points.
    """
    if len(points_3d) < 2:
        raise ValueError(f"curve_length_3d needs >=2 points, got {len(points_3d)}")
    seg_lens = [distance_3d(points_3d[i], points_3d[i + 1]) for i in range(len(points_3d) - 1)]
    return float(sum(seg_lens)), seg_lens


def propagate_distance_uncertainty(
    p1: Sequence[float],
    p2: Sequence[float],
    d1: float,
    d2: float,
    K: Intrinsics | None = None,
    *,
    sigma_d_frac: float = SIGMA_D_FRAC,
) -> float:
    """First-order propagation of the D455 depth noise (sigma_d = 1 % of d) through the
    pinhole equations onto ``distance_3d(p1, p2)``. ``K`` is accepted for signature parity
    with the parent and unused (the ray directions come from the points themselves)."""
    if d1 <= 0 or d2 <= 0:
        return float("nan")
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    dz = p2[2] - p1[2]
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    if length < 1e-9:
        return 0.0
    a1 = (p1[0] / d1, p1[1] / d1, 1.0)
    a2 = (p2[0] / d2, p2[1] / d2, 1.0)
    proj1 = (dx * a1[0] + dy * a1[1] + dz * a1[2]) / length
    proj2 = (dx * a2[0] + dy * a2[1] + dz * a2[2]) / length
    s1 = sigma_d_frac * d1
    s2 = sigma_d_frac * d2
    var = (proj1 * proj1) * (s1 * s1) + (proj2 * proj2) * (s2 * s2)
    return float(math.sqrt(var))


# ----- angles ------------------------------------------------------------------------------


def angle_between_lines(
    line_a_p1: Sequence[float],
    line_a_p2: Sequence[float],
    line_b_p1: Sequence[float],
    line_b_p2: Sequence[float],
) -> float:
    """Angle in degrees between the two directed line directions, in [0, 180]
    (antiparallel lines give 180; the parent docstring said "acute", the code never folded).
    NaN for a zero-length line. Works for 2D (u, v) or 3D inputs of equal length."""
    n = len(line_a_p1)
    va = np.array([line_a_p2[i] - line_a_p1[i] for i in range(n)], dtype=np.float64)
    vb = np.array([line_b_p2[i] - line_b_p1[i] for i in range(n)], dtype=np.float64)
    na = float(np.linalg.norm(va))
    nb = float(np.linalg.norm(vb))
    if na < 1e-9 or nb < 1e-9:
        return float("nan")
    cos_theta = float(np.clip(np.dot(va, vb) / (na * nb), -1.0, 1.0))
    return math.degrees(math.acos(cos_theta))


def angle_3point(
    vertex: Sequence[float],
    endpoint_a: Sequence[float],
    endpoint_b: Sequence[float],
) -> float:
    """Angle at ``vertex`` between the rays to the two endpoints, [0, 180]; dimension-agnostic
    (three 2-tuples or three 3-tuples); NaN for a degenerate ray or mismatched lengths."""
    n = len(vertex)
    if n < 2 or len(endpoint_a) != n or len(endpoint_b) != n:
        return float("nan")
    va = np.array([endpoint_a[i] - vertex[i] for i in range(n)], dtype=np.float64)
    vb = np.array([endpoint_b[i] - vertex[i] for i in range(n)], dtype=np.float64)
    na = float(np.linalg.norm(va))
    nb = float(np.linalg.norm(vb))
    if na < 1e-9 or nb < 1e-9:
        return float("nan")
    cos_theta = float(np.clip(np.dot(va, vb) / (na * nb), -1.0, 1.0))
    return math.degrees(math.acos(cos_theta))


def angle_from_horizontal_2d(p1: Sequence[float], p2: Sequence[float]) -> float:
    """Signed angle of p1->p2 against the image horizontal, [-180, 180]; image Y points
    down so the sign follows the math convention (+90 = up). NaN when p1 == p2."""
    dx = float(p2[0] - p1[0])
    dy = float(p2[1] - p1[1])
    if dx == 0.0 and dy == 0.0:
        return float("nan")
    return math.degrees(math.atan2(-dy, dx))


# ----- display helpers ---------------------------------------------------------------------


def format_distance(distance_m: float | None, *, smart_units: bool = True) -> str:
    """< 0.10 m -> "X.X cm", else "X.XXX m"; None / NaN -> "--" (ASCII)."""
    if distance_m is None:
        return "--"
    try:
        value = float(distance_m)
    except (TypeError, ValueError):
        return "--"
    if math.isnan(value):
        return "--"
    if smart_units and value < 0.10:
        return f"{value * 100.0:.1f} cm"
    return f"{value:.3f} m"


def format_angle(angle_deg: float | None) -> str:
    if angle_deg is None:
        return "--"
    try:
        value = float(angle_deg)
    except (TypeError, ValueError):
        return "--"
    if math.isnan(value):
        return "--"
    return f"{value:+.1f}°"


def generate_unique_colors(
    n: int,
    *,
    saturation: float = COLOR_SATURATION,
    lightness: float = COLOR_LIGHTNESS,
) -> list[str]:
    """Golden-ratio hue rotation; the first n indices are n distinct colours (no cycling).
    The (0.62, 0.46) pair is the operator-approved v3 look; do not change without review."""
    out: list[str] = []
    for i in range(n):
        hue = (i / GOLDEN_RATIO) % 1.0
        r, g, b = colorsys.hls_to_rgb(hue, lightness, saturation)
        out.append(f"#{int(r * 255):02X}{int(g * 255):02X}{int(b * 255):02X}")
    return out


def assign_color(index: int) -> str:
    """Colour for the measurement at 0-based ``index`` (pinned: 0 -> #BE2C2C, 10 -> #B2BE2C,
    21 -> #BE2C3F)."""
    hue = (index / GOLDEN_RATIO) % 1.0
    r, g, b = colorsys.hls_to_rgb(hue, COLOR_LIGHTNESS, COLOR_SATURATION)
    return f"#{int(r * 255):02X}{int(g * 255):02X}{int(b * 255):02X}"
