"""Comparisons through the store (D12 F2.1, F2.6-F2.8): real sessions, finalized by the
session store (the overlay is rendered), in an Arabic data root."""

from __future__ import annotations

import shutil
import threading
from pathlib import Path

import pytest

from nazeer_engine import comparison_store as store_module
from nazeer_engine import fsio
from nazeer_engine.api.views import comparison_row
from nazeer_engine.comparison_model import stale_reasons
from nazeer_engine.comparison_store import ASSET_RE, ComparisonStore
from nazeer_engine.errors import Conflict, EngineError, NotFound, Unprocessable
from nazeer_engine.history import HistoryIndex
from nazeer_engine.jsonsafe import loads_strict
from nazeer_engine.session_schema import save_session
from nazeer_engine.session_store import SessionStore
from tests.factories import make_candidate

MEASUREMENTS = [
    {"id": 1, "kind": "distance_3d", "name": "طول الجسم", "points": [[400, 300], [900, 300]]},
    {"id": 2, "kind": "distance_2d", "name": "Height", "points": [[700, 250], [700, 550]]},
]


class Stores:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.history = HistoryIndex(root / "history.sqlite")
        self.sessions = SessionStore(root, self.history, versions=lambda: {"numpy": "x"})
        self.comparisons = ComparisonStore(
            root, self.history, self.sessions, versions=lambda: {"numpy": "x"}
        )

    def session(self, camel_id: str, measurements=MEASUREMENTS, *, finalize: bool = True):
        doc, _ = self.sessions.create(make_candidate(self.root), camel_id=camel_id)
        doc = self.sessions.save_document(
            doc.session_id, 1, {"camel_id": camel_id, "measurements": measurements}
        )
        if finalize:
            doc = self.sessions.finalize(doc.session_id, 1)
        return doc


@pytest.fixture
def s(tmp_path: Path) -> Stores:
    root = tmp_path / "بيانات"
    root.mkdir()
    return Stores(root)


def _states(s: Stores, cid: str):
    return s.comparisons.member_states(s.comparisons.load(cid))


def _listed(s: Stores, cid: str) -> dict:
    s.sessions.reconcile()
    s.comparisons.reconcile()
    row = s.history.get_comparison(cid)
    members = s.history.comparison_members([cid])[cid]
    return {"row": row, "view": comparison_row(row, members)}


def test_create_snapshots_the_members_in_the_operators_order(s: Stores):
    a = s.session("A001")
    b = s.session(
        "ب٢",
        [
            *MEASUREMENTS,
            {"id": 3, "kind": "distance_3d", "name": "Neck", "points": [[500, 300], [600, 320]]},
        ],
    )
    record, state = s.comparisons.create(
        [b.session_id, a.session_id],
        cover={"title": "نهائي المزاين", "event": "مزاين", "judge": "حكم"},
        language="ar",
        app_meta={"electron": "44.4.5", "app_version": "1.0.0"},
    )
    cid = record["comparison_id"]
    assert state == "ok" and record["status"] == "created" and record["language"] == "ar"
    assert [m["session_id"] for m in record["members"]] == [b.session_id, a.session_id]
    assert [m["position"] for m in record["members"]] == [1, 2]
    assert record["cover"] == {
        "title": "نهائي المزاين",
        "event": "مزاين",
        "judge": "حكم",
        "council": "",
    }
    assert record["versions"]["electron"] == "44.4.5"
    cdir = s.comparisons.comparison_dir(cid)
    model_bytes = fsio.read_bytes(cdir / "comparison_model_v1.json")
    assert fsio.sha256_bytes(model_bytes) == record["outputs"]["model_sha256"]
    model = loads_strict(model_bytes)  # finite-only JSON
    assert [r["name"] for r in model["rows"]] == ["طول الجسم", "Height", "Neck"]
    assert model["rows"][2]["cells"][1] is None  # camel #2 has no "Neck"
    assert model["members"][0]["camel_id"] == "ب٢"
    assert model["members"][1]["overlay"]["sha256"] == a.outputs.overlay_sha256
    assert model["members"][1]["report_model"]["sha256"] == a.outputs.report_model_sha256
    snap = record["members"][1]
    assert snap["input_sha256"] and snap["revision"] == a.revision
    assert snap["approved_by_seal_at_creation"] is False  # finalized, never sealed
    assert set(record["required_report_texts"]) == {
        "طول الجسم",
        "Height",
        "Neck",
        "ب٢",
        "A001",
        "نهائي المزاين",
        "مزاين",
        "حكم",
    }
    manifest = fsio.read_json(cdir / "comparison.manifest.json")
    assert manifest["history"][0]["event"] == "created" and manifest["files"]["pdf"] is None
    assert manifest["members"][0]["session_json"]["sha256_at_creation"]
    states = _states(s, cid)
    assert [st["stale_reasons"] for st in states] == [[], []]
    assert [st["approved_by_seal"] for st in states] == [False, False]
    row = s.history.get_comparison(cid)
    assert row["n_members"] == 2 and row["stale"] is False and row["title"] == "نهائي المزاين"
    assert s.history.get(a.session_id)["n_comparisons"] == 1


def test_every_refused_member_is_listed_with_its_reason(s: Stores):
    good = s.session("A001")
    open_one = s.session("B002", finalize=False)
    reopened = s.session("C003")
    s.sessions.reopen(reopened.session_id)
    missing = "20261017_120000_abcdef"
    with pytest.raises(EngineError) as refused:
        s.comparisons.create([good.session_id, open_one.session_id, reopened.session_id, missing])
    error = refused.value
    assert error.code == "comparison_member_not_final" and error.status == 409
    assert [(m["position"], m["reason"]) for m in error.details["members"]] == [
        (2, "not_finalized"),
        (3, "reopened"),
        (4, "files_missing"),
    ]
    assert error.details["members"][2]["not_found"] is True
    with pytest.raises(EngineError) as gone:
        s.comparisons.create([missing])
    assert gone.value.code == "comparison_member_not_found" and gone.value.status == 404
    assert list(s.comparisons.dir.iterdir()) == []  # nothing half-created


def test_member_files_are_rechecked_at_create(s: Stores):
    a = s.session("A001")
    sdir = s.sessions.session_dir(a.session_id)
    # a report model 1.0 (finalized before 2026-10-12): the comparison cannot read it
    model = fsio.read_json(sdir / a.outputs.report_model_file)
    model["report_model_version"] = "1.0"
    written = fsio.write_json(sdir / a.outputs.report_model_file, model)
    doc = s.sessions.load(a.session_id)
    doc.outputs.report_model_sha256 = fsio.sha256_bytes(written)
    save_session(doc, sdir / "session.json")
    with pytest.raises(EngineError) as outdated:
        s.comparisons.create([a.session_id])
    assert outdated.value.code == "comparison_member_model_outdated"
    assert outdated.value.details["members"][0]["reason"] == "model_outdated"

    b = s.session("B002")
    overlay = s.sessions.session_dir(b.session_id) / b.outputs.overlay_file
    overlay.write_bytes(overlay.read_bytes() + b"\0")  # changed after finalize
    with pytest.raises(EngineError) as changed:
        s.comparisons.create([b.session_id])
    assert changed.value.code == "session_assets_changed"
    assert changed.value.details["members"][0]["reason"] == "files_changed"

    c = s.session("C003")
    s.history.mark(c.session_id, "delete_failed", "a file was open")
    with pytest.raises(EngineError) as half_deleted:
        s.comparisons.create([c.session_id])
    assert half_deleted.value.code == "comparison_member_unavailable"

    d = s.session("D004")
    (s.sessions.session_dir(d.session_id) / "session.json").write_text("{torn", encoding="utf-8")
    with pytest.raises(EngineError) as torn:
        s.comparisons.create([d.session_id])
    assert torn.value.details["members"][0]["reason"] == "file_corrupt"


def test_request_validation(s: Stores, monkeypatch: pytest.MonkeyPatch):
    a = s.session("A001")
    with pytest.raises(Unprocessable) as empty:
        s.comparisons.create([])
    assert empty.value.code == "comparison_no_members"
    with pytest.raises(Unprocessable) as twice:
        s.comparisons.create([a.session_id, a.session_id])
    assert twice.value.code == "comparison_duplicate_members"
    monkeypatch.setattr(store_module, "COMPARISON_MAX_SESSIONS", 1)
    with pytest.raises(Unprocessable) as many:
        s.comparisons.create([a.session_id, "20261017_120000_abcdef"])
    assert many.value.code == "comparison_too_many_members"
    assert many.value.details == {"limit": 1, "sent": 2}
    monkeypatch.undo()
    for bad in ({"title": "x" * 201}, {"judge": "x" * 101}, {"camel": "A"}, {"event": 5}):
        with pytest.raises(Unprocessable) as invalid:
            s.comparisons.create([a.session_id], cover=bad)
        assert invalid.value.code == "invalid_field"
    with pytest.raises(Unprocessable):
        s.comparisons.create([a.session_id], language="fr")
    record, _ = s.comparisons.create([a.session_id], cover={"title": "x" * 200})
    assert record["language"] == "both"


def test_stale_by_content_only_from_files_and_from_the_index(s: Stores):
    docs = [s.session(f"A00{i}") for i in range(1, 6)]
    ids = [d.session_id for d in docs]
    record, _ = s.comparisons.create(ids)
    cid = record["comparison_id"]
    # report details change: session.json is rewritten, the measurements are not -> a note
    s.sessions.patch_report_inputs(ids[0], {"names": {"event": "مزاين"}})
    s.sessions.reopen(ids[1])
    s.sessions.reopen(ids[2])
    s.sessions.finalize(ids[2], docs[2].revision)  # a new image (overlay v2)
    s.sessions.save_document(ids[3], 2, {"camel_id": "A004", "measurements": MEASUREMENTS[:1]})
    s.sessions.delete(ids[4])
    expected = [
        [],
        ["member_reopened"],
        ["member_refinalized"],
        ["member_reopened", "member_edited"],
        ["member_deleted"],
    ]
    states = _states(s, cid)
    assert [st["stale_reasons"] for st in states] == expected
    assert states[0]["notes"] == ["member_session_changed"]
    listed = _listed(s, cid)
    assert [m["stale_reasons"] for m in listed["view"]["members"]] == expected
    assert listed["row"]["stale"] is True and listed["view"]["stale"] is True
    # the SQL predicate (the list's stale filter) agrees with the Python reasons
    assert [r["comparison_id"] for r in s.history.list_comparisons(stale=True)[0]] == [cid]
    assert s.history.list_comparisons(stale=False)[1] == 0
    fresh, _ = s.comparisons.create([ids[0]])
    assert _listed(s, fresh["comparison_id"])["row"]["stale"] is False
    assert [r["comparison_id"] for r in s.history.list_comparisons(stale=False)[0]] == [
        fresh["comparison_id"]
    ]


def test_stale_predicate_matches_python_for_each_member_state(s: Stores):
    """The index twin of stale_reasons, member by member (a session per state)."""
    a = s.session("A001")
    record, _ = s.comparisons.create([a.session_id])
    cid = record["comparison_id"]
    snap = record["members"][0]
    current = s.history.comparison_members([cid])[cid][0]["current"]
    assert stale_reasons(snap, current) == [] and s.history.get_comparison(cid)["stale"] is False
    for column, value in (
        ("revision", 99),
        ("input_sha256", "x"),
        ("overlay_version", 9),
        ("overlay_sha256", "y"),
        ("status", "open"),
        ("outputs_stale", 1),
        ("index_state", "corrupt"),
        ("index_state", "missing_files"),
    ):
        with s.history.write() as conn:
            before = conn.execute(
                f"SELECT {column} FROM sessions WHERE session_id = ?", (a.session_id,)
            ).fetchone()[0]
            conn.execute(
                f"UPDATE sessions SET {column} = ? WHERE session_id = ?", (value, a.session_id)
            )
        current = s.history.comparison_members([cid])[cid][0]["current"]
        assert stale_reasons(snap, current) != [], column
        assert s.history.get_comparison(cid)["stale"] is True, column
        with s.history.write() as conn:
            conn.execute(
                f"UPDATE sessions SET {column} = ? WHERE session_id = ?", (before, a.session_id)
            )
    s.history.delete(a.session_id)
    assert s.history.comparison_members([cid])[cid][0]["current"] is None
    assert s.history.get_comparison(cid)["stale"] is True


def test_members_survive_session_upserts_deletes_and_rebuilds(s: Stores):
    a = s.session("A001")
    record, _ = s.comparisons.create([a.session_id])
    cid = record["comparison_id"]

    def n_members() -> int:
        with s.history.connect() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM comparison_members WHERE comparison_id = ?", (cid,)
            ).fetchone()[0]

    s.sessions.patch_report_inputs(a.session_id, {"names": {"judge": "J"}})  # INSERT OR REPLACE
    assert n_members() == 1
    s.sessions.rebuild_index()  # DELETE FROM sessions
    assert n_members() == 1 and s.history.get(a.session_id)["n_comparisons"] == 1
    s.history.delete(a.session_id)
    assert n_members() == 1
    s.comparisons.rebuild_index()
    assert n_members() == 1


def test_cover_and_language_changes_write_a_new_model(s: Stores):
    a, b = s.session("A001"), s.session("B002")
    record, _ = s.comparisons.create([a.session_id, b.session_id], cover={"judge": "J1"})
    cid = record["comparison_id"]
    cdir = s.comparisons.comparison_dir(cid)
    v1 = fsio.read_bytes(cdir / "comparison_model_v1.json")
    same = s.comparisons.patch_inputs(cid, cover={"judge": "J1"}, language="both")
    assert (
        same["outputs"]["model_version"] == 1 and not (cdir / "comparison_model_v2.json").exists()
    )
    s.sessions.reopen(a.session_id)  # a stale comparison can still change its cover
    changed = s.comparisons.patch_inputs(cid, cover={"title": "T"}, language="en")
    assert changed["outputs"]["model_version"] == 2 and changed["language"] == "en"
    assert changed["cover"] == {"title": "T", "event": "", "judge": "J1", "council": ""}
    assert changed["report_stale"] is False  # nothing sealed yet
    v2 = loads_strict(fsio.read_bytes(cdir / "comparison_model_v2.json"))
    assert v2["version"] == 2 and v2["cover"]["title_text"]["en"] == "T"
    assert v2["members"] == loads_strict(v1)["members"]  # copied, no member file read
    assert fsio.read_bytes(cdir / "comparison_model_v1.json") == v1  # never rewritten
    assert "T" in changed["required_report_texts"]
    events = fsio.read_json(cdir / "comparison.manifest.json")["history"]
    assert [e["event"] for e in events] == ["created", "inputs_changed"]
    assert s.history.get_comparison(cid)["model_version"] == 2
    (cdir / "comparison_model_v2.json").write_bytes(b"{}")
    with pytest.raises(Conflict) as tampered:
        s.comparisons.patch_inputs(cid, cover={"title": "U"})
    assert tampered.value.code == "comparison_assets_changed"


def test_delete_moves_the_folder_to_the_trash(s: Stores, monkeypatch: pytest.MonkeyPatch):
    a = s.session("A001")
    record, _ = s.comparisons.create([a.session_id])
    cid = record["comparison_id"]
    other, _ = s.comparisons.create([a.session_id])

    def locked_file(*_a, **_k):
        raise OSError("a file is open")

    monkeypatch.setattr(store_module.fsio, "replace_with_retries", locked_file)
    with pytest.raises(Conflict) as failed:
        s.comparisons.delete(cid)
    assert failed.value.code == "delete_failed"
    assert s.history.get_comparison(cid)["index_state"] == "delete_failed"
    s.comparisons.reconcile()  # a failed delete stays visible
    assert s.history.get_comparison(cid)["index_state"] == "delete_failed"
    monkeypatch.undo()
    result = s.comparisons.delete(cid)
    assert Path(result["trashed_to"]).name == f"comparison_{cid}"
    assert not s.comparisons.comparison_dir(cid).exists() and s.history.get_comparison(cid) is None
    assert (s.root / "sessions" / a.session_id).is_dir()  # the sessions stay
    with pytest.raises(NotFound) as gone:
        s.comparisons.delete(cid)
    assert gone.value.code == "comparison_not_found"
    outcome: list[str] = []

    def delete_other() -> None:
        try:
            s.comparisons.delete(other["comparison_id"])
            outcome.append("deleted")
        except Conflict as exc:
            outcome.append(exc.code)

    lock = s.comparisons.lock(other["comparison_id"])
    with lock:  # a print or a cover change holds the comparison
        worker = threading.Thread(target=delete_other)
        worker.start()
        worker.join()
    assert outcome == ["comparison_busy"]
    assert s.sessions.purge_trash() == 1


def test_reconcile_corrupt_missing_and_unindexed(s: Stores):
    a = s.session("A001")
    record, _ = s.comparisons.create([a.session_id])
    cid = record["comparison_id"]
    torn = s.comparisons.dir / "20261017_130000_aaaaaa"
    torn.mkdir()
    (torn / "comparison.json").write_text('{"schema_version": "1.0"}', encoding="utf-8")
    other = s.comparisons.dir / "20261017_130001_bbbbbb"
    other.mkdir()
    (other / "comparison.json").write_text('{"schema_version": "9"}', encoding="utf-8")
    counts = s.comparisons.reconcile()
    assert counts["corrupt"] == 2 and counts["unchanged"] == 1
    row = s.history.get_comparison("20261017_130000_aaaaaa")
    assert row["index_state"] == "corrupt" and "members" in row["index_error"]
    assert "schema_version" in s.history.get_comparison("20261017_130001_bbbbbb")["index_error"]
    s.history.delete_comparison(cid)
    assert s.comparisons.reconcile()["unindexed"] == 1
    shutil.rmtree(torn)
    assert s.comparisons.reconcile()["missing_files"] == 1
    assert s.history.get_comparison("20261017_130000_aaaaaa")["index_state"] == "missing_files"
    rebuilt = s.comparisons.rebuild_index()
    assert rebuilt["unindexed"] == 1 and rebuilt["corrupt"] == 1


def test_assets_are_whitelisted(s: Stores):
    a = s.session("A001")
    record, _ = s.comparisons.create([a.session_id])
    cid = record["comparison_id"]
    assert s.comparisons.asset_path(cid, "comparison_model_v1.json").is_file()
    for name in ("../session.json", "rgb.png", "comparison_model_v1.json.bak", ""):
        with pytest.raises(NotFound):
            s.comparisons.asset_path(cid, name)
    with pytest.raises(NotFound):
        s.comparisons.asset_path("../x", "comparison.json")
    assert ASSET_RE.match("report_v2.rejected_20261017T101010123Z_0a1b.pdf")
    with pytest.raises(NotFound):
        s.comparisons.load("20261017_140000_cccccc")
