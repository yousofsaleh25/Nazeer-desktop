from __future__ import annotations

import dataclasses
import re
from datetime import UTC, datetime
from pathlib import Path

import pytest

from nazeer_engine import session_schema as ss
from nazeer_engine.errors import CorruptFileError, UnsupportedSchemaVersion
from nazeer_engine.jsonsafe import dumps, loads_strict
from nazeer_engine.provenance import DepthProvenance


def _prov(depth: float, source: str = "window_median") -> DepthProvenance:
    return DepthProvenance(
        source=source,
        depth_m=depth,
        inside_mask=True,
        window_n_total=25,
        window_n_valid=20,
        window_median_m=depth,
        knn_depth_m=depth,
        k_used=9,
        nn_dist_px_max=3.0,
        nn_dist_m_max=0.01,
        nn_centroid_px=(1.0, 2.0),
        flags=["knn_disagree"],
    )


def _full_line() -> ss.LineMeasurement:
    return ss.LineMeasurement(
        id=1,
        view="frame",
        name="طول الجسم",
        p1_px=(100.5, 200.25),
        p2_px=(900.0, 210.0),
        p1_3d=(-1.0, 0.1, 2.0),
        p2_3d=(1.0, 0.1, 2.0),
        distance_m=2.0,
        uncertainty_m=0.02,
        rejection_reason="",
        created_at="2026-10-11T10:00:00+00:00",
        measurement_type="distance_3d",
        z_constant_m=None,
        order=3,
        display_color="#BE2C2C",
        note="n",
        targets=["camel", "ground"],
        p1_depth=_prov(2.0),
        p2_depth=_prov(2.0, "knn_snapped_to_mask"),
        endpoint_dz_frac=[0.01, None],
        flags=["knn_far"],
        confidence="low",
        n_points_knn=1,
        uncertainty_basis="sigma_d_1pct+knn_snap",
    )


def _full_angle() -> ss.AngleMeasurement:
    return ss.AngleMeasurement(
        id=2,
        name="زاوية",
        line_a_id=1,
        line_b_id=3,
        angle_deg=47.2,
        rejection_reason="",
        created_at="2026-10-11T10:00:00+00:00",
        measurement_type="angle_3d_3point",
        view="frame",
        vertex_px=(1.0, 2.0),
        endpoint_a_px=(3.0, 4.0),
        endpoint_b_px=(5.0, 6.0),
        vertex_3d=(0.0, 0.0, 2.0),
        endpoint_a_3d=(1.0, 0.0, 2.0),
        endpoint_b_3d=(0.0, 1.0, 2.0),
        order=1,
        display_color="#2C57BE",
        note="",
        targets=["camel", "camel", "camel"],
        vertex_depth=_prov(2.0),
        endpoint_a_depth=_prov(2.0),
        endpoint_b_depth=_prov(2.0),
        flags=[],
        confidence="high",
    )


def _full_curve() -> ss.CurveMeasurement:
    return ss.CurveMeasurement(
        id=3,
        view="frame",
        name="منحنى الرقبة",
        points_px=[(1.0, 2.0), (3.0, 4.0), (5.0, 6.0)],
        measurement_type="curve_3d",
        z_constant_m=None,
        total_length_m=0.45,
        segment_lengths_m=[0.2, 0.25],
        display_color="#81BE2C",
        rejection_reason="",
        created_at="2026-10-11T10:00:00+00:00",
        order=2,
        note="x",
        targets=["camel", "camel", "camel"],
        points_3d=[(0.0, 0.0, 2.0), None, (0.1, 0.1, 2.1)],
        point_depth=[_prov(2.0), _prov(2.0, "knn_fill"), _prov(2.1)],
        point_dz_frac=[0.0, None, 0.05],
        segment_dz_m=[0.0, 0.1],
        segment_flags=[[], ["segment_depth_jump"]],
        cross_check_2d_m=0.44,
        uncertainty_m=0.03,
        n_points=3,
        n_direct=2,
        n_knn=1,
        n_flagged=1,
        flags=["segment_depth_jump"],
        confidence="low",
        shape_note="polyline",
        uncertainty_basis="sigma_d_1pct+knn_snap",
    )


def _full_doc() -> ss.SessionDocument:
    doc = ss.empty_document(
        session_id="20261011_100000_abc123",
        camel_id="A001",
        operator="يوسف",
        notes="ملاحظة",
        view={"rgb": "rgb.png", "read_index": 180},
        view_metadata={"z_ref": {"z_ref_m": 1.93}},
        library_versions={"numpy": "2.4.6"},
    )
    doc.lines = [_full_line()]
    doc.angles = [_full_angle()]
    doc.curves = [_full_curve()]
    doc.status = "finalized"
    doc.revision = 7
    doc.outputs = ss.Outputs(overlay_version=1, overlay_file="overlay_v1.png", overlay_sha256="ab")
    doc.outputs_stale = True
    doc.report_stale = False
    doc.next_measurement_id = 4
    doc.report_inputs = ss.ReportInputs(
        language="ar", rubric_variant="maghateer", names={"judge": "ج", "council": "", "event": "e"}
    )
    return doc


@pytest.mark.parametrize(
    "make,cls",
    [
        (_full_line, ss.LineMeasurement),
        (_full_angle, ss.AngleMeasurement),
        (_full_curve, ss.CurveMeasurement),
    ],
)
def test_row_round_trip_keeps_every_field(make, cls):
    row = make()
    d = row.to_dict()
    assert set(d) == {f.name for f in dataclasses.fields(cls)}, "to_dict must list every field"
    back = cls.from_dict(loads_strict(dumps(d)))
    assert back == row


def test_document_round_trip_keeps_every_field():
    doc = _full_doc()
    d = doc.to_dict()
    assert set(d) == {f.name for f in dataclasses.fields(ss.SessionDocument)}
    text = dumps(d)
    assert "NaN" not in text and "يوسف" in text
    back = ss.SessionDocument.from_dict(loads_strict(text))
    assert back == doc
    assert list(d)[:9] == [
        "schema_version",
        "session_id",
        "camel_id",
        "library_versions",
        "views",
        "view_metadata",
        "lines",
        "angles",
        "curves",
    ]


def test_parent_2_0_file_and_unknown_versions_are_refused():
    d = _full_doc().to_dict()
    d["schema_version"] = "2.0"
    with pytest.raises(UnsupportedSchemaVersion):
        ss.SessionDocument.from_dict(d)
    d["schema_version"] = "3.0"
    with pytest.raises(UnsupportedSchemaVersion):
        ss.SessionDocument.from_dict(d)
    d["schema_version"] = "2.1"
    d["status"] = "weird"
    with pytest.raises(UnsupportedSchemaVersion):
        ss.SessionDocument.from_dict(d)


def test_save_and_load_session(tmp_path: Path):
    doc = _full_doc()
    path = tmp_path / "اختبار" / "session.json"
    data = ss.save_session(doc, path)
    assert data.endswith(b"\n") and [p.name for p in path.parent.iterdir()] == ["session.json"]
    assert ss.load_session(path) == doc
    path.write_bytes(b'{"schema_version": "2.1", "session_id": ')
    with pytest.raises(CorruptFileError):
        ss.load_session(path)
    # parseable JSON of the wrong shape is corrupt too (never an internal error)
    for bad in ([1, 2], {"schema_version": "2.1"}, {**doc.to_dict(), "lines": [{"id": "x"}]}):
        path.write_text(dumps(bad), "utf-8")
        with pytest.raises(CorruptFileError):
            ss.load_session(path)
    path.write_text(dumps({**doc.to_dict(), "schema_version": "2.0"}), "utf-8")
    with pytest.raises(UnsupportedSchemaVersion):
        ss.load_session(path)


def test_nan_in_float_field_becomes_null(tmp_path: Path):
    doc = _full_doc()
    doc.lines[0].uncertainty_m = float("nan")
    path = tmp_path / "session.json"
    ss.save_session(doc, path)
    assert b"NaN" not in path.read_bytes()
    assert ss.load_session(path).lines[0].uncertainty_m is None


def test_session_id_format_and_ordering():
    a = ss.new_session_id(datetime(2026, 10, 11, 9, 0, 0, tzinfo=UTC))
    b = ss.new_session_id(datetime(2026, 10, 11, 9, 0, 1, tzinfo=UTC))
    assert ss.SESSION_ID_RE.match(a) and ss.SESSION_ID_RE.match(b) and a < b
    assert re.match(r"^\d{8}_\d{6}_[0-9a-f]{6}$", ss.new_session_id())
    assert ss.new_session_id() != ss.new_session_id()


def test_flat_measurements_orders_across_families_with_kind_and_family():
    rows = ss.flat_measurements(_full_doc())
    assert [r["id"] for r in rows] == [2, 3, 1]  # orders 1, 2, 3
    assert [r["family"] for r in rows] == ["angles", "curves", "lines"]
    assert [r["kind"] for r in rows] == ["angle_3d_3point", "curve_3d", "distance_3d"]


def test_document_input_sha_ignores_computed_fields():
    doc = _full_doc()
    h0 = ss.document_input_sha256(doc)
    doc.lines[0].distance_m = 9.9
    doc.lines[0].p1_depth = None
    doc.revision = 99
    assert ss.document_input_sha256(doc) == h0
    doc.lines[0].name = "other"
    h1 = ss.document_input_sha256(doc)
    assert h1 != h0
    doc.lines[0].name = "طول الجسم"
    doc.lines[0].p2_px = (901.0, 210.0)
    assert ss.document_input_sha256(doc) not in (h0, h1)


def test_defaults_and_helpers():
    doc = ss.empty_document(session_id="20261011_100000_000000")
    assert doc.status == "open" and doc.revision == 0 and doc.next_measurement_id == 1
    assert doc.outputs == ss.Outputs() and doc.outputs.overlay_file is None
    assert doc.views == {"frame": {}} and doc.frame_view == {} and doc.n_measurements() == 0
    assert doc.engine["version"] and "KNN_K" in doc.engine["constants"]
    assert doc.report_inputs.language == "both" and doc.report_inputs.names["judge"] == ""
    assert ss.family_of("curve_3d") == "curves" and ss.family_of("angle_2d_4point") == "angles"
    with pytest.raises(ValueError):
        ss.family_of("nope")
    assert set(ss.ALL_MEASUREMENT_TYPES) >= {"distance_2d", "distance_3d", "curve_2d", "curve_3d"}


def test_rejected_rows_count_and_parent_defaults():
    line = ss.LineMeasurement.from_dict(
        {"id": 5, "view": "frame", "name": "x", "p1_px": [1, 2], "p2_px": [3, 4]}
    )
    assert line.measurement_type == "distance_3d" and line.targets == ["camel", "camel"]
    assert line.flags == [] and line.p1_depth is None and not line.is_valid
    doc = ss.empty_document(session_id="20261011_100000_000001")
    doc.lines = [line]
    line.rejection_reason = "p1:knn_too_far"
    assert doc.n_rejected() == 1 and doc.n_measurements() == 1
