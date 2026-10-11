from __future__ import annotations

import pytest

from nazeer_engine import report_content as rc
from nazeer_engine.history import HistoryIndex
from nazeer_engine.jsonsafe import dumps, loads_strict
from nazeer_engine.report_model import build_report_model
from nazeer_engine.session_schema import ReportInputs
from nazeer_engine.session_store import SessionStore
from tests.factories import make_candidate

MEASUREMENTS = [
    {
        "id": 1,
        "kind": "curve_3d",
        "name": "منحنى الظهر",
        "points": [[500, 300], [600, 300], [985, 380]],
    },
    {"id": 2, "kind": "distance_2d", "name": "Height 2D", "points": [[700, 250], [700, 550]]},
    {"id": 3, "kind": "distance_3d", "name": "مرفوض", "points": [[400, 300], [1250, 366]]},
    {"id": 4, "kind": "angle_4point", "name": "زاوية", "line_a_id": 2, "line_b_id": 5},
    {"id": 5, "kind": "distance_2d", "name": "أفقي", "points": [[400, 300], [900, 300]]},
]


@pytest.fixture(scope="module")
def model(tmp_path_factory):
    root = tmp_path_factory.mktemp("report") / "root"
    root.mkdir()
    store = SessionStore(
        root, HistoryIndex(root / "history.sqlite"), versions=lambda: {"numpy": "x"}
    )
    doc, _ = store.create(make_candidate(root), camel_id="A001", operator="يوسف")
    doc = store.save_document(
        doc.session_id, 1, {"camel_id": "A001", "operator": "يوسف", "measurements": MEASUREMENTS}
    )
    doc.report_inputs = ReportInputs(
        language="both",
        rubric_variant="maghateer",
        names={"judge": "الحكم أحمد", "council": "المجلس", "event": "مزاين 2026"},
        observations={"colour": "وضح", "age": "ثني"},
    )
    overlay = {
        "file": "overlay_v1.png",
        "version": 1,
        "sha256": "f" * 64,
        "width": 1280,
        "height": 840,
    }
    return doc, build_report_model(doc, overlay=overlay, generated_at="2026-10-11T10:00:00+00:00")


def test_static_content_is_complete():
    for variant in ("mjaheem", "maghateer"):
        rows = rc.rubric_rows(variant)
        assert len(rows) == 11 and sum(r["weight"] for r in rows) == 100
    assert [r[0] for r in rc.ANATOMICAL_REGIONS_27] == list(range(1, 28))
    assert len(rc.COLOUR_OPTIONS) == 6 and rc.COLOUR_OPTIONS[0][0] == "مجاهيم"
    assert len(rc.CERTIFICATION["ar"]) == 2 and len(rc.CERTIFICATION["en"]) == 2
    assert rc.OBSERVATION_KEYS == ("colour", "age", "coat", "gait", "defects", "manual")


def test_report_model_sections(model):
    doc, m = model
    assert m["report_model_version"] == "1.0" and m["generated_at"] == "2026-10-11T10:00:00+00:00"
    assert m["session"]["camel_id"] == "A001" and m["session"]["operator"] == "يوسف"
    assert m["frame"]["read_index"] == 180 and m["frame"]["z_ref"]["statistic"] == "median"
    assert m["frame"]["ground"]["near_plane_row"] == 640 and m["frame"]["candidate"]["rank"] == 1
    assert m["overlay"]["sha256"] == "f" * 64
    assert (
        m["inputs"]["rubric_variant"] == "maghateer"
        and m["inputs"]["names"]["event"] == "مزاين 2026"
    )
    assert m["static"]["rubric"]["rows"][3]["en"] == "Hump + Vertebrae + Tail-base"
    assert len(m["static"]["regions_27"]) == 27 and m["static"]["certification"]["en"]
    assert [w["name"] for w in m["signature_wells"]] == ["الحكم أحمد", "المجلس"]
    assert m["versions"] == {"numpy": "x"} and "KNN_K" in m["constants"]


def test_report_rows_carry_every_detail(model):
    _doc, m = model
    rows = {r["id"]: r for r in m["measurements"]}
    assert [r["id"] for r in m["measurements"]] == [1, 2, 3, 4, 5]
    curve = rows[1]
    assert curve["kind_label"]["en"] == "3D polyline length" and curve["value"] is not None
    assert any("snapped to camel" in b["en"] for b in curve["depth_basis"])
    assert curve["curve"]["cross_check_2d_m"] is not None and curve["n_points_knn"] == 1
    assert rows[2]["depth_basis"][0]["en"].startswith("Z_ref ")
    rejected = rows[3]
    assert rejected["rejected"] and rejected["rejection"][0]["code"] == "knn_too_far"
    assert rejected["value"] is None and rejected["value_text"]["en"] == "--"
    angle = rows[4]
    assert angle["kind"] == "angle_2d_4point" and angle["lines"] == {"a": 2, "b": 5}
    assert angle["value"] == pytest.approx(90.0, abs=1e-6)
    assert m["summary"]["n_rejected"] == 1
    assert m["summary"]["snapped_text"]["en"].endswith("points snapped to the camel (KNN)")


def test_no_beauty_score_and_json_safe(model):
    _doc, m = model

    def walk(node, path=""):
        if isinstance(node, dict):
            for key, value in node.items():
                if "score" in str(key).lower():
                    assert not isinstance(value, (int, float)) or isinstance(value, bool), (
                        path + key
                    )
                walk(value, f"{path}{key}.")
        elif isinstance(node, list):
            for item in node:
                walk(item, path)

    walk(m)
    text = dumps(m)
    assert "NaN" not in text and "Infinity" not in text
    assert loads_strict(text)["static"]["columns"]["judge_score"]["en"] == "Judge Score"
