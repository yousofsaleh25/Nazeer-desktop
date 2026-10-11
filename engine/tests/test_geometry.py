"""Ported parent math tests (numbers unchanged) + the engine's D7 adversarial tests."""

from __future__ import annotations

import inspect
import json
import math
from pathlib import Path

import numpy as np
import pytest

from nazeer_engine import geometry as g

FX = FY = 640.0
CX, CY = 640.0, 360.0


@pytest.fixture
def K() -> g.Intrinsics:
    return g.Intrinsics(fx=FX, fy=FY, cx=CX, cy=CY, width=1280, height=720)


@pytest.fixture
def K2() -> g.Intrinsics:
    return g.Intrinsics(fx=600.0, fy=600.0, cx=320.0, cy=240.0, width=640, height=480)


def _uniform_depth(value: float) -> np.ndarray:
    return np.full((720, 1280), value, dtype=np.float32)


# ----- backprojection (parent test_phase21_v2_measure.py) ----------------------------------


def test_backproject_pixel_center_at_known_depth(K):
    p, reason, d = g.backproject_pixel(CX, CY, _uniform_depth(3.0), K)
    assert reason == "" and abs(d - 3.0) < 1e-6
    assert p is not None and abs(p[0]) < 1e-6 and abs(p[1]) < 1e-6 and abs(p[2] - 3.0) < 1e-6


def test_backproject_pixel_offset_uses_pinhole_formula(K):
    p, reason, _ = g.backproject_pixel(CX + 100, CY - 50, _uniform_depth(2.0), K)
    assert reason == "" and p is not None
    assert abs(p[0] - 0.3125) < 1e-6 and abs(p[1] + 0.15625) < 1e-6 and abs(p[2] - 2.0) < 1e-6


def test_backproject_pixel_rejects_nan_depth(K):
    p, reason, d = g.backproject_pixel(CX, CY, _uniform_depth(float("nan")), K)
    assert p is None and "depth_invalid" in reason and not math.isfinite(d)


def test_backproject_pixel_rejects_zero_depth(K):
    p, reason, _ = g.backproject_pixel(CX, CY, _uniform_depth(0.0), K)
    assert p is None and reason


def test_backproject_pixel_rejects_depth_below_min(K):
    p, reason, _ = g.backproject_pixel(CX, CY, _uniform_depth(0.1), K)
    assert p is None and "depth_invalid" in reason


def test_backproject_pixel_rejects_depth_above_max(K):
    p, reason, _ = g.backproject_pixel(CX, CY, _uniform_depth(6.0), K)
    assert p is None and reason


def test_backproject_pixel_rejects_out_of_bounds(K):
    p, _, _ = g.backproject_pixel(-10, CY, _uniform_depth(2.0), K)
    assert p is None


def test_backproject_pixel_rejects_sparse_depth_window(K):
    depth = _uniform_depth(0.0)
    depth[int(CY), int(CX)] = 3.0
    p, reason, _ = g.backproject_pixel(CX, CY, depth, K)
    assert p is None and "sparse" in reason


def test_backproject_pixel_accepts_partial_window(K):
    depth = _uniform_depth(0.0)
    cy, cx = int(CY), int(CX)
    depth[cy - 2 : cy + 3, cx - 2 : cx] = 3.0  # 10 of 25 valid
    p, reason, _ = g.backproject_pixel(CX, CY, depth, K)
    assert p is not None and reason == ""


def test_backproject_pixel_parity_8_of_25_accepted_7_rejected(K):
    cy, cx = int(CY), int(CX)
    depth = _uniform_depth(0.0)
    flat = depth[cy - 2 : cy + 3, cx - 2 : cx + 3].reshape(-1)
    flat[:8] = 2.0
    depth[cy - 2 : cy + 3, cx - 2 : cx + 3] = flat.reshape(5, 5)
    assert g.backproject_pixel(CX, CY, depth, K)[0] is not None
    depth = _uniform_depth(0.0)
    flat = depth[cy - 2 : cy + 3, cx - 2 : cx + 3].reshape(-1)
    flat[:7] = 2.0
    depth[cy - 2 : cy + 3, cx - 2 : cx + 3] = flat.reshape(5, 5)
    p, reason, _ = g.backproject_pixel(CX, CY, depth, K)
    assert p is None and "sparse" in reason


def test_backproject_pixel_corner_divides_by_nominal_25(K):
    # a corner click sees a clipped 3x3 window; the parent rule still divides by 25:
    # 7 of 9 valid (28 %) is rejected, 8 of 9 (32 %) is accepted
    depth = _uniform_depth(0.0)
    depth[0:3, 0:3] = 2.0
    depth[2, 2] = 0.0
    depth[2, 1] = 0.0
    p, reason, _ = g.backproject_pixel(0, 0, depth, K)
    assert p is None and "7/25" in reason
    depth[2, 1] = 2.0
    assert g.backproject_pixel(0, 0, depth, K)[0] is not None


def test_backproject_pixel_keeps_parent_half_to_even_rounding(K):
    # the parent rounds with Python's round (half to even); the engine's own click path in
    # depthlookup rounds half-up — documented deviation (B32)
    depth = _uniform_depth(0.0)
    depth[:, 0:3] = 2.0  # columns 0..2 valid
    p_even, _, _ = g.backproject_pixel(2.5, CY, depth, K)  # round(2.5) == 2 -> window 0..4
    assert p_even is not None


def test_backproject_point_is_pure_pinhole(K):
    x, y, z = g.backproject_point(CX + 64, CY - 64, 2.0, K)
    assert abs(x - 0.2) < 1e-9 and abs(y + 0.2) < 1e-9 and z == 2.0


# ----- distances ---------------------------------------------------------------------------


def test_distance_3d_axis_aligned():
    assert g.distance_3d((0, 0, 0), (3, 0, 0)) == 3.0
    assert g.distance_3d((0, 0, 0), (0, 4, 0)) == 4.0


def test_distance_3d_pythagoras():
    assert abs(g.distance_3d((0, 0, 0), (3, 4, 0)) - 5.0) < 1e-12


def test_distance_3d_zero_when_same_point():
    assert g.distance_3d((1.0, 2.0, 3.0), (1.0, 2.0, 3.0)) == 0.0


def test_distance_2d_image_plane_happy_path(K2):
    d = g.distance_2d_image_plane((100, 100), (130, 140), K2, z_constant_m=1.0)
    assert abs(d - 50.0 / 600.0) < 1e-9


def test_distance_2d_image_plane_z_scaling_is_linear(K2):
    d1 = g.distance_2d_image_plane((100, 100), (130, 140), K2, z_constant_m=1.0)
    d2 = g.distance_2d_image_plane((100, 100), (130, 140), K2, z_constant_m=2.0)
    assert abs(d2 - 2.0 * d1) < 1e-9 * d2


@pytest.mark.parametrize("z", [float("nan"), float("inf"), -1.0, 0.0])
def test_distance_2d_image_plane_non_finite_z_returns_nan(K2, z):
    assert math.isnan(g.distance_2d_image_plane((0, 0), (1, 1), K2, z_constant_m=z))


def test_d7_distance_2d_image_plane_has_no_depth_input(K2):
    params = inspect.signature(g.distance_2d_image_plane).parameters
    assert "depth_m" not in params and "depth" not in params
    assert set(params) == {"p1_px", "p2_px", "K", "z_constant_m"}


# ----- curves ------------------------------------------------------------------------------


def test_curve_length_2d_straight_line(K2):
    K3 = g.Intrinsics(fx=640.0, fy=640.0, cx=320.0, cy=240.0, width=640, height=480)
    total, segs = g.curve_length_2d([(100, 200), (200, 200)], K3, 1.0)
    assert abs(total - 0.15625) < 1e-9 and len(segs) == 1


def test_curve_length_2d_polyline_sum():
    K3 = g.Intrinsics(fx=640.0, fy=640.0, cx=320.0, cy=240.0, width=640, height=480)
    total, segs = g.curve_length_2d([(100, 200), (200, 200), (200, 300)], K3, 1.0)
    assert len(segs) == 2 and all(abs(s - 0.15625) < 1e-9 for s in segs)
    assert abs(total - sum(segs)) < 1e-12


def test_curve_length_2d_too_few_points_raises(K2):
    with pytest.raises(ValueError):
        g.curve_length_2d([(1, 1)], K2, 1.0)


def test_d7_curve_length_2d_has_no_depth_parameter():
    assert "depth" not in " ".join(inspect.signature(g.curve_length_2d).parameters)


def test_d7_curve_length_3d_changes_when_one_depth_changes(K):
    pixels = [(500.0, 300.0), (600.0, 320.0), (700.0, 300.0)]
    flat = [g.backproject_point(u, v, 2.0, K) for u, v in pixels]
    bent = [g.backproject_point(u, v, 2.5 if i == 1 else 2.0, K) for i, (u, v) in enumerate(pixels)]
    total_flat, segs_flat = g.curve_length_3d(flat)
    total_bent, segs_bent = g.curve_length_3d(bent)
    assert len(segs_flat) == 2 and total_bent > total_flat + 0.5
    assert abs(total_flat - g.curve_length_2d(pixels, K, 2.0)[0]) < 1e-9


def test_curve_length_3d_too_few_points_raises():
    with pytest.raises(ValueError):
        g.curve_length_3d([(0, 0, 1)])


# ----- uncertainty -------------------------------------------------------------------------


def test_uncertainty_one_percent_rule_of_thumb_at_3m(K):
    unc = g.propagate_distance_uncertainty((-0.5, 0, 3), (0.5, 0, 3), 3.0, 3.0, K)
    assert 0.0 <= unc <= 0.01
    assert abs(unc - 0.00707) < 5e-4


def test_uncertainty_radial_line_at_3m_is_roughly_sigma_d_per_endpoint(K):
    unc = g.propagate_distance_uncertainty((0, 0, 2.5), (0, 0, 3.5), 2.5, 3.5, K)
    assert 0.03 <= unc <= 0.05
    assert abs(unc - 0.0430) < 1e-3


def test_uncertainty_zero_for_identical_endpoints(K):
    assert g.propagate_distance_uncertainty((0, 0, 3), (0, 0, 3), 3.0, 3.0, K) == 0.0


def test_uncertainty_accepts_missing_K():
    a = g.propagate_distance_uncertainty((-0.5, 0, 3), (0.5, 0, 3), 3.0, 3.0)
    b = g.propagate_distance_uncertainty((-0.5, 0, 3), (0.5, 0, 3), 3.0, 3.0, None)
    assert a == b and a > 0


def test_uncertainty_nan_for_non_positive_depth(K):
    assert math.isnan(g.propagate_distance_uncertainty((0, 0, 1), (1, 0, 1), 0.0, 1.0, K))


# ----- angles ------------------------------------------------------------------------------


def test_angle_between_lines_orthogonal():
    assert abs(g.angle_between_lines((0, 0, 0), (1, 0, 0), (0, 0, 0), (0, 1, 0)) - 90) < 1e-9


def test_angle_between_lines_parallel():
    assert abs(g.angle_between_lines((0, 0, 0), (1, 0, 0), (5, 5, 5), (6, 5, 5))) < 1e-9


def test_angle_between_lines_antiparallel_is_180():
    assert abs(g.angle_between_lines((0, 0, 0), (1, 0, 0), (0, 0, 0), (-1, 0, 0)) - 180) < 1e-9


def test_angle_between_lines_45_degrees():
    assert abs(g.angle_between_lines((0, 0, 0), (1, 0, 0), (0, 0, 0), (1, 1, 0)) - 45) < 1e-3


def test_angle_between_lines_zero_length_is_nan():
    assert math.isnan(g.angle_between_lines((0, 0, 0), (0, 0, 0), (0, 0, 0), (1, 0, 0)))


def test_angle_between_lines_works_in_2d():
    assert abs(g.angle_between_lines((0, 0), (1, 0), (0, 0), (0, 1)) - 90) < 1e-9


def test_angle_3point_2d_right_angle_is_90():
    assert abs(g.angle_3point((0, 0), (1, 0), (0, 1)) - 90) < 1e-9


def test_angle_3point_3d_matches_2d_when_dz_is_zero():
    a2 = g.angle_3point((0, 0), (1, 0), (0, 1))
    a3 = g.angle_3point((0, 0, 5), (1, 0, 5), (0, 1, 5))
    assert abs(a2 - a3) < 1e-9 and abs(a3 - 90) < 1e-9


def test_angle_3point_degenerate_ray_returns_nan():
    assert math.isnan(g.angle_3point((0, 0), (0, 0), (1, 0)))
    assert math.isnan(g.angle_3point((0, 0, 0), (0, 0, 0), (1, 0, 0)))
    assert math.isnan(g.angle_3point((0, 0), (1, 0, 0), (0, 1)))


def test_angle_from_horizontal_2d_basic():
    assert abs(g.angle_from_horizontal_2d((0, 0), (10, 0))) < 1e-9
    assert abs(g.angle_from_horizontal_2d((0, 0), (0, -10)) - 90) < 1e-9
    assert abs(g.angle_from_horizontal_2d((0, 0), (0, 10)) + 90) < 1e-9
    assert abs(abs(g.angle_from_horizontal_2d((0, 0), (-10, 0))) - 180) < 1e-9
    assert math.isnan(g.angle_from_horizontal_2d((3, 3), (3, 3)))


# ----- display helpers ---------------------------------------------------------------------


def test_format_distance_units():
    assert g.format_distance(0.05) == "5.0 cm"
    assert g.format_distance(0.095) == "9.5 cm"
    assert g.format_distance(0.10) == "0.100 m"
    assert g.format_distance(1.234) == "1.234 m"
    assert g.format_distance(None) == "--"
    assert g.format_distance(0.05, smart_units=False) == "0.050 m"


def test_format_distance_handles_numpy_nan_and_float32():
    assert g.format_distance(np.float32("nan")) == "--"
    assert g.format_distance(np.float32(0.5)) == "0.500 m"


def test_format_angle():
    assert g.format_angle(47.2) == "+47.2°"
    assert g.format_angle(-3.0) == "-3.0°"
    assert g.format_angle(None) == "--"
    assert g.format_angle(float("nan")) == "--"


def test_assign_color_deterministic_and_unique():
    assert g.assign_color(3) == g.assign_color(3)
    assert len({g.assign_color(i) for i in range(22)}) == 22


def test_assign_color_matches_v3_palette():
    assert g.assign_color(0) == "#BE2C2C"
    assert g.assign_color(10) == "#B2BE2C"
    assert g.assign_color(21) == "#BE2C3F"


def test_generate_unique_colors_matches_assign_color():
    colors = g.generate_unique_colors(25)
    assert colors == [g.assign_color(i) for i in range(25)]


# ----- intrinsics --------------------------------------------------------------------------


def test_intrinsics_round_trip_and_from_json(tmp_path: Path, K):
    d = K.to_dict()
    assert g.Intrinsics.from_dict(d) == K
    path = tmp_path / "intrinsics.json"
    path.write_text(json.dumps({**d, "model": "x", "coeffs": [0, 0, 0, 0, 0]}), encoding="utf-8")
    assert g.Intrinsics.from_json(path) == K
