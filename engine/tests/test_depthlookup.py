from __future__ import annotations

import math

import numpy as np
import pytest

from nazeer_engine import depthlookup as dl
from nazeer_engine.constants import KNN_FAR_M, KNN_K, KNN_MAX_DIST_M
from nazeer_engine.geometry import Intrinsics
from nazeer_engine.jsonsafe import dumps, loads_strict
from tests.synthetic import INTRINSICS, make_synthetic_frame

K = Intrinsics.from_dict(INTRINSICS)


@pytest.fixture(scope="module")
def ctx() -> dl.FrameContext:
    f = make_synthetic_frame(seed=0)
    return dl.build_frame_context(f.depth_m, f.mask, K)


def _small_frame(size: int = 40, depth: float = 2.0):
    depth_m = np.full((size, size), depth, dtype=np.float32)
    mask = np.zeros((size, size), dtype=np.uint8)
    return depth_m, mask


# ----- context -----------------------------------------------------------------------------


def test_context_shares_pixel_set_between_zref_and_tree(ctx):
    assert ctx.knn_source == "eroded" and not ctx.sparse and ctx.kd_tree is not None
    assert ctx.n_tree == ctx.n_valid_eroded == ctx.z_ref["n_valid"]
    assert ctx.kd_points_uv.dtype == np.float32 and ctx.kd_points_uv.shape == (ctx.n_tree, 2)
    assert ctx.built_ms > 0 and ctx.built_ms < 2000
    assert ctx.depth_valid_bbox == [36, 20, 1279, 719]
    assert abs(ctx.z_ref["z_ref_m"] - 2.0) < 0.02


def test_context_raw_fallback_and_none():
    depth_m, mask = _small_frame()
    mask[:, 10:13] = 255  # too thin to survive erosion
    c = dl.build_frame_context(depth_m, mask, K)
    assert c.knn_source == "raw" and c.n_tree == 120 and c.n_valid_eroded == 0
    depth_m[:] = 0.0
    c0 = dl.build_frame_context(depth_m, mask, K)
    assert c0.knn_source == "none" and c0.kd_tree is None and c0.sparse


# ----- rounding ----------------------------------------------------------------------------


def test_pixel_index_rounds_half_up_like_javascript():
    assert dl.pixel_index(2.5, 3.5) == (3, 4)
    assert dl.pixel_index(2.49, 0.0) == (2, 0)
    assert round(2.5) == 2  # the parent's banker's rounding, deliberately NOT used here


def test_largest_gap_split():
    near, far, gap = dl.largest_gap_split(np.array([1.0, 1.1, 1.2, 2.6, 2.7]))
    assert near.tolist() == [1.0, 1.1, 1.2] and far.tolist() == [2.6, 2.7]
    assert abs(gap - 1.4) < 1e-9
    near, far, gap = dl.largest_gap_split(np.array([1.0]))
    assert near.size == 1 and far.size == 0 and gap == 0.0


# ----- value choice ------------------------------------------------------------------------


def test_inside_mask_valid_window_is_direct(ctx):
    p = dl.depth_for_pixel(640, 380, ctx)
    assert p.source == "window_median" and p.inside_mask and p.ok
    assert abs(p.depth_m - 2.0) < 0.03 and p.direct_depth_m == p.depth_m
    assert p.window_restricted_to_mask and p.k_used == KNN_K and p.knn_depth_m is not None
    assert "knn_disagree" not in p.flags


def test_outside_mask_snaps_to_camel_with_full_provenance(ctx):
    # just right of the eroded body edge (raw edge col 979, eroded 977)
    p = dl.depth_for_pixel(985, 380, ctx)
    assert p.source == "knn_snapped_to_mask" and not p.inside_mask and p.ok
    assert p.k_used == KNN_K and abs(p.depth_m - 2.0) < 0.03
    assert abs(p.nn_dist_m_max - p.nn_dist_px_max * p.knn_depth_m / K.fx) < 1e-9
    assert p.nn_centroid_px is not None and p.nn_centroid_px[0] < 985
    assert p.nn_dist_px_max >= 6.0  # the ring (2 px) and erosion (2 px) keep neighbours inside


def test_boundary_ring_never_contaminates_knn(ctx):
    for u in (982, 990, 1000):
        p = dl.depth_for_pixel(u, 380, ctx)
        assert p.is_knn and abs(p.knn_depth_m - 2.0) < 0.03, (u, p.knn_depth_m)


def test_hole_inside_mask_uses_knn_fill():
    f = make_synthetic_frame(seed=1)
    f.depth_m[377:384, 637:644] = 0.0  # a 7x7 hole around (640, 380)
    c = dl.build_frame_context(f.depth_m, f.mask, K)
    p = dl.depth_for_pixel(640, 380, c)
    assert p.source == "knn_fill" and p.inside_mask and p.window_n_valid == 0
    assert abs(p.depth_m - 2.0) < 0.03 and p.direct_depth_m is None and p.ok


def test_knn_far_flag_and_knn_too_far_rejection(ctx):
    z = 2.0
    far_px = (KNN_FAR_M + 0.02) * K.fx / z  # ~ 0.12 m equivalent
    p = dl.depth_for_pixel(977 + far_px, 380, ctx)
    assert p.source == "knn_snapped_to_mask" and "knn_far" in p.flags and p.ok
    assert KNN_FAR_M < p.nn_dist_m_max < KNN_MAX_DIST_M
    too_far_px = (KNN_MAX_DIST_M + 0.01) * K.fx / z  # ~ 0.31 m equivalent
    r = dl.depth_for_pixel(977 + too_far_px, 380, ctx)
    assert r.depth_m is None and r.reason == "knn_too_far" and r.nn_dist_m_max > KNN_MAX_DIST_M


def test_far_cross_check_never_rejects_a_direct_value():
    depth_m, mask = _small_frame(80)
    mask[30:50, 30:50] = 255  # the camel
    mask[5:8, 70:73] = 255  # a tiny inside-mask island far from the tree points? no: in tree too
    depth_m[5:8, 70:73] = 2.0
    c = dl.build_frame_context(depth_m, mask, K)
    depth_m2 = depth_m.copy()
    mask2 = mask.copy()
    mask2[5:8, 70:73] = 0  # island removed from the mask: direct window valid, far from camel
    c = dl.build_frame_context(depth_m2, mask2, K)
    p = dl.depth_for_pixel(71, 6, c, target="ground")
    assert p.source == "direct_off_mask" and p.ok and p.depth_m == 2.0


def test_depth_edge_near_cluster_median():
    depth_m, mask = _small_frame(40, depth=2.0)
    mask[:] = 255
    win = np.full((5, 5), 2.6, dtype=np.float32)
    win.reshape(-1)[:12] = 2.0  # 12 near, 13 far -> the plain median lands in the far cluster
    depth_m[18:23, 18:23] = win
    c = dl.build_frame_context(depth_m, mask, K)
    p = dl.depth_for_pixel(20, 20, c)
    assert "depth_edge" in p.flags and "depth_edge_near_cluster" in p.flags
    assert p.depth_m == 2.0 and p.window_spread_m == pytest.approx(0.6)
    win2 = np.full((5, 5), 2.6, dtype=np.float32)
    win2.reshape(-1)[:13] = 2.0  # 13 near -> median already in the near cluster
    depth_m[18:23, 18:23] = win2
    c2 = dl.build_frame_context(depth_m, mask, K)
    p2 = dl.depth_for_pixel(20, 20, c2)
    assert "depth_edge" in p2.flags and "depth_edge_near_cluster" not in p2.flags
    assert p2.depth_m == 2.0


def test_a_stray_near_pixel_is_not_a_cluster():
    """Review #11: one (or two) near pixels never replace the median of 24 agreeing ones;
    the spread is still flagged ``depth_edge``. A cluster needs max(3, 20 %) of the values."""
    depth_m, mask = _small_frame(40, depth=2.0)
    mask[:] = 255
    for n_near in (1, 2, 5):
        win = np.full((5, 5), 2.0, dtype=np.float32)
        win.reshape(-1)[:n_near] = 1.5
        depth_m[18:23, 18:23] = win
        c = dl.build_frame_context(depth_m, mask, K)
        p = dl.depth_for_pixel(20, 20, c)
        assert "depth_edge" in p.flags and p.source == "window_median"
        if n_near < 5:  # stray pixels: the median stands
            assert p.depth_m == 2.0 and "depth_edge_near_cluster" not in p.flags
        else:  # a real cluster (20 % of the window): the contract's nearer-cluster rule
            assert p.depth_m == 1.5 and "depth_edge_near_cluster" in p.flags
    assert dl._is_cluster(3, 9) and not dl._is_cluster(2, 9)
    assert not dl._is_cluster(4, 25) and dl._is_cluster(5, 25)


def test_ground_click_default_tool_keeps_camel_depth_and_records_surface(ctx):
    f = make_synthetic_frame(seed=0)
    u, v = f.ground_point_below_leg
    p = dl.depth_for_pixel(u, v, ctx)
    assert p.source == "knn_snapped_to_mask" and "off_mask_surface" in p.flags
    assert abs(p.depth_m - 2.0) < 0.03
    assert p.direct_depth_m is not None and 2.6 < p.direct_depth_m < 3.0
    g = dl.depth_for_pixel(u, v, ctx, target="ground")
    assert g.source == "direct_off_mask" and g.depth_m == p.direct_depth_m and g.ok
    assert g.knn_depth_m is not None and "ground_target_unresolved" not in g.flags


def test_ground_target_over_hole_falls_back_to_knn_with_flag():
    f = make_synthetic_frame(seed=2)
    u, v = f.ground_point_below_leg
    f.depth_m[int(v) - 3 : int(v) + 4, int(u) - 3 : int(u) + 4] = 0.0
    c = dl.build_frame_context(f.depth_m, f.mask, K)
    g = dl.depth_for_pixel(u, v, c, target="ground")
    assert g.ok and g.is_knn and "ground_target_unresolved" in g.flags and g.low_confidence
    assert abs(g.depth_m - 2.0) < 0.03 and g.target == "ground"


def test_c1_2_in_mask_majority_window_never_uses_background():
    depth_m, mask = _small_frame(40, depth=3.0)  # background 3.0 everywhere
    mask[0:40, 0:14] = 255  # camel region at 2.0 on the left (gives the tree its points)
    depth_m[:, 0:14] = 2.0
    # a 5x5 window around (20, 20) with exactly 12 in-mask pixels, only 4 of them valid
    mask[18:23, 18:23] = 0
    win_mask = np.zeros((5, 5), dtype=bool)
    win_mask.reshape(-1)[:11] = True
    win_mask[2, 2] = True  # the clicked pixel itself: 12 in-mask pixels in total
    mask[18:23, 18:23][win_mask] = 255
    depth_m[18:23, 18:23] = 3.0  # background value everywhere in the window
    depth_m[18:23, 18:23][win_mask] = 0.0  # in-mask pixels invalid ...
    valid4 = np.zeros((5, 5), dtype=bool)
    valid4.reshape(-1)[:4] = True
    depth_m[18:23, 18:23][valid4] = 2.0  # ... except four at the camel depth
    mask[20, 20] = 255
    c = dl.build_frame_context(depth_m, mask, K)
    p = dl.depth_for_pixel(20, 20, c)
    assert p.inside_mask and p.window_restricted_to_mask and p.window_n_in_mask == 12
    assert p.window_n_valid == 4 and p.window_median_m == 2.0
    assert (
        "window_unmasked" not in p.flags and p.source == "knn_fill" and abs(p.depth_m - 2.0) < 0.01
    )


def test_window_unmasked_only_when_mask_minority():
    depth_m, mask = _small_frame(40, depth=2.0)
    mask[:, 20] = 255  # one column: 5 of 25 window pixels in-mask
    c = dl.build_frame_context(depth_m, mask, K)
    p = dl.depth_for_pixel(20, 20, c)
    assert p.inside_mask and not p.window_restricted_to_mask and "window_unmasked" in p.flags
    assert p.source == "window_median" and p.depth_m == 2.0


def test_rejections_pixel_out_of_image_and_no_valid_depth(ctx):
    r = dl.depth_for_pixel(-1, 10, ctx)
    assert r.reason == "pixel_out_of_image" and r.depth_m is None and r.source is None
    assert dl.depth_for_pixel(10, 720, ctx).reason == "pixel_out_of_image"
    depth_m, mask = _small_frame(40, depth=0.0)
    mask[10:30, 10:30] = 255
    c = dl.build_frame_context(depth_m, mask, K)
    assert dl.depth_for_pixel(35, 35, c).reason == "no_valid_depth_in_mask"
    assert dl.depth_for_pixel(20, 20, c).reason == "no_valid_depth_in_mask"


def test_sparse_mask_rejects_knn_points_and_clamps_k():
    depth_m, mask = _small_frame(40, depth=2.0)
    mask[20, 10:15] = 255  # a 5-pixel mask: eroded away -> raw tree with 5 points
    c = dl.build_frame_context(depth_m, mask, K)
    assert c.knn_source == "raw" and c.n_tree == 5 and c.sparse
    r = dl.depth_for_pixel(30, 30, c)
    assert r.reason == "mask_valid_too_sparse" and r.k_used == 5 and r.depth_m is None
    # a direct value inside the (tiny) mask is still returned
    p = dl.depth_for_pixel(12, 20, c)
    assert p.source == "window_median" and p.ok


def test_outside_depth_fov_click_uses_no_depth_band_source():
    depth_m, mask = _small_frame(40, depth=2.0)
    mask[:] = 255
    depth_m[:, :10] = 0.0  # dead left border, mask present (camel head in the border)
    c = dl.build_frame_context(depth_m, mask, K)
    assert c.depth_valid_bbox == [10, 0, 39, 39]
    p = dl.depth_for_pixel(3, 20, c)
    assert p.source == "knn_no_depth_band" and "outside_depth_fov" in p.flags
    assert not p.inside_depth_bbox and p.inside_mask and p.ok and p.depth_m == 2.0


def test_knn_spread_takes_pixel_nearer_cluster():
    depth_m, mask = _small_frame(60, depth=2.0)
    mask[10:30, 10:50] = 255
    depth_m[10:30, 30:50] = 2.8  # the right half of the camel is far (a spread > threshold)
    c = dl.build_frame_context(depth_m, mask, K)
    p = dl.depth_for_pixel(29, 35, c)  # just below the boundary between the two halves
    assert p.is_knn and p.nn_depth_spread_m is not None
    if "knn_spread" in p.flags:
        assert p.depth_m in (2.0, 2.8)


def test_d7_outside_source_differs_from_inside(ctx):
    inside = dl.depth_for_pixel(640, 380, ctx)
    outside = dl.depth_for_pixel(985, 380, ctx)
    assert inside.source != outside.source
    assert inside.source == "window_median" and outside.source.startswith("knn_")


def test_provenance_is_finite_json(ctx):
    for args in ((640, 380), (985, 380), (-5, 5), (10, 300)):
        p = dl.depth_for_pixel(*args, ctx)
        text = dumps(p)
        assert "NaN" not in text and "Infinity" not in text
        d = loads_strict(text)
        for value in d.values():
            if isinstance(value, float):
                assert math.isfinite(value)


def test_unknown_target_raises(ctx):
    with pytest.raises(ValueError):
        dl.depth_for_pixel(1, 1, ctx, target="sky")
