from __future__ import annotations

import dataclasses
import math

import numpy as np
import pytest

from nazeer_engine import session_compute as sc
from nazeer_engine.constants import KNN_MAX_DIST_M, UNCERTAINTY_BASIS
from nazeer_engine.depthlookup import build_frame_context
from nazeer_engine.errors import Unprocessable
from nazeer_engine.geometry import Intrinsics, assign_color, distance_3d
from nazeer_engine.jsonsafe import dumps
from nazeer_engine.session_schema import empty_document
from tests.synthetic import INTRINSICS, make_synthetic_frame

K = Intrinsics.from_dict(INTRINSICS)
CX, CY = K.cx, K.cy


@pytest.fixture(scope="module")
def ctx():
    f = make_synthetic_frame(seed=0)
    return build_frame_context(f.depth_m, f.mask, K)


def _inp(id_: int, kind: str, points, **kw) -> sc.MeasurementInput:
    d = {"id": id_, "kind": kind, "name": kw.pop("name", f"m{id_}"), "points": points, **kw}
    return sc.MeasurementInput.from_dict(d)


def _row(ctx, inp, order: int = 0, lines=None):
    return sc.compute_row(inp, ctx, order=order, lines_by_id=lines)


# ----- 2D distance -------------------------------------------------------------------------


def test_distance_2d_uses_z_ref_plane_and_relative_uncertainty(ctx):
    z = ctx.z_ref["z_ref_m"]
    row = _row(ctx, _inp(1, "distance_2d", [[400, 300], [900, 300]]))
    assert row.measurement_type == "distance_2d" and row.z_constant_m == z
    assert row.distance_m == pytest.approx(z * 500 / K.fx, rel=1e-12)
    rel = ctx.z_ref["z_mad_mean_abs_dev_m"] / ctx.z_ref["z_median_m"]
    assert row.uncertainty_m == pytest.approx(row.distance_m * rel)
    assert row.p1_3d is None and row.p2_3d is None and row.uncertainty_basis
    assert all(x is not None and x < 0.02 for x in row.endpoint_dz_frac)
    assert row.flags == [] and row.confidence == "high" and row.rejection_reason == ""
    assert row.p1_depth.source is None and row.p1_depth.depth_m is None  # metadata only


def test_distance_2d_ground_endpoint_flags_plane_violation_but_value_ignores_depth(ctx):
    f = make_synthetic_frame(seed=0)
    gu, gv = f.ground_point_below_leg
    row = _row(ctx, _inp(1, "distance_2d", [[gu, 300], [gu, gv]]))
    z = ctx.z_ref["z_ref_m"]
    assert row.distance_m == pytest.approx(z * (gv - 300) / K.fy, rel=1e-12)
    assert row.endpoint_dz_frac[1] > 0.25 and "endpoint_dz" in row.flags
    assert row.confidence == "low"


def test_d7_2d_value_never_reads_depth_but_3d_value_does(ctx):
    inp2 = _inp(1, "distance_2d", [[400, 300], [900, 300]])
    inp3 = _inp(2, "distance_3d", [[400, 300], [900, 300]])
    depth = ctx.depth_m.copy()
    depth[296:305, 896:905] = 3.0  # move one endpoint's surface 1 m back
    ctx2 = dataclasses.replace(ctx, depth_m=depth)
    assert _row(ctx2, inp2).distance_m == _row(ctx, inp2).distance_m
    d_before = _row(ctx, inp3).distance_m
    d_after = _row(ctx2, inp3).distance_m
    assert d_after > d_before + 0.5


def test_distance_2d_rejects_point_outside_image(ctx):
    row = _row(ctx, _inp(1, "distance_2d", [[400, 300], [1300, 300]]))
    assert row.distance_m is None and row.rejection_reason == "p2:pixel_out_of_image"
    assert row.uncertainty_m is None


# ----- 3D distance -------------------------------------------------------------------------


def test_distance_3d_direct_endpoints(ctx):
    row = _row(ctx, _inp(1, "distance_3d", [[400, 300], [900, 300]]))
    assert row.p1_depth.source == "window_median" and row.p2_depth.source == "window_median"
    assert row.distance_m == pytest.approx(distance_3d(row.p1_3d, row.p2_3d))
    assert row.distance_m == pytest.approx(2.0 * 500 / K.fx, abs=0.02)
    assert 0 < row.uncertainty_m < 0.05 and row.uncertainty_basis == "sigma_d_1pct"
    assert row.n_points_knn == 0 and row.confidence == "high"


def test_distance_3d_knn_endpoint_uncertainty_never_below_the_snap(ctx):
    # a vertical line through the principal point: the depth Jacobian of p1 is ~0 here
    row = _row(ctx, _inp(1, "distance_3d", [[CX, CY], [CX, 600]]))
    p2 = row.p2_depth
    assert p2.source == "knn_snapped_to_mask" and "knn_far" in p2.flags
    assert 0.10 < p2.nn_dist_m_max < KNN_MAX_DIST_M
    assert row.uncertainty_m >= p2.nn_dist_m_max
    assert row.uncertainty_basis == UNCERTAINTY_BASIS and row.n_points_knn == 1
    assert row.confidence == "low" and "knn_far" in row.flags
    assert abs(row.p2_3d[2] - 2.0) < 0.03  # the operator's rule: camel depth


def test_distance_3d_ground_target_keeps_the_ground_depth(ctx):
    f = make_synthetic_frame(seed=0)
    gu, gv = f.ground_point_below_leg
    camel = _row(ctx, _inp(1, "distance_3d", [[gu, 300], [gu, gv]]))
    ground = _row(ctx, _inp(2, "distance_3d", [[gu, 300], [gu, gv]], targets=["camel", "ground"]))
    assert camel.p2_depth.source == "knn_snapped_to_mask"
    assert "off_mask_surface" in camel.p2_depth.flags and camel.p2_depth.direct_depth_m > 2.6
    assert ground.p2_depth.source == "direct_off_mask" and ground.p2_3d[2] > 2.6
    assert ground.distance_m > camel.distance_m and ground.targets == ["camel", "ground"]


def test_distance_3d_rejects_knn_too_far_but_keeps_the_good_endpoint(ctx):
    row = _row(ctx, _inp(1, "distance_3d", [[400, 300], [1200, 366]]))
    assert row.distance_m is None and row.uncertainty_m is None
    assert row.rejection_reason == "p2:knn_too_far"
    assert row.p1_3d is not None and row.p2_3d is None and row.p2_depth.reason == "knn_too_far"


# ----- curves ------------------------------------------------------------------------------


def test_curve_2d_polyline_in_the_z_ref_plane(ctx):
    z = ctx.z_ref["z_ref_m"]
    row = _row(ctx, _inp(1, "curve_2d", [[400, 300], [600, 300], [600, 400]]))
    assert row.total_length_m == pytest.approx(z * (200 / K.fx + 100 / K.fy), rel=1e-12)
    assert len(row.segment_lengths_m) == 2 and row.shape_note == "polyline"
    assert row.uncertainty_m > 0 and row.flags == [] and row.confidence == "high"
    assert row.point_dz_frac and all(x < 0.02 for x in row.point_dz_frac)


def test_curve_too_few_points_is_a_rejection_row(ctx):
    for kind in ("curve_2d", "curve_3d"):
        row = _row(ctx, _inp(1, kind, [[400, 300]]))
        assert row.total_length_m is None and row.rejection_reason == "too_few_points"
        empty = _row(ctx, _inp(2, kind, []))
        assert empty.rejection_reason == "too_few_points" and empty.n_points == 0


def test_curve_3d_on_a_flat_body_matches_the_2d_cross_check(ctx):
    pts = [[400, 300], [500, 310], [600, 300], [700, 320]]
    row = _row(ctx, _inp(1, "curve_3d", pts))
    assert row.measurement_type == "curve_3d" and row.n_direct == 4 and row.n_knn == 0
    assert row.total_length_m == pytest.approx(row.cross_check_2d_m, rel=0.02)
    assert row.segment_flags == [[], [], []] and row.n_flagged == 0
    assert len(row.segment_dz_m) == 3 and all(abs(dz) < 0.05 for dz in row.segment_dz_m)
    assert row.confidence == "high" and row.uncertainty_m > 0
    assert row.uncertainty_basis == "sigma_d_1pct"


def test_curve_3d_flags_a_depth_jump_and_keeps_the_row(ctx):
    pts = [[330, 500], [345, 690], [360, 500]]
    row = _row(ctx, _inp(1, "curve_3d", pts, targets=["camel", "ground", "camel"]))
    assert row.total_length_m is not None and row.rejection_reason == ""
    assert row.segment_flags == [["segment_depth_jump"], ["segment_depth_jump"]]
    assert row.n_flagged == 2 and "segment_depth_jump" in row.flags and row.confidence == "low"
    assert row.total_length_m > row.cross_check_2d_m + 0.5
    camel = _row(ctx, _inp(2, "curve_3d", pts))  # default target: the camel's depth
    assert camel.n_flagged == 0 or camel.total_length_m < row.total_length_m


def test_curve_3d_rejects_a_point_outside_the_image(ctx):
    row = _row(ctx, _inp(1, "curve_3d", [[400, 300], [-5, 300], [600, 300]]))
    assert row.total_length_m is None and row.rejection_reason == "point_2:pixel_out_of_image"
    assert row.points_3d[0] is not None and row.points_3d[1] is None


# ----- angles ------------------------------------------------------------------------------


def test_angle_2d_3point_is_exact_in_normalised_coordinates(ctx):
    row = _row(ctx, _inp(1, "angle_2d_3point", [[500, 300], [600, 300], [500, 400]]))
    assert (
        row.angle_deg == pytest.approx(90.0, abs=1e-9) and row.measurement_type == "angle_2d_3point"
    )
    assert row.vertex_px == (500.0, 300.0) and row.confidence == "high"
    degenerate = _row(ctx, _inp(2, "angle_2d_3point", [[500, 300], [500, 300], [500, 400]]))
    assert degenerate.angle_deg is None and degenerate.rejection_reason == "degenerate_ray"


def test_angle_3d_3point_on_the_body_plane(ctx):
    row = _row(ctx, _inp(1, "angle_3d_3point", [[500, 300], [700, 300], [500, 450]]))
    assert row.angle_deg == pytest.approx(90.0, abs=1.5)
    assert row.vertex_depth.source == "window_median" and row.vertex_3d is not None


def test_angle_from_horizontal(ctx):
    flat = _row(ctx, _inp(1, "angle_2d_from_horizontal", [[500, 300], [600, 300]]))
    up = _row(ctx, _inp(2, "angle_2d_from_horizontal", [[500, 300], [500, 200]]))
    assert abs(flat.angle_deg) < 1e-9 and up.angle_deg == pytest.approx(90.0)
    zero = _row(ctx, _inp(3, "angle_2d_from_horizontal", [[500, 300], [500, 300]]))
    assert zero.rejection_reason == "zero_length"


def test_angle_4point_kinds_and_rejections(ctx):
    inputs = sc.parse_inputs(
        [
            {"id": 1, "kind": "distance_3d", "points": [[400, 300], [900, 300]]},
            {"id": 2, "kind": "distance_3d", "points": [[650, 250], [650, 500]]},
            {"id": 3, "kind": "distance_2d", "points": [[400, 300], [900, 300]]},
            {"id": 4, "kind": "distance_2d", "points": [[650, 250], [650, 500]]},
            {"id": 5, "kind": "distance_3d", "points": [[400, 300], [1250, 366]]},
            {"id": 10, "kind": "angle_4point", "line_a_id": 1, "line_b_id": 2},
            {"id": 11, "kind": "angle_4point", "line_a_id": 3, "line_b_id": 4},
            {"id": 12, "kind": "angle_4point", "line_a_id": 1, "line_b_id": 3},
            {"id": 13, "kind": "angle_4point", "line_a_id": 1, "line_b_id": 99},
            {"id": 14, "kind": "angle_4point", "line_a_id": 1, "line_b_id": 5},
        ]
    )
    lines, angles, curves = sc.compute_rows(ctx, inputs)
    by_id = {a.id: a for a in angles}
    assert by_id[10].measurement_type == "angle_3d_4point"
    assert by_id[10].angle_deg == pytest.approx(90.0, abs=1.5)
    assert by_id[11].measurement_type == "angle_2d_4point"
    assert by_id[11].angle_deg == pytest.approx(90.0, abs=1e-9)
    assert by_id[12].rejection_reason == "mixed_line_kinds" and by_id[12].angle_deg is None
    assert by_id[13].rejection_reason == "line_not_found"
    assert by_id[14].rejection_reason == "referenced_line_invalid"
    assert len(lines) == 5 and curves == []


# ----- document level ----------------------------------------------------------------------


def test_order_colors_created_at_and_next_id(ctx):
    doc = empty_document(session_id="20261011_100000_aaaaaa")
    raw = [
        {"id": 5, "kind": "distance_2d", "points": [[400, 300], [900, 300]], "name": "طول"},
        {"id": 2, "kind": "curve_2d", "points": [[400, 300], [500, 300]], "color": "#00ff00"},
        {"id": 9, "kind": "angle_2d_from_horizontal", "points": [[500, 300], [600, 280]]},
    ]
    sc.apply_inputs(doc, ctx, sc.parse_inputs(raw), next_measurement_id=3)
    assert doc.next_measurement_id == 10
    rows = sc.present_rows(doc)
    assert [r["id"] for r in rows] == [5, 2, 9] and [r["order"] for r in rows] == [0, 1, 2]
    assert rows[0]["display_color"] == assign_color(0) and rows[1]["display_color"] == "#00FF00"
    assert rows[2]["display_color"] == assign_color(2)
    created = {r["id"]: r["created_at"] for r in rows}
    doc.lines[0].created_at = "2026-01-01T00:00:00+00:00"
    sc.apply_inputs(doc, ctx, sc.parse_inputs(raw))
    assert {r.id: r.created_at for r in doc.lines}[5] == "2026-01-01T00:00:00+00:00"
    assert created[2] == doc.curves[0].created_at


def test_row_inputs_round_trip_to_identical_values(ctx):
    raw = [
        {"id": 1, "kind": "distance_3d", "points": [[400, 300], [CX, 600]], "note": "n"},
        {
            "id": 2,
            "kind": "curve_3d",
            "points": [[330, 500], [345, 690], [360, 500]],
            "targets": ["camel", "ground", "camel"],
        },
        {"id": 3, "kind": "angle_3d_3point", "points": [[500, 300], [700, 300], [500, 450]]},
        {"id": 4, "kind": "angle_4point", "line_a_id": 1, "line_b_id": 6},
        {"id": 6, "kind": "distance_3d", "points": [[650, 250], [650, 500]]},
        {"id": 7, "kind": "curve_2d", "points": [[400, 300]]},
    ]
    doc = empty_document(session_id="20261011_100000_bbbbbb")
    sc.apply_inputs(doc, ctx, sc.parse_inputs(raw))
    rows = sc.present_rows(doc)
    again = empty_document(session_id="20261011_100000_cccccc")
    sc.apply_inputs(again, ctx, sc.parse_inputs([r["input"] for r in rows]))
    rows2 = sc.present_rows(again)
    for a, b in zip(rows, rows2, strict=True):
        assert a["input"] == b["input"] and a["kind"] == b["kind"]
        for key in (
            "distance_m",
            "total_length_m",
            "angle_deg",
            "uncertainty_m",
            "rejection_reason",
        ):
            assert a.get(key) == b.get(key), (a["id"], key)
    assert rows[3]["input_kind"] == "angle_4point" and rows[3]["kind"] == "angle_3d_4point"
    assert rows[1]["input"]["targets"] == ["camel", "ground", "camel"]
    text = dumps(rows)
    assert "NaN" not in text and "Infinity" not in text


def test_summarize_counts_snapped_points(ctx):
    doc = empty_document(session_id="20261011_100000_dddddd")
    raw = [
        {"id": 1, "kind": "distance_3d", "points": [[400, 300], [CX, 600]]},
        {"id": 2, "kind": "curve_3d", "points": [[400, 300], [500, 300], [985, 380]]},
        {"id": 3, "kind": "distance_2d", "points": [[400, 300], [1300, 300]]},
    ]
    sc.apply_inputs(doc, ctx, sc.parse_inputs(raw))
    s = sc.summarize(doc)
    assert s["n_measurements"] == 3 and s["n_rejected"] == 1
    assert s["n_points"] == 5 and s["n_points_knn"] == 2
    assert s["snapped_text"]["en"] == "2 of 5 points snapped to the camel (KNN)"


# ----- input validation --------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,field",
    [
        ({"id": 0, "kind": "distance_2d", "points": [[1, 1], [2, 2]]}, "id"),
        ({"id": True, "kind": "distance_2d", "points": [[1, 1], [2, 2]]}, "id"),
        ({"id": 1, "kind": "volume", "points": []}, "kind"),
        ({"id": 1, "kind": "distance_3d", "points": [[1, 1]]}, "points"),
        ({"id": 1, "kind": "angle_2d_3point", "points": [[1, 1], [2, 2]]}, "points"),
        ({"id": 1, "kind": "distance_2d", "points": [[1, float("nan")], [2, 2]]}, "points"),
        ({"id": 1, "kind": "distance_2d", "points": [[1, "x"], [2, 2]]}, "points"),
        (
            {"id": 1, "kind": "distance_2d", "points": [[1, 1], [2, 2]], "targets": ["camel"]},
            "targets",
        ),
        (
            {
                "id": 1,
                "kind": "distance_2d",
                "points": [[1, 1], [2, 2]],
                "targets": ["camel", "sky"],
            },
            "targets",
        ),
        ({"id": 1, "kind": "angle_4point", "line_a_id": 2, "line_b_id": 2}, "line_b_id"),
        ({"id": 1, "kind": "angle_4point", "line_a_id": 2}, "line_b_id"),
        (
            {"id": 1, "kind": "angle_4point", "points": [[1, 1]], "line_a_id": 2, "line_b_id": 3},
            "points",
        ),
        ({"id": 1, "kind": "distance_2d", "points": [[1, 1], [2, 2]], "color": "red"}, "color"),
        ({"id": 1, "kind": "distance_2d", "points": [[1, 1], [2, 2]], "name": "x" * 201}, "name"),
    ],
)
def test_invalid_inputs_are_422_with_the_offending_field(raw, field):
    with pytest.raises(Unprocessable) as info:
        sc.MeasurementInput.from_dict(raw, index=0)
    assert info.value.code == "invalid_measurement" and field in info.value.details["problems"]


def test_parse_inputs_rejects_duplicates_and_non_lists():
    with pytest.raises(Unprocessable) as dup:
        sc.parse_inputs(
            [
                {"id": 1, "kind": "distance_2d", "points": [[1, 1], [2, 2]]},
                {"id": 1, "kind": "curve_2d", "points": []},
            ]
        )
    assert dup.value.code == "duplicate_measurement_ids" and dup.value.details["ids"] == [1]
    with pytest.raises(Unprocessable):
        sc.parse_inputs({"id": 1})
    ok = sc.parse_inputs(
        [{"id": 3, "kind": "curve_3d", "points": [[1, 2], [3, 4]], "color": "#abcdef"}]
    )
    assert ok[0].targets == ("camel", "camel") and ok[0].color == "#ABCDEF"


def test_z_ref_missing_is_a_frame_error():
    depth = np.zeros((40, 40), np.float32)
    mask = np.zeros((40, 40), np.uint8)
    mask[10:30, 10:30] = 255
    bad = build_frame_context(depth, mask, K)
    with pytest.raises(Unprocessable) as info:
        _row(bad, _inp(1, "distance_2d", [[15, 15], [20, 20]]))
    assert info.value.code == "frame_no_valid_depth"
    assert math.isnan(float("nan"))
