from __future__ import annotations

import math
import warnings

import numpy as np
import pytest

from nazeer_engine import maskstats as m
from tests.synthetic import make_synthetic_frame

# ----- ported parent tests (test_mask_depth_stats.py) --------------------------------------


def test_uniform_depth_mask():
    depth = np.full((100, 100), 1.5, dtype=np.float32)
    mask = np.full((100, 100), 255, dtype=np.uint8)
    s = m.compute_mask_depth_stats(depth, mask)
    assert s["rejection_reason"] == "ok" and s["n_total"] == 10000 and s["n_valid"] == 10000
    assert abs(s["z_mean"] - 1.5) < 1e-6 and abs(s["z_median"] - 1.5) < 1e-6
    assert s["z_mad"] == 0.0 and s["z_var"] == 0.0 and s["z_std"] == 0.0 and s["z_range"] == 0.0
    assert s["z_valid_band"] == [0.3, 5.0]


def test_two_layer_depth():
    depth = np.zeros((10, 20), dtype=np.float32)
    depth[:, :10] = 1.0
    depth[:, 10:] = 2.0
    mask = np.full((10, 20), 255, dtype=np.uint8)
    s = m.compute_mask_depth_stats(depth, mask)
    assert abs(s["z_mean"] - 1.5) < 1e-9 and abs(s["z_median"] - 1.5) < 1e-9
    assert abs(s["z_mad"] - 0.5) < 1e-9 and abs(s["z_var"] - 0.25) < 1e-9
    assert abs(s["z_std"] - 0.5) < 1e-9 and s["z_min"] == 1.0 and s["z_max"] == 2.0
    assert abs(s["z_range"] - 1.0) < 1e-9


def test_empty_mask():
    s = m.compute_mask_depth_stats(np.ones((5, 5), np.float32), np.zeros((5, 5), np.uint8))
    assert s["rejection_reason"] == "mask_empty" and s["n_total"] == 0 and s["n_valid"] == 0
    for key in ("z_mean", "z_median", "z_mad", "z_var", "z_std", "z_min", "z_max", "z_range"):
        assert s[key] is None


def test_mask_but_all_depth_invalid():
    s = m.compute_mask_depth_stats(np.zeros((10, 10), np.float32), np.full((10, 10), 255, np.uint8))
    assert s["rejection_reason"] == "no_valid_depth_in_mask"
    assert s["n_total"] == 100 and s["n_valid"] == 0 and s["z_mean"] is None


def test_z_range_clipping():
    depth = np.zeros((10, 10), dtype=np.float32)
    depth[:5] = 0.5
    depth[5:] = 6.0
    s = m.compute_mask_depth_stats(depth, np.full((10, 10), 255, np.uint8))
    assert s["n_total"] == 100 and s["n_valid"] == 50
    assert s["z_mean"] == 0.5 and s["z_min"] == 0.5 and s["z_max"] == 0.5


def test_nan_depth_filtered():
    depth = np.full((10, 10), 1.5, dtype=np.float32)
    depth[:5] = np.nan
    with warnings.catch_warnings():
        warnings.simplefilter("error", RuntimeWarning)
        s = m.compute_mask_depth_stats(depth, np.full((10, 10), 255, np.uint8))
    assert s["n_total"] == 100 and s["n_valid"] == 50
    assert abs(s["z_mean"] - 1.5) < 1e-6 and s["z_mad"] == 0.0 and s["z_std"] == 0.0


def test_ground_band_basic():
    mask = np.zeros((200, 300), dtype=np.uint8)
    mask[40:100, 80:220] = 255
    band = m.build_ground_band_mask(mask, band_height_px=50, margin_px=4)
    assert (band[103:153, 80:220] == 255).all()
    assert band[:103].sum() == 0 and band[153:].sum() == 0
    assert band[103:153, :80].sum() == 0 and band[103:153, 220:].sum() == 0


def test_ground_band_empty_input_mask():
    assert m.build_ground_band_mask(np.zeros((50, 50), np.uint8)).sum() == 0


def test_ground_band_off_image_bottom():
    mask = np.zeros((200, 300), dtype=np.uint8)
    mask[150:200, 80:220] = 255
    assert m.build_ground_band_mask(mask, band_height_px=50, margin_px=4).sum() == 0


def test_ground_band_band_clipped_to_image():
    mask = np.zeros((200, 300), dtype=np.uint8)
    mask[100:150, 80:220] = 255
    band = m.build_ground_band_mask(mask, band_height_px=200, margin_px=4)
    assert (band[153:200, 80:220] == 255).all() and band[:153].sum() == 0


# ----- erosion -----------------------------------------------------------------------------


def test_erode_mask_two_px_shrinks_square_and_erases_thin_stripe():
    mask = np.zeros((30, 30), dtype=np.uint8)
    mask[10:20, 10:20] = 255
    eroded = m.erode_mask(mask, 2)
    assert (eroded != 0).sum() == 36 and (eroded[12:18, 12:18] == 255).all()
    stripe = np.zeros((30, 30), dtype=np.uint8)
    stripe[:, 10:13] = 255
    assert m.erode_mask(stripe, 2).sum() == 0
    assert np.array_equal(m.erode_mask(mask, 0), mask)


# ----- depth FOV bbox and completeness -----------------------------------------------------


def test_depth_valid_bbox_on_synthetic_frame_and_stray_pixel():
    f = make_synthetic_frame()
    assert m.depth_valid_bbox(f.depth_m) == [36, 20, 1279, 719]
    f.depth_m[5, 5] = 2.0  # a stray valid pixel in the dead border
    assert m.depth_valid_bbox(f.depth_m) == [36, 20, 1279, 719]
    assert m.depth_valid_bbox(np.zeros((10, 10), np.float32)) is None


def test_mask_completeness_margin_and_violations():
    f = make_synthetic_frame()
    dvb = m.depth_valid_bbox(f.depth_m)
    ok = m.mask_completeness(f.mask, dvb)
    assert ok["complete"] and ok["violations"] == {"left": 0, "top": 0, "right": 0, "bottom": 0}
    mask = np.zeros_like(f.mask)
    mask[100:300, 40:500] = 255  # starts at column 40: 4 px into the 8 px margin of x0=36
    bad = m.mask_completeness(mask, dvb)
    assert not bad["complete"] and bad["violations"]["left"] == 4 and bad["reason"]
    assert not m.mask_completeness(mask, None)["complete"]
    assert m.mask_completeness(np.zeros_like(f.mask), dvb)["reason"] == "mask_empty"
    assert m.point_in_bbox(36, 20, dvb) and not m.point_in_bbox(10, 300, dvb)


def test_frame_clearance_is_about_the_image_border_not_the_depth_fov():
    f = make_synthetic_frame()
    assert m.frame_clearance(f.mask)["clear"]
    head_in_dead_band = np.zeros_like(f.mask)
    head_in_dead_band[5:715, 300:900] = 255  # rows 5..19 have no depth: soft, not a cut
    assert m.frame_clearance(head_in_dead_band)["clear"]
    assert not m.mask_completeness(head_in_dead_band, m.depth_valid_bbox(f.depth_m))["complete"]
    hooves_cut = np.zeros_like(f.mask)
    hooves_cut[100:720, 300:900] = 255  # reaches the last row: the hooves are cut off
    cut = m.frame_clearance(hooves_cut)
    assert not cut["clear"] and cut["violations"] == {"left": 0, "top": 0, "right": 0, "bottom": 1}
    assert m.frame_clearance(hooves_cut, margin_px=0)["clear"]  # 0 disables the gate
    near = m.frame_clearance(head_in_dead_band, margin_px=8)
    assert near["violations"]["top"] == 3 and not near["clear"]
    assert not m.frame_clearance(np.zeros_like(f.mask))["clear"]


# ----- z_ref block -------------------------------------------------------------------------


def test_z_ref_block_uses_eroded_mask_and_ignores_boundary_ring():
    f = make_synthetic_frame()
    z = m.z_ref_block(f.depth_m, f.mask)
    assert z["statistic"] == "median" and z["rejection_reason"] == "ok"
    assert abs(z["z_ref_m"] - 2.0) < 0.02 and z["z_ref_m"] == z["z_median_m"]
    assert z["n_mask_raw"] > z["n_total"] and not z["erosion_fallback"]
    assert z["erosion_px"] == 2 and z["band"] == [0.3, 5.0]
    assert abs(z["rel_disp"] - z["z_mad_mean_abs_dev_m"] / z["z_median_m"]) < 1e-12
    assert z["z_mad_robust_m"] is not None and 0 < z["valid_fraction"] <= 1


def test_z_ref_block_fallback_to_raw_mask_and_rejection():
    depth = np.full((40, 40), 2.0, dtype=np.float32)
    mask = np.zeros((40, 40), dtype=np.uint8)
    mask[:, 10:13] = 255  # 3 px wide: eroded away entirely
    z = m.z_ref_block(depth, mask)
    assert z["erosion_fallback"] and z["rejection_reason"] == "ok" and z["z_ref_m"] == 2.0
    z0 = m.z_ref_block(np.zeros((40, 40), np.float32), mask)
    assert z0["rejection_reason"] == "no_valid_depth_in_mask" and z0["z_ref_m"] is None
    assert z0["z_mad_robust_m"] is None and z0["rel_disp"] is None


# ----- ground rows -------------------------------------------------------------------------


def _legs_frame(far_leg_depth_factor: float):
    h, w = 720, 1280
    depth = np.full((h, w), 2.0, dtype=np.float32)
    mask = np.zeros((h, w), dtype=np.uint8)
    mask[200:560, 300:980] = 255
    for c0, c1 in ((320, 370), (520, 570), (720, 770)):
        mask[560:641, c0:c1] = 255
    mask[560:678, 910:960] = 255  # far-side leg, 37 px lower
    depth[560:678, 910:960] = 2.0 * far_leg_depth_factor
    return depth, mask


def test_ground_rows_excludes_far_side_leg():
    depth, mask = _legs_frame(1.3)
    gr = m.ground_rows(mask, depth, 2.0)
    assert gr["raw_row"] == 677 and gr["near_plane_row"] == 640 and gr["drawn_row"] == 640
    assert gr["differs_px"] == 37 and gr["badge"] == "far_side_row_differs"
    assert gr["n_columns_near"] > 0 and gr["x_min"] == 300 and gr["x_max"] == 979


def test_ground_rows_near_leg_within_tolerance_is_kept():
    depth, mask = _legs_frame(1.05)  # within 12 %
    gr = m.ground_rows(mask, depth, 2.0)
    assert gr["near_plane_row"] == 677 and gr["differs_px"] == 0 and gr["badge"] is None


def test_ground_rows_unresolved_and_empty():
    depth, mask = _legs_frame(1.3)
    depth[:] = 3.0  # every column far from z_ref
    gr = m.ground_rows(mask, depth, 2.0)
    assert gr["near_plane_row"] is None and gr["badge"] == "ground_row_unresolved"
    assert gr["drawn_row"] == gr["raw_row"] == 677 and gr["differs_px"] is None
    empty = m.ground_rows(np.zeros((5, 5), np.uint8), np.zeros((5, 5), np.float32), 2.0)
    assert empty["raw_row"] is None and empty["badge"] == "ground_row_unresolved"
    assert m.ground_rows(mask, depth, None)["near_plane_row"] is None


# ----- buckets and bboxes ------------------------------------------------------------------


@pytest.mark.parametrize(
    "aspect,bucket",
    [
        (2.0, "SIDE"),
        (0.5, "END"),
        (1.5, "QUARTER"),
        (0.0, "QUARTER"),
        (1.6, "QUARTER"),
        (1.3, "QUARTER"),
    ],
)
def test_bucket_from_aspect(aspect, bucket):
    assert m.bucket_from_aspect(aspect) == bucket


def test_bbox_helpers():
    assert m.bbox_aspect([0, 0, 200, 100]) == 2.0 and m.bbox_aspect([0, 0, 10, 0.5]) == 0.0
    assert m.bbox_aspect(None) == 0.0
    mask = np.zeros((20, 30), dtype=np.uint8)
    mask[5:10, 3:9] = 255
    assert m.mask_bbox(mask) == (3, 5, 8, 9) and m.mask_bbox(np.zeros((2, 2), np.uint8)) is None
    assert abs(m.mask_area_frac(mask) - 30 / 600) < 1e-12
    assert m.bbox_iou((0, 0, 9, 9), (0, 0, 9, 9)) == 1.0
    assert m.bbox_iou((0, 0, 9, 9), (20, 20, 29, 29)) == 0.0
    assert m.bbox_iou(None, (0, 0, 1, 1)) is None
    assert math.isclose(m.bbox_iou((0, 0, 9, 9), (5, 0, 14, 9)), 50 / 150)


def test_valid_depth_mask_band():
    depth = np.array([[0.0, 0.3, 5.0, 5.1, np.nan, np.inf]], dtype=np.float32)
    assert m.valid_depth_mask(depth).tolist() == [[False, True, True, False, False, False]]
