from __future__ import annotations

import threading
from pathlib import Path

import numpy as np
import pytest

from nazeer_engine import fsio
from nazeer_engine.errors import AtomicWriteError, Conflict, NotFound, Unprocessable
from nazeer_engine.history import HistoryIndex
from nazeer_engine.session_schema import SESSION_ID_RE, load_session, save_session
from nazeer_engine.session_store import SessionStore
from tests.factories import make_candidate

MEASUREMENTS = [
    {"id": 1, "kind": "distance_3d", "name": "طول الجسم", "points": [[400, 300], [900, 300]]},
    {"id": 2, "kind": "curve_2d", "name": "منحنى", "points": [[400, 300], [600, 300], [600, 400]]},
]


@pytest.fixture
def store(tmp_path: Path) -> SessionStore:
    root = tmp_path / "بيانات"  # Arabic data root on purpose (C2.9)
    root.mkdir()
    history = HistoryIndex(root / "history.sqlite")
    return SessionStore(root, history, versions=lambda: {"numpy": "2.4.6", "engine_version": "x"})


@pytest.fixture
def created(store: SessionStore):
    ref = make_candidate(store.root)
    doc, state = store.create(ref, camel_id="A001", operator="يوسف")
    return doc, state


def test_create_copies_assets_and_freezes_frame_blocks(store: SessionStore, created):
    doc, state = created
    assert state == "ok" and SESSION_ID_RE.match(doc.session_id)
    sdir = store.session_dir(doc.session_id)
    for name in ("rgb.png", "depth.npy", "mask.png", "intrinsics.json", "stats.json", "thumb.jpg"):
        assert (sdir / name).is_file()
    stored = load_session(sdir / "session.json")
    assert stored.status == "open" and stored.revision == 0 and stored.camel_id == "A001"
    view = stored.frame_view
    assert view["read_index"] == 180 and view["candidate_id"] == "c01_000180"
    assert view["bag_name"] == "20260414_175757-006.bag" and view["bag_fingerprint"] == "a" * 64
    meta = stored.frame_metadata
    assert abs(meta["z_ref"]["z_ref_m"] - 2.0) < 0.02 and meta["z_ref"]["statistic"] == "median"
    assert meta["ground"]["near_plane_row"] == 640 and meta["depth_valid_bbox"] == [
        36,
        20,
        1279,
        719,
    ]
    assert set(meta["frame_sha256"]) == {"rgb.png", "depth.npy", "mask.png", "intrinsics.json"}
    assert meta["knn"]["source"] == "eroded" and meta["candidate"]["rank"] == 1
    assert meta["intrinsics"]["distortion_note"].startswith("recorded")
    assert stored.library_versions == {"numpy": "2.4.6", "engine_version": "x"}
    row = store.history.get(doc.session_id)
    assert row["index_state"] == "ok" and row["camel_id"] == "A001"


def test_create_validates_the_candidate_reference(store: SessionStore):
    with pytest.raises(Unprocessable) as bad:
        store.create({"fingerprint": "x", "params_hash": "y", "candidate_id": "z"})
    assert bad.value.code == "invalid_candidate_ref"
    with pytest.raises(NotFound) as missing:
        store.create(
            {"fingerprint": "f" * 64, "params_hash": "e" * 16, "candidate_id": "c01_000001"}
        )
    assert missing.value.code == "candidate_not_found"
    with pytest.raises(Unprocessable):
        store.create(make_candidate(store.root), camel_id="x" * 65)
    assert list(store.sessions_dir.iterdir()) == []  # nothing half-created


def test_directory_first_then_index_row(store: SessionStore, monkeypatch):
    ref = make_candidate(store.root)

    def boom(*_a, **_k):
        raise RuntimeError("db locked")

    monkeypatch.setattr(store.history, "upsert", boom)
    doc, state = store.create(ref)
    assert state == "unindexed" and (store.session_dir(doc.session_id) / "session.json").is_file()
    monkeypatch.undo()
    assert store.reconcile()["unindexed"] == 1
    assert store.history.get(doc.session_id)["index_state"] == "ok"


def test_save_document_revision_rule_and_replay(store: SessionStore, created):
    doc, _ = created
    payload = {"camel_id": "A001", "operator": "يوسف", "notes": "", "measurements": MEASUREMENTS}
    saved = store.save_document(doc.session_id, 1, payload)
    assert saved.revision == 1 and len(saved.lines) == 1 and len(saved.curves) == 1
    assert saved.lines[0].distance_m == pytest.approx(1.5555, abs=0.02)
    assert saved.next_measurement_id == 3
    path = store.session_dir(doc.session_id) / "session.json"
    mtime = path.stat().st_mtime_ns
    replay = store.save_document(doc.session_id, 1, payload)  # lost response, same request
    assert replay.revision == 1 and path.stat().st_mtime_ns == mtime
    changed = {**payload, "measurements": MEASUREMENTS[:1]}
    with pytest.raises(Conflict) as stale:
        store.save_document(doc.session_id, 1, changed)
    assert stale.value.code == "stale_revision" and stale.value.details["stored_revision"] == 1
    with pytest.raises(Conflict):
        store.save_document(doc.session_id, 0, payload)
    newer = store.save_document(doc.session_id, 5, changed)
    assert newer.revision == 5 and len(newer.curves) == 0
    with pytest.raises(Unprocessable):
        store.save_document(doc.session_id, -1, payload)
    with pytest.raises(Unprocessable):
        store.save_document(doc.session_id, 6, {"measurements": [{"id": 1, "kind": "nope"}]})
    assert store.history.get(doc.session_id)["revision"] == 5


def test_edit_after_finalize_reopens_and_records_manifest(store: SessionStore, created):
    doc, _ = created
    store.save_document(doc.session_id, 1, {"measurements": MEASUREMENTS})
    stored = store.load(doc.session_id)
    stored.status = "exported"
    stored.outputs.overlay_version = 1
    stored.outputs.report_version = 1
    stored.outputs.report_file = "report_v1.pdf"
    stored.outputs.report_sha256 = "c" * 64
    save_session(stored, store.session_dir(doc.session_id) / "session.json")
    manifest = store.session_dir(doc.session_id) / "report.manifest.json"
    fsio.write_json(manifest, {"manifest_version": "1.0", "history": []})
    reopened = store.save_document(doc.session_id, 2, {"measurements": MEASUREMENTS[:1]})
    assert reopened.status == "open" and reopened.outputs_stale and reopened.revision == 2
    events = fsio.read_json(manifest)["history"]
    assert events[-1]["event"] == "reopened" and events[-1]["superseded_pdf"] == "report_v1.pdf"
    assert events[-1]["reason"] == "edited"


def test_explicit_reopen(store: SessionStore, created):
    doc, _ = created
    assert store.reopen(doc.session_id).status == "open"  # no-op when already open
    stored = store.load(doc.session_id)
    stored.status = "finalized"
    stored.outputs.overlay_version = 1
    save_session(stored, store.session_dir(doc.session_id) / "session.json")
    again = store.reopen(doc.session_id)
    assert again.status == "open" and again.outputs_stale


def test_frame_context_is_cached_and_tampering_is_detected(store: SessionStore, created):
    doc, _ = created
    first = store.frame(doc.session_id)
    assert store.frame(doc.session_id) is first and first.ctx.knn_source == "eroded"
    store.evict(doc.session_id)
    sdir = store.session_dir(doc.session_id)
    mask = fsio.read_image(sdir / "mask.png")
    mask[0:10, 0:10] = 255
    fsio.write_image(sdir / "mask.png", np.ascontiguousarray(mask))
    with pytest.raises(Conflict) as changed:
        store.frame(doc.session_id)
    assert changed.value.code == "session_assets_changed" and changed.value.details["files"] == [
        "mask.png"
    ]


def test_asset_paths_are_whitelisted(store: SessionStore, created):
    doc, _ = created
    assert store.asset_path(doc.session_id, "rgb.png").is_file()
    for bad in ("../history.sqlite", "secrets.txt", "overlay_vX.png", ""):
        with pytest.raises(NotFound):
            store.asset_path(doc.session_id, bad)
    with pytest.raises(NotFound):
        store.asset_path(doc.session_id, "overlay_v1.png")  # allowed name, not created yet
    for bad_id in ("..", "20261011", "../../x", "20261011_100000_ZZZZZZ"):
        with pytest.raises(NotFound):
            store.session_dir(bad_id)


def test_delete_moves_to_trash_then_purge(store: SessionStore, created):
    doc, _ = created
    result = store.delete(doc.session_id)
    assert result["deleted"] and Path(result["trashed_to"]).is_dir()
    assert (
        not store.session_dir(doc.session_id).exists() and store.history.get(doc.session_id) is None
    )
    assert store.trash_stats()["count"] == 1
    assert store.purge_trash() == 1 and store.trash_stats()["count"] == 0
    with pytest.raises(NotFound):
        store.delete(doc.session_id)


def test_delete_failure_stays_visible(store: SessionStore, created, monkeypatch):
    doc, _ = created

    def held(_src, _dst, **_kw):
        raise AtomicWriteError("held by the PDF viewer")

    monkeypatch.setattr(fsio, "replace_with_retries", held)
    with pytest.raises(Conflict) as failed:
        store.delete(doc.session_id)
    assert failed.value.code == "delete_failed"
    assert store.session_dir(doc.session_id).is_dir()
    assert store.history.get(doc.session_id)["index_state"] == "delete_failed"


def test_delete_while_another_request_holds_the_session(store: SessionStore, created):
    doc, _ = created
    holding = threading.Event()
    release = threading.Event()

    def hold():
        with store.locked(doc.session_id):
            holding.set()
            release.wait(5)

    t = threading.Thread(target=hold)
    t.start()
    holding.wait(5)
    try:
        with pytest.raises(Conflict) as busy:
            store.delete(doc.session_id)
        assert busy.value.code == "session_busy"
    finally:
        release.set()
        t.join(5)
    assert store.lock(doc.session_id) is store.lock(doc.session_id)  # never evicted


def test_reconcile_through_the_store(store: SessionStore, created):
    doc, _ = created
    import shutil

    shutil.rmtree(store.session_dir(doc.session_id))
    assert store.reconcile()["missing_files"] == 1
    assert store.history.get(doc.session_id)["index_state"] == "missing_files"
    stats = store.sessions_stats()
    assert stats == {"count": 0, "bytes": 0}
