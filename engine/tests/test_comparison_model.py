"""The comparison model (D12 F2.1, F2.4-F2.7): pure functions, no files."""

from __future__ import annotations

from typing import Any

import pytest

from nazeer_engine import comparison_model as cm
from nazeer_engine import labels
from nazeer_engine.errors import CorruptFileError
from nazeer_engine.jsonsafe import dumps

MEASURED_KEYS = {"value", "distance_m", "total_length_m", "angle_deg", "uncertainty_m"}


def _pair(text: str) -> dict[str, str]:
    return {"ar": text, "en": text}


def _row(
    mid: int,
    name: str,
    kind: str = "distance_3d",
    *,
    value: str = "1.234 m",
    rejected: bool = False,
    n_points: int = 2,
    n_knn: int = 0,
    confidence: str | None = "high",
) -> dict[str, Any]:
    """A row as report model 1.1 writes it (``report_model._report_row``)."""
    return {
        "id": mid,
        "order": mid,
        "kind": kind,
        "name": name,
        "note": "",
        "display_color": "#ff0000",
        "family": "lines",
        "kind_label": labels.label(labels.KINDS, kind),
        "value": None if rejected else 1.234,
        "unit": "m",
        "value_text": _pair("--" if rejected else value),
        "uncertainty_text": _pair("" if rejected else "± 1.2 cm"),
        "depth_basis": [{"point": 1, **_pair("direct 1.930 m")}],
        "flags": [],
        "confidence_label": (
            {"code": confidence, **labels.label(labels.CONFIDENCE_LABELS, confidence)}
            if confidence
            else None
        ),
        "rejected": rejected,
        "rejection": (
            [{"point": "p1", "code": "knn_too_far", **_pair("too far")}] if rejected else []
        ),
        "n_points": n_points,
        "n_points_knn": n_knn,
        "uncertainty_m": 0.012,
    }


def _report_model(rows: list[dict[str, Any]], camel: str = "A001") -> dict[str, Any]:
    return {
        "report_model_version": "1.1",
        "engine_version": "0.1.0",
        "generated_at": "2026-10-17T10:00:00+00:00",
        "frame": {
            "bag_name": "bag006.bag",
            "read_index": 180,
            "texts": {
                "z_ref": _pair("1.930 m"),
                "ground": _pair("row 715"),
                "source": _pair("read index 180"),
            },
        },
        "overlay": {"sha256": "o" * 64},
        "measurements": rows,
        "summary": {"snapped_text": _pair("0 of 2"), "counts_text": _pair("Measurements: 2")},
        "session": {"camel_id": camel},
    }


def _member(position: int, rows: list[dict[str, Any]], camel: str = "A001") -> dict[str, Any]:
    return cm.member_block(
        position,
        session={
            "session_id": f"20261017_10000{position}_abcdef",
            "camel_id": camel,
            "operator": "يوسف",
            "status": "finalized",
            "revision": 3,
            "created_at": "2026-10-17T09:00:00+00:00",
        },
        report_model=_report_model(rows, camel),
        report_model_ref={"file": "report_model_v1.json", "version": 1, "sha256": "m" * 64},
        overlay={
            "file": "overlay_v1.png",
            "version": 1,
            "sha256": "o" * 64,
            "width": 1280,
            "height": 840,
        },
        session_json_sha256="s" * 64,
        input_sha256="i" * 64,
    )


def _walk(obj: Any, path: str = ""):
    if isinstance(obj, dict):
        for key, value in obj.items():
            yield f"{path}.{key}", key, value
            yield from _walk(value, f"{path}.{key}")
    elif isinstance(obj, list):
        for i, value in enumerate(obj):
            yield f"{path}[{i}]", None, value
            yield from _walk(value, f"{path}[{i}]")


# ----- rows ------------------------------------------------------------------------------------


def test_rows_match_by_exact_name_and_kind_in_first_appearance_order():
    a = _member(1, [_row(1, "Height"), _row(2, "Body length"), _row(3, "Hump", "curve_3d")])
    b = _member(2, [_row(7, "Body length"), _row(8, "Neck"), _row(9, "Height")], camel="B002")
    rows, disambiguated = cm.build_rows([a, b])
    assert [(r["name"], r["kind"]) for r in rows] == [
        ("Height", "distance_3d"),
        ("Body length", "distance_3d"),
        ("Hump", "curve_3d"),
        ("Neck", "distance_3d"),
    ]
    height = rows[0]
    assert [c["measurement_id"] if c else None for c in height["cells"]] == [1, 9]
    assert rows[2]["cells"][1] is None and rows[3]["cells"][0] is None  # "—", never 0
    assert [r["row_id"] for r in rows] == [1, 2, 3, 4] and disambiguated == []


def test_2d_and_3d_never_share_a_row_and_names_are_exact():
    a = _member(1, [_row(1, "Height", "distance_2d"), _row(2, "angle", "angle_2d_4point")])
    b = _member(
        2,
        [
            _row(1, "Height", "distance_3d"),
            _row(2, "angle", "angle_3d_4point"),
            _row(3, "height", "distance_2d"),  # case
            _row(4, "Height ", "distance_2d"),  # trailing space
        ],
    )
    rows, _ = cm.build_rows([a, b])
    keys = [(r["name"], r["kind"]) for r in rows]
    assert keys == [
        ("Height", "distance_2d"),
        ("angle", "angle_2d_4point"),
        ("Height", "distance_3d"),
        ("angle", "angle_3d_4point"),
        ("height", "distance_2d"),
        ("Height ", "distance_2d"),
    ]
    for row in rows:
        assert sum(c is not None for c in row["cells"]) == 1


def test_harakat_make_a_separate_row():
    plain = "طول"
    with_damma = "طُول"
    rows, _ = cm.build_rows([_member(1, [_row(1, plain)]), _member(2, [_row(1, with_damma)])])
    assert [r["name"] for r in rows] == [plain, with_damma]


def test_duplicate_names_pair_by_order_and_are_recorded():
    a = _member(1, [_row(1, "Height"), _row(2, "Height")])
    b = _member(2, [_row(5, "Height"), _row(6, "Height"), _row(7, "Height")])
    c = _member(3, [_row(1, "Height")])
    rows, disambiguated = cm.build_rows([a, b, c])
    assert [(r["occurrence"], r["n_occurrences"]) for r in rows] == [(1, 3), (2, 3), (3, 3)]
    assert [r["occurrence_text"]["en"] for r in rows] == ["(1/3)", "(2/3)", "(3/3)"]
    first, second, third = rows
    assert [cell["measurement_id"] if cell else None for cell in first["cells"]] == [1, 5, 1]
    assert [cell["measurement_id"] if cell else None for cell in second["cells"]] == [2, 6, None]
    assert [cell["measurement_id"] if cell else None for cell in third["cells"]] == [None, 7, None]
    assert first["cells"][0]["n_in_session"] == 2 and first["cells"][1]["n_in_session"] == 3
    assert disambiguated == [
        {
            "name": "Height",
            "kind": "distance_3d",
            "pairing": "by_order",
            "counts": [
                {"position": 1, "n": 2},
                {"position": 2, "n": 3},
                {"position": 3, "n": 1},
            ],
        }
    ]
    single, _ = cm.build_rows([_member(1, [_row(1, "Height")]), _member(2, [_row(1, "Height")])])
    assert single[0]["occurrence_text"] is None  # (1/1) is never printed


def test_unnamed_measurements_never_match_across_camels():
    rows, _ = cm.build_rows([_member(1, [_row(4, "")]), _member(2, [_row(4, "")])])
    assert len(rows) == 2 and all(r["unnamed"] for r in rows)
    assert rows[0]["cells"][1] is None and rows[1]["cells"][0] is None
    assert rows[0]["name_text"]["en"] == "Unnamed measurement #4"


def test_cells_are_texts_only_and_honest():
    snapped = _row(1, "Body length", n_points=2, n_knn=1)
    rejected = _row(2, "Hump", rejected=True)
    low = _row(3, "Neck", confidence="low")
    two_d = _row(4, "Height", "distance_2d", n_points=2, n_knn=0)
    member = _member(1, [snapped, rejected, low, two_d])
    rows, _ = cm.build_rows([member])
    cells = [r["cells"][0] for r in rows]
    assert cells[0]["depth_note"]["en"] == "1 of 2 points snapped to the camel (KNN)"
    assert cells[0]["confidence"] is None  # "high" is not printed
    assert cells[1]["value_text"] is None and cells[1]["rejected"] is True  # never "--" or 0
    assert (
        cells[1]["uncertainty_text"] is None and cells[1]["rejection"][0]["code"] == "knn_too_far"
    )
    assert cells[2]["confidence"]["code"] == "low"
    assert cells[3]["depth_note"] is None  # 2D rows never read depth
    model = cm.build_model(
        comparison_id="20261017_100000_abcdef",
        version=1,
        language="both",
        cover={"title": "", "event": "مزاين", "judge": "", "council": ""},
        members=[member, _member(2, [_row(1, "Body length")], camel="B002")],
        created_at="2026-10-17T10:00:00+00:00",
        generated_at="2026-10-17T10:00:00+00:00",
        versions={"numpy": "x"},
        constants={"KNN_K": 9},
    )
    dumps(model)  # finite-only JSON
    for where, key, value in _walk({"members": model["members"], "rows": model["rows"]}):
        assert key not in MEASURED_KEYS, where
        assert not isinstance(value, float), where  # no number from a measurement anywhere


def test_no_ranking_keys_anywhere():
    model = cm.build_model(
        comparison_id="20261017_100000_abcdef",
        version=1,
        language="ar",
        cover={},
        members=[_member(1, [_row(1, "H")]), _member(2, [_row(1, "H")])],
        created_at="t",
        generated_at="t",
        versions={},
        constants={},
    )
    banned = {"rank", "score", "best", "difference", "delta", "percent", "total", "sum", "winner"}
    for where, key, _value in _walk(model):
        assert key is None or key not in banned, where
    assert [m["position"] for m in model["members"]] == [1, 2]  # the operator's order


def test_member_block_reads_the_frozen_texts():
    member = _member(1, [_row(1, "H")])
    assert member["frame"]["texts"]["z_ref"]["en"] == "1.930 m"
    assert member["summary"]["counts_text"]["en"] == "Measurements: 2"
    assert member["texts"]["heading"] == {"ar": "الجمل #1: A001", "en": "Camel #1: A001"}
    assert member["report_model"]["report_model_version"] == "1.1"
    assert member["texts"]["provenance"]["overlay"]["en"].startswith("overlay_v1.png · v1")
    old = _report_model([_row(1, "H")])
    del old["frame"]["texts"]  # a 1.0 model has no frame texts
    with pytest.raises(CorruptFileError):
        cm.member_block(
            1,
            session={"session_id": "s"},
            report_model=old,
            report_model_ref={},
            overlay={},
            session_json_sha256="",
            input_sha256="",
        )
    broken = _report_model([{"name": "no id"}])
    with pytest.raises(CorruptFileError):
        cm.member_rows(broken)


def test_cover_title_default_and_revision():
    assert cm.cover_block({})["title_text"]["en"] == "Camel Measurement Comparison"
    assert cm.cover_block({"title": "  "})["title_text"]["ar"] == "مقارنة قياسات الإبل"
    assert cm.cover_block({"title": "نهائي"})["title_text"] == {"ar": "نهائي", "en": "نهائي"}
    model = cm.build_model(
        comparison_id="c",
        version=1,
        language="ar",
        cover={"judge": "Judge A"},
        members=[_member(1, [_row(1, "H")])],
        created_at="t0",
        generated_at="t0",
        versions={"a": 1},
        constants={},
    )
    revised = cm.revise_model(
        model,
        version=2,
        language="en",
        cover={"judge": "Judge B", "title": "T"},
        generated_at="t1",
        versions={"a": 2},
    )
    assert revised["version"] == 2 and revised["language"] == "en"
    assert revised["members"] == model["members"] and revised["rows"] == model["rows"]
    assert revised["signature_wells"][0]["name"] == "Judge B"
    assert model["signature_wells"][0]["name"] == "Judge A"  # the old version is untouched
    assert cm.required_texts(revised) == ["H", "A001", "T", "Judge B"]


def test_required_texts_are_unique_and_operator_only():
    model = {
        "members": [
            {"camel_id": "A001", "rows": [{"name": "H"}, {"name": ""}, {"name": "H"}]},
            {"camel_id": "A001", "rows": [{"name": "طول"}]},
        ],
        "cover": {"title": "", "event": "مزاين", "judge": "J", "council": ""},
    }
    assert cm.required_texts(model) == ["H", "A001", "طول", "مزاين", "J"]
    assert cm.member_texts(model["members"][1]) == ["طول", "A001"]


# ----- eligibility, approval, staleness -------------------------------------------------------


def _index_row(**over: Any) -> dict[str, Any]:
    row = {
        "index_state": "ok",
        "status": "finalized",
        "outputs_stale": False,
        "overlay_version": 2,
        "report_version": 0,
        "report_overlay_version": 0,
        "report_model_schema": "1.1",
    }
    row.update(over)
    return row


@pytest.mark.parametrize(
    "over,reason",
    [
        ({}, None),
        ({"status": "exported", "report_version": 1, "report_overlay_version": 2}, None),
        ({"index_state": "delete_failed"}, "delete_failed"),
        ({"index_state": "missing_files"}, "files_missing"),
        ({"index_state": "corrupt", "status": ""}, "file_corrupt"),
        ({"status": "open", "overlay_version": 0}, "not_finalized"),
        ({"status": "open", "outputs_stale": True}, "reopened"),
        ({"report_model_schema": "1.0"}, "model_outdated"),
        ({"report_model_schema": ""}, "files_missing"),
        ({"report_model_schema": None}, "files_missing"),
    ],
)
def test_ineligible_reason(over: dict[str, Any], reason: str | None):
    assert cm.ineligible_reason(_index_row(**over)) == reason
    assert reason is None or reason in cm.INELIGIBLE_REASONS


def test_approved_by_seal_needs_every_clause():
    sealed = _index_row(status="exported", report_version=2, report_overlay_version=2)
    assert cm.approved_by_seal(sealed)
    assert not cm.approved_by_seal(_index_row())  # finalized, never sealed
    assert not cm.approved_by_seal({**sealed, "report_overlay_version": 1})  # an older image
    assert not cm.approved_by_seal({**sealed, "outputs_stale": True, "status": "open"})
    # both versions start at 0 and a reopen moves neither: the overlay clause is needed too
    assert not cm.approved_by_seal({**sealed, "overlay_version": 0, "report_overlay_version": 0})


def test_stale_reasons_by_content_only():
    snap = {"revision": 3, "input_sha256": "i", "overlay_version": 2, "overlay_sha256": "o"}
    now = {"index_state": "ok", "status": "exported", "outputs_stale": False, **snap}
    assert cm.stale_reasons(snap, now) == []  # sealed again or report details changed
    assert cm.stale_reasons(snap, None) == ["member_deleted"]
    assert cm.stale_reasons(snap, {"index_state": "missing_files"}) == ["member_deleted"]
    assert cm.stale_reasons(snap, {"index_state": "corrupt"}) == ["member_unreadable"]
    reopened = {**now, "status": "open", "outputs_stale": True}
    assert cm.stale_reasons(snap, reopened) == ["member_reopened"]
    edited = {**reopened, "revision": 4, "input_sha256": "j"}
    assert cm.stale_reasons(snap, edited) == ["member_reopened", "member_edited"]
    refinalized = {**now, "status": "finalized", "overlay_version": 3, "overlay_sha256": "p"}
    assert cm.stale_reasons(snap, refinalized) == ["member_refinalized"]
    same_revision_new_inputs = {**now, "input_sha256": "x"}
    assert cm.stale_reasons(snap, same_revision_new_inputs) == ["member_edited"]
    # an index row the version-2 migration has not refreshed yet has no hashes: unknown, not
    # changed (review, Stage 6); the revision and versions still count
    unrefreshed = {**now, "input_sha256": "", "overlay_sha256": ""}
    assert cm.stale_reasons(snap, unrefreshed) == []
    assert cm.stale_reasons(snap, {**unrefreshed, "revision": 4}) == ["member_edited"]
    assert cm.stale_reasons(snap, {**unrefreshed, "overlay_version": 3}) == ["member_refinalized"]
    for reason in cm.STALE_REASONS + cm.STALE_NOTES:
        assert reason in labels.COMPARISON_STALE_LABELS
