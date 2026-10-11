"""Finalize -> print -> attach -> re-export -> reopen, end to end through the store (C3.5/C3.7)."""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from pypdf import PdfReader

from nazeer_engine import fsio
from nazeer_engine.errors import Conflict, Unprocessable
from nazeer_engine.history import HistoryIndex
from nazeer_engine.session_schema import document_etag
from nazeer_engine.session_store import ASSET_RE, SessionStore
from tests.factories import make_candidate
from tests.pdf_fixture import build_pdf

MEASUREMENTS = [
    {"id": 1, "kind": "distance_3d", "name": "Body length", "points": [[400, 300], [900, 300]]},
    {"id": 2, "kind": "curve_3d", "name": "منحنى", "points": [[500, 300], [600, 300], [985, 380]]},
]
APP = {"app_version": "0.1.0", "electron": "38.1.0", "chromium": "140.0.7339.80"}


@pytest.fixture
def store(tmp_path: Path) -> SessionStore:
    root = tmp_path / "root"
    root.mkdir()
    return SessionStore(
        root, HistoryIndex(root / "history.sqlite"), versions=lambda: {"numpy": "x"}
    )


def _session(store: SessionStore, camel_id: str = "A001"):
    doc, _ = store.create(make_candidate(store.root), camel_id=camel_id)
    return store.save_document(
        doc.session_id, 1, {"camel_id": camel_id, "measurements": MEASUREMENTS}
    )


def _printed_pdf(store: SessionStore, doc, *, tamper: bool = False) -> bytes:
    """What the app's printToPDF would upload: a page embedding the approved overlay pixels.
    (Latin text only: Arabic extraction is covered by the realpdf tests.)"""
    png = fsio.read_bytes(store.session_dir(doc.session_id) / doc.outputs.overlay_file)
    with Image.open(io.BytesIO(png)) as im:
        rgb = np.asarray(im.convert("RGB")).copy()
    if tamper:
        rgb[5, 5, 1] ^= 0x10
    return build_pdf(image_rgb=rgb, texts=["Body length", "A001"])


def _attach(store: SessionStore, doc, pdf: bytes | None = None, **kw):
    """Upload as the app does: both shas of what was printed; the Latin fixture cannot carry
    the Arabic name, so the text probe is soft here unless a test says otherwise."""
    kw.setdefault("expected_overlay_sha256", doc.outputs.overlay_sha256)
    kw.setdefault("expected_report_model_sha256", doc.outputs.report_model_sha256)
    kw.setdefault("require_text", False)
    return store.attach_report(
        doc.session_id, pdf if pdf is not None else _printed_pdf(store, doc), **kw
    )


def test_finalize_requires_a_camel_id(store: SessionStore):
    doc = _session(store, camel_id="")
    with pytest.raises(Unprocessable) as info:
        store.finalize(doc.session_id, 1)
    assert info.value.code == "camel_id_required"


def test_finalize_renders_once_and_is_idempotent(store: SessionStore):
    doc = _session(store)
    with pytest.raises(Conflict) as stale:
        store.finalize(doc.session_id, 0)
    assert stale.value.code == "stale_revision"
    sealed = store.finalize(
        doc.session_id,
        1,
        report_inputs={"language": "ar", "rubric_variant": "maghateer", "names": {"judge": "J"}},
        app_meta=APP,
    )
    sdir = store.session_dir(doc.session_id)
    out = sealed.outputs
    assert sealed.status == "finalized" and out.overlay_version == 1
    assert out.overlay_file == "overlay_v1.png" and out.report_model_version == 1
    assert fsio.sha256_file(sdir / "overlay_v1.png") == out.overlay_sha256
    assert (out.overlay_width, out.overlay_height) == (1280, 840)
    model = fsio.read_json(sdir / out.report_model_file)
    assert out.report_model_file == "report_model_v1.json"
    assert model["inputs"]["rubric_variant"] == "maghateer"
    assert model["overlay"]["sha256"] == out.overlay_sha256
    assert model["overlay"]["frame_height"] == 720 and model["overlay"]["footer_px"] == 120
    assert model["session"]["status"] == "finalized" and len(model["measurements"]) == 2
    assert sealed.library_versions["electron"] == "38.1.0"
    manifest = fsio.read_json(sdir / "report.manifest.json")
    assert manifest["files"]["overlay"]["sha256"] == out.overlay_sha256
    assert manifest["files"]["session_json"]["sha256_finalized"] == fsio.sha256_file(
        sdir / "session.json"
    )
    assert manifest["history"][-1]["event"] == "finalized"
    assert manifest["render"]["native_text_layout"]
    again = store.finalize(doc.session_id, 1)
    assert again.outputs.overlay_version == 1 and again.outputs.overlay_sha256 == out.overlay_sha256
    with pytest.raises(Unprocessable):
        store.finalize(doc.session_id, 1, report_inputs={"language": "fr"})


def test_save_and_finalize_in_one_call(store: SessionStore):
    doc = _session(store)
    payload = {"measurements": MEASUREMENTS[:1]}  # camel_id omitted: the stored one is kept
    sealed = store.finalize(doc.session_id, 2, document=payload)
    assert sealed.revision == 2 and sealed.status == "finalized" and len(sealed.curves) == 0
    assert sealed.camel_id == "A001"


def test_attach_report_seals_the_pdf_and_reexport_versions(store: SessionStore):
    doc = store.finalize(_session(store).session_id, 1)
    sdir = store.session_dir(doc.session_id)
    with pytest.raises(Conflict) as wrong:
        _attach(store, doc, expected_overlay_sha256="0" * 64)
    assert wrong.value.code == "overlay_sha_mismatch"
    exported, probe = _attach(store, doc, overlay_version=1, app_meta=APP)
    assert probe["verdict"] == "PASS" and probe["attachments_ok"]
    assert probe["soft_failures"] == ["text_probe_failed"]  # the Arabic curve name
    assert exported.status == "exported" and exported.outputs.report_file == "report_v1.pdf"
    assert exported.outputs.report_overlay_version == 1
    assert exported.outputs.report_model_version_sealed == 1
    pdf = fsio.read_bytes(sdir / "report_v1.pdf")
    assert fsio.sha256_bytes(pdf) == exported.outputs.report_sha256
    reader = PdfReader(io.BytesIO(pdf))
    attached = reader.attachments
    assert set(attached) == {"overlay_v1.png", "session.json", "report_model.json"}
    assert fsio.sha256_bytes(attached["report_model.json"][0]) == doc.outputs.report_model_sha256
    assert reader.metadata["/NazeerReportModelSha256"] == doc.outputs.report_model_sha256
    manifest = fsio.read_json(sdir / "report.manifest.json")
    assert manifest["files"]["pdf"]["file"] == "report_v1.pdf"
    assert manifest["files"]["pdf"]["report_model_version"] == 1
    assert manifest["printer"]["electron"] == "38.1.0"
    sj = manifest["files"]["session_json"]
    assert sj["sha256_attached"] == fsio.sha256_bytes(attached["session.json"][0])
    assert sj["sha256_after_export"] == fsio.sha256_file(sdir / "session.json")
    assert manifest["history"][-1]["event"] == "exported"
    again, _ = _attach(store, doc)
    assert again.outputs.report_file == "report_v2.pdf" and (sdir / "report_v1.pdf").is_file()
    assert fsio.read_json(sdir / "report.manifest.json")["history"][-1]["event"] == "re-exported"
    assert store.history.get(doc.session_id)["status"] == "exported"


def test_drifted_pdf_is_refused_and_kept_for_forensics(store: SessionStore):
    doc = store.finalize(_session(store).session_id, 1)
    sdir = store.session_dir(doc.session_id)
    with pytest.raises(Conflict) as drift:
        _attach(store, doc, _printed_pdf(store, doc, tamper=True))
    assert drift.value.code == "overlay_drift"
    rejected = drift.value.details["rejected_file"]
    assert (sdir / rejected).is_file() and rejected.startswith("report_v1.rejected_")
    assert store.asset_path(doc.session_id, rejected).is_file()
    assert drift.value.details["probe"]["pixel"]["min_abs_diff"] > 0
    assert store.load(doc.session_id).status == "finalized"
    events = fsio.read_json(sdir / "report.manifest.json")["history"]
    assert events[-1]["event"] == "report_rejected"


def test_text_and_font_probes_are_strict_by_default(store: SessionStore):
    """B39: a page missing an operator string is refused unless the caller relaxes it; two
    refusals in the same second keep two evidence files."""
    doc = store.finalize(_session(store).session_id, 1)
    names = set()
    for _ in range(2):
        with pytest.raises(Conflict) as strict:
            _attach(store, doc, require_text=True)
        assert strict.value.code == "text_probe_failed"
        names.add(strict.value.details["rejected_file"])
    assert len(names) == 2 and all(ASSET_RE.match(n) for n in names)
    no_plex = build_pdf(image_rgb=None, texts=["x"], plex_basefont=None)
    with pytest.raises(Conflict) as font:
        _attach(store, doc, no_plex)
    assert font.value.code in ("overlay_missing", "font_probe_failed")


def test_upload_must_name_the_current_report_model(store: SessionStore):
    """Review #2: the page printed from model v1 cannot be sealed after the inputs changed."""
    doc = store.finalize(_session(store).session_id, 1, report_inputs={"names": {"judge": "A"}})
    sdir = store.session_dir(doc.session_id)
    printed_v1 = _printed_pdf(store, doc)
    patched = store.patch_report_inputs(doc.session_id, {"names": {"judge": "B"}})
    assert patched.outputs.report_model_version == 2
    assert patched.outputs.report_model_file == "report_model_v2.json"
    assert fsio.sha256_file(sdir / "report_model_v1.json") == doc.outputs.report_model_sha256
    with pytest.raises(Conflict) as stale:
        _attach(store, doc, printed_v1)  # names model v1
    assert stale.value.code == "report_model_mismatch"
    assert stale.value.details["report_model_version"] == 2
    with pytest.raises(Unprocessable) as missing:
        _attach(store, patched, expected_report_model_sha256=None)
    assert missing.value.code == "report_model_sha_required"
    sealed, _ = _attach(store, patched)
    attached = PdfReader(io.BytesIO(fsio.read_bytes(sdir / sealed.outputs.report_file)))
    model = fsio.read_json(sdir / "report_model_v2.json")
    assert model["inputs"]["names"]["judge"] == "B"
    assert attached.attachments["report_model.json"][0] == fsio.read_bytes(
        sdir / "report_model_v2.json"
    )


def test_report_inputs_change_marks_an_exported_pdf_stale(store: SessionStore):
    doc = store.finalize(_session(store).session_id, 1)
    _attach(store, doc)
    before = store.load(doc.session_id)
    same = store.patch_report_inputs(doc.session_id, {"language": before.report_inputs.language})
    assert not same.report_stale and same.outputs.report_model_version == 1  # a no-op
    assert same.updated_at == before.updated_at
    patched = store.patch_report_inputs(doc.session_id, {"names": {"event": "مزاين 2026"}})
    assert (
        patched.report_stale
        and patched.outputs.report_model_sha256 != before.outputs.report_model_sha256
    )
    assert patched.outputs.overlay_version == 1  # the overlay never changes for report inputs
    model = fsio.read_json(store.session_dir(doc.session_id) / patched.outputs.report_model_file)
    assert set(model["overlay"]) >= {"frame_height", "footer_px", "sha256", "width", "height"}
    reprinted, _ = _attach(store, patched, _printed_pdf(store, patched))
    assert not reprinted.report_stale and reprinted.outputs.report_version == 2
    assert reprinted.outputs.report_model_version_sealed == 2
    with pytest.raises(Unprocessable):
        store.patch_report_inputs(doc.session_id, {"observations": {"unknown": "x"}})
    open_doc = _session(store)
    assert (
        store.patch_report_inputs(open_doc.session_id, {"language": "en"}).report_inputs.language
        == "en"
    )


def test_edit_after_export_reopens_and_refinalize_versions_the_overlay(store: SessionStore):
    doc = store.finalize(_session(store).session_id, 1)
    _attach(store, doc)
    sdir = store.session_dir(doc.session_id)
    edited = store.save_document(doc.session_id, 2, {"measurements": MEASUREMENTS[:1]})
    assert edited.status == "open" and edited.outputs_stale and edited.report_stale
    manifest = fsio.read_json(sdir / "report.manifest.json")
    assert manifest["status"] == "open"  # the manifest follows the reopen (review #18)
    assert manifest["files"]["pdf"]["superseded_at"]
    with pytest.raises(Conflict) as not_final:
        _attach(store, edited, b"%PDF-1.7")
    assert not_final.value.code == "status_not_finalized"
    refinal = store.finalize(doc.session_id, 2)
    assert refinal.outputs.overlay_file == "overlay_v2.png" and (sdir / "overlay_v1.png").is_file()
    assert refinal.outputs.report_model_file == "report_model_v2.json" and not refinal.outputs_stale
    # review #3: the report still on file was printed from overlay v1 — it is stale
    assert refinal.report_stale and refinal.outputs.report_overlay_version == 1
    events = [e["event"] for e in fsio.read_json(sdir / "report.manifest.json")["history"]]
    assert events == ["finalized", "exported", "reopened", "finalized"]
    exported, _ = _attach(store, refinal)
    assert not exported.report_stale and exported.outputs.report_overlay_version == 2


def test_an_identical_save_never_reopens_a_sealed_session(store: SessionStore):
    """Review #6: a debounce flush of an unchanged document must not supersede the PDF."""
    doc = store.finalize(_session(store).session_id, 1)
    _attach(store, doc)
    same = store.save_document(
        doc.session_id, 2, {"camel_id": "A001", "measurements": MEASUREMENTS}
    )
    assert same.status == "exported" and same.revision == 1 and not same.outputs_stale
    events = [
        e["event"]
        for e in fsio.read_json(store.session_dir(doc.session_id) / "report.manifest.json")[
            "history"
        ]
    ]
    assert "reopened" not in events


def test_omitted_text_fields_keep_their_values(store: SessionStore):
    """Review #13: a measurements-only save never wipes the camel id, operator or notes."""
    doc, _ = store.create(make_candidate(store.root), camel_id="A001", operator="op", notes="n")
    sid = doc.session_id
    kept = store.save_document(sid, 1, {"measurements": MEASUREMENTS})
    assert (kept.camel_id, kept.operator, kept.notes) == ("A001", "op", "n")
    kept = store.save_document(sid, 2, {"camel_id": None, "measurements": MEASUREMENTS[:1]})
    assert kept.camel_id == "A001"
    cleared = store.save_document(sid, 3, {"camel_id": "", "measurements": MEASUREMENTS[:1]})
    assert cleared.camel_id == "" and cleared.operator == "op"


def test_a_replay_wins_over_if_match_and_a_stale_etag_is_refused(store: SessionStore):
    """Review #5: the C3.4 replay guarantee holds for clients that send If-Match."""
    doc, _ = store.create(make_candidate(store.root), camel_id="A001")
    sid, etag0 = doc.session_id, document_etag(doc)
    payload = {"measurements": MEASUREMENTS}
    saved = store.save_document(sid, 1, payload, if_match=etag0)
    replay = store.save_document(sid, 1, payload, if_match=etag0)  # the response was lost
    assert replay.revision == 1 and document_etag(replay) == document_etag(saved)
    with pytest.raises(Conflict) as stale:
        store.save_document(sid, 2, {"measurements": MEASUREMENTS[:1]}, if_match=etag0)
    assert stale.value.code == "stale_revision" and stale.value.details["etag"]
    ok = store.save_document(
        sid, 2, {"measurements": MEASUREMENTS[:1]}, if_match=document_etag(saved)
    )
    assert ok.revision == 2
    assert store.save_document(sid, 3, payload, if_match="*").revision == 3
    # the ETag moves with every persisted change, not only the revision (review #16)
    before = document_etag(store.load(sid))
    sealed = store.finalize(sid, 3)
    assert sealed.revision == 3 and document_etag(sealed) != before
    assert document_etag(store.load(sid)) == document_etag(sealed)  # stable across loads


def test_measurement_ids_are_never_reused(store: SessionStore):
    """Review #17: deleting the newest measurements does not hand their ids out again."""
    doc, _ = store.create(make_candidate(store.root), camel_id="A001")
    sid = doc.session_id
    assert store.save_document(sid, 1, {"measurements": MEASUREMENTS}).next_measurement_id == 3
    shrunk = store.save_document(sid, 2, {"measurements": MEASUREMENTS[:1]})
    assert shrunk.next_measurement_id == 3
    assert (
        store.save_document(
            sid, 3, {"measurements": [], "next_measurement_id": 9}
        ).next_measurement_id
        == 9
    )
