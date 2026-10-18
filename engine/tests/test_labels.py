from __future__ import annotations

import re

from nazeer_engine import constants, labels
from nazeer_engine.jsonsafe import dumps, loads_strict
from nazeer_engine.provenance import HARD_REJECTIONS, SOFT_FLAGS, SOURCES
from nazeer_engine.session_schema import ALL_MEASUREMENT_TYPES

ARABIC = re.compile(r"[؀-ۿ]")


def test_every_emitted_code_has_both_languages():
    assert labels.coverage_problems() == []
    for code in ALL_MEASUREMENT_TYPES:
        entry = labels.KINDS[code]
        assert ARABIC.search(entry["ar"]) and entry["en"]
    for code in SOURCES:
        assert ARABIC.search(labels.SOURCE_LABELS[code]["ar"])
    for code in SOFT_FLAGS:
        assert labels.FLAG_LABELS[code]["severity"] in ("warn", "info")
    for code in HARD_REJECTIONS:
        assert ARABIC.search(labels.REJECTION_LABELS[code]["ar"])


def test_curve_labels_say_polyline_in_both_languages():
    for kind in ("curve_2d", "curve_3d"):
        assert "polyline" in labels.KINDS[kind]["en"]
        assert "خط منكسر" in labels.KINDS[kind]["ar"]


def test_fmt_len_and_angle():
    assert labels.fmt_len(0.078, "en") == "7.8 cm" and labels.fmt_len(0.078, "ar") == "7.8 سم"
    assert labels.fmt_len(2.0311, "en") == "2.031 m" and labels.fmt_len(2.0311, "ar") == "2.031 م"
    assert labels.fmt_len(None, "en") == "--" and labels.fmt_len(float("nan"), "ar") == "--"
    assert labels.fmt_angle(47.24) == "+47.2°" and labels.fmt_angle(None) == "--"


def test_rejection_parts_split_points_and_codes():
    parts = labels.rejection_parts("p1:knn_too_far / p2:pixel_out_of_image")
    assert [(p["point"], p["code"]) for p in parts] == [
        ("p1", "knn_too_far"),
        ("p2", "pixel_out_of_image"),
    ]
    assert parts[0]["en"].startswith("nearest camel pixels") and ARABIC.search(parts[0]["ar"])
    whole = labels.rejection_parts("too_few_points")
    assert whole == [
        {"point": None, "code": "too_few_points", **labels.REJECTION_LABELS["too_few_points"]}
    ]
    assert labels.rejection_parts("") == []


def test_depth_basis_variants():
    knn = {"source": "knn_snapped_to_mask", "depth_m": 1.93, "nn_dist_m_max": 0.078, "reason": ""}
    basis = labels.depth_basis(knn, kind="distance_3d", z_ref_m=1.93)
    assert basis["en"] == "snapped to camel 7.8 cm" and "مُقرَّب إلى الجمل" in basis["ar"]
    direct = {"source": "window_median", "depth_m": 1.931, "reason": ""}
    assert labels.depth_basis(direct, kind="curve_3d", z_ref_m=1.93)["en"] == "direct 1.931 m"
    plane = labels.depth_basis(None, kind="distance_2d", z_ref_m=1.93)
    assert plane["en"] == "Z_ref 1.930 m"
    rejected = {"source": None, "depth_m": None, "reason": "knn_too_far"}
    assert labels.depth_basis(rejected, kind="distance_3d", z_ref_m=1.93)["en"].startswith(
        "rejected:"
    )
    ground = {"source": "direct_off_mask", "depth_m": 2.75, "reason": ""}
    assert (
        labels.depth_basis(ground, kind="distance_3d", z_ref_m=1.9)["en"]
        == "ground (direct) 2.750 m"
    )
    # C1.4: a click on another surface prints both depths (camel and the surface itself)
    surface = {
        **knn,
        "depth_m": 2.014,
        "nn_dist_m_max": 0.133,
        "direct_depth_m": 2.75,
        "flags": ["off_mask_surface"],
    }
    both = labels.depth_basis(surface, kind="distance_3d", z_ref_m=1.93)
    assert both["en"] == "snapped to camel 0.133 m · camel 2.014 m / surface 2.750 m"
    assert "الجمل" in both["ar"] and "السطح" in both["ar"]


def test_describe_row_for_a_snapped_3d_line():
    row = {
        "family": "lines",
        "kind": "distance_3d",
        "measurement_type": "distance_3d",
        "distance_m": 1.5555,
        "uncertainty_m": 0.0781,
        "flags": ["knn_far"],
        "confidence": "low",
        "rejection_reason": "",
        "p1_depth": {"source": "window_median", "depth_m": 2.0, "flags": [], "reason": ""},
        "p2_depth": {
            "source": "knn_snapped_to_mask",
            "depth_m": 2.0,
            "nn_dist_m_max": 0.134,
            "flags": ["knn_far"],
            "reason": "",
        },
    }
    d = labels.describe_row(row, z_ref_m=2.0)
    assert d["value_text"]["en"] == "1.556 m" and d["uncertainty_text"]["en"] == "± 7.8 cm"
    assert [b["en"] for b in d["depth_basis"]] == ["direct 2.000 m", "snapped to camel 0.134 m"]
    assert [c["code"] for c in d["flags"]] == ["knn_far"] and d["confidence"]["code"] == "low"
    assert d["n_points"] == 2 and d["n_points_knn"] == 1 and not d["rejected"]


def test_describe_row_for_angles_and_rejections():
    angle = {
        "family": "angles",
        "kind": "angle_3d_4point",
        "angle_deg": 47.2,
        "rejection_reason": "",
    }
    d = labels.describe_row(angle, z_ref_m=2.0)
    assert d["value_text"]["en"] == "+47.2°" and d["unit"] == "deg"
    assert d["depth_basis"][0]["en"] == "from the two lines"
    bad = {
        "family": "curves",
        "kind": "curve_3d",
        "total_length_m": None,
        "rejection_reason": "point_2:pixel_out_of_image",
        "point_depth": [],
    }
    d2 = labels.describe_row(bad, z_ref_m=2.0)
    assert (
        d2["rejected"]
        and d2["value_text"]["en"] == "--"
        and d2["rejection"][0]["point"] == "point_2"
    )


def test_labels_payload_is_json_safe_and_complete():
    payload = labels.labels_payload()
    back = loads_strict(dumps(payload))
    for key in ("kinds", "input_kinds", "sources", "flags", "rejections", "statuses", "buckets"):
        assert back[key]
    assert back["constants"]["KNN_K"] == 9 and "angle_4point" in back["input_kinds"]
    # D12 Stage 4: the Compare dialog reads its limits from here, never from its own copy
    assert back["constants"]["COMPARISON_MAX_SESSIONS"] == constants.COMPARISON_MAX_SESSIONS
    assert back["constants"]["COMPARISON_MAX_TITLE"] == constants.COMPARISON_MAX_TITLE
    assert back["constants"]["COMPARISON_MAX_NAME"] == constants.COMPARISON_MAX_NAME
    assert labels.snapped_summary(2, 5)["en"] == "2 of 5 points snapped to the camel (KNN)"
