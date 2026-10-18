from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path

import pytest

from nazeer_engine.history import HistoryIndex
from nazeer_engine.jsonsafe import dumps
from nazeer_engine.session_schema import (
    LineMeasurement,
    empty_document,
    load_session,
    save_session,
)


def _doc(session_id: str, *, camel_id: str = "A001", names: tuple[str, ...] = (), status="open"):
    doc = empty_document(
        session_id=session_id,
        camel_id=camel_id,
        operator="يوسف",
        view={"bag_name": "bag006.bag", "bag_path": "E:/b/bag006.bag", "read_index": 180},
    )
    doc.status = status
    for i, name in enumerate(names, start=1):
        doc.lines.append(LineMeasurement(id=i, view="frame", name=name, p1_px=(0, 0), p2_px=(1, 1)))
    return doc


def _write(sessions: Path, doc) -> Path:
    path = sessions / doc.session_id / "session.json"
    save_session(doc, path)
    return path


@pytest.fixture
def index(tmp_path: Path) -> HistoryIndex:
    return HistoryIndex(tmp_path / "سجل" / "history.sqlite")  # an Arabic folder on purpose


def test_pragmas_are_set_on_every_connection(index: HistoryIndex):
    p = index.pragmas()
    assert p["journal_mode"] == "wal" and p["synchronous"] == 1
    assert p["foreign_keys"] == 1 and p["busy_timeout"] == 5000


def test_upsert_get_list_and_search_names(index: HistoryIndex, tmp_path: Path):
    a = _doc("20261011_100000_aaaaaa", names=("طول الجسم", "Hump height"))
    b = _doc("20261011_100001_bbbbbb", camel_id="B002", names=("ارتفاع الحارك",), status="exported")
    for doc in (a, b):
        index.upsert(doc, mtime_ns=1, size=2)
    row = index.get(a.session_id)
    assert row["camel_id"] == "A001" and row["n_measurements"] == 2 and row["read_index"] == 180
    assert row["outputs_stale"] is False and row["index_state"] == "ok"
    items, total = index.list()
    assert total == 2 and {i["session_id"] for i in items} == {a.session_id, b.session_id}
    assert index.list(status="exported")[1] == 1
    assert index.list(camel_id="A001")[0][0]["session_id"] == a.session_id
    found, n = index.list(q="الحارك")
    assert n == 1 and found[0]["session_id"] == b.session_id
    assert index.list(q="hump")[1] == 1  # ASCII search is case-insensitive
    assert index.list(q="100%_")[1] == 0  # LIKE wildcards are escaped
    assert index.list(limit=1)[0][0]["session_id"] in (a.session_id, b.session_id)
    assert len(index.list(limit=1, offset=1)[0]) == 1
    assert [n["name"] for n in index.measurement_names(a.session_id)] == [
        "طول الجسم",
        "Hump height",
    ]


def test_delete_cascades_names_and_mark(index: HistoryIndex):
    doc = _doc("20261011_100000_aaaaaa", names=("x",))
    index.upsert(doc, mtime_ns=1, size=2)
    assert index.mark(doc.session_id, "delete_failed", "locked")
    assert index.get(doc.session_id)["index_state"] == "delete_failed"
    with pytest.raises(ValueError):
        index.mark(doc.session_id, "weird")
    assert index.delete(doc.session_id) and index.get(doc.session_id) is None
    assert index.measurement_names(doc.session_id) == []
    assert not index.delete(doc.session_id)


def test_reconcile_unindexed_refresh_missing_corrupt(index: HistoryIndex, tmp_path: Path):
    sessions = tmp_path / "sessions"
    a = _doc("20261011_100000_aaaaaa")
    b = _doc("20261011_100001_bbbbbb")
    pa = _write(sessions, a)
    _write(sessions, b)
    counts = index.reconcile(sessions, load_session)
    assert counts["unindexed"] == 2 and index.list()[1] == 2
    assert index.reconcile(sessions, load_session)["unchanged"] == 2
    a.camel_id = "A999"
    save_session(a, pa)
    os.utime(pa, ns=(time.time_ns(), time.time_ns() + 5_000_000))
    assert index.reconcile(sessions, load_session)["refreshed"] == 1
    assert index.get(a.session_id)["camel_id"] == "A999"
    import shutil

    shutil.rmtree(sessions / b.session_id)
    assert index.reconcile(sessions, load_session)["missing_files"] == 1
    assert index.get(b.session_id)["index_state"] == "missing_files"  # never auto-deleted
    torn = sessions / "20261011_100002_cccccc"
    torn.mkdir()
    (torn / "session.json").write_bytes(b'{"schema_version": "2.1", ')
    old = sessions / "20261011_100003_dddddd"
    old.mkdir()
    (old / "session.json").write_text(
        dumps({"schema_version": "2.0", "session_id": old.name}), "utf-8"
    )
    counts = index.reconcile(sessions, load_session)
    assert counts["corrupt"] == 2
    assert index.get(torn.name)["index_state"] == "corrupt" and index.get(torn.name)["index_error"]
    (sessions / ".session_tmp").mkdir()  # temp dirs are ignored
    (sessions / "empty_dir").mkdir()  # folders without session.json are ignored
    assert index.reconcile(sessions, load_session)["unindexed"] == 0


def test_one_bad_folder_never_stops_reconcile(index: HistoryIndex, tmp_path: Path):
    """Wrong shapes, overflowing ids and duplicate ids become ``corrupt`` rows, not crashes."""
    sessions = tmp_path / "sessions"
    good = _doc("20261011_100000_aaaaaa", names=("x",))
    _write(sessions, good)
    shapes = {
        "20261011_100001_bbbbbb": lambda d: d["report_inputs"].update({"names": ["judge"]}),
        "20261011_100002_cccccc": lambda d: d["lines"][0].update({"id": 2**63}),
        "20261011_100003_dddddd": lambda d: d["lines"].append(dict(d["lines"][0])),
        "20261011_100004_eeeeee": lambda d: d.pop("session_id"),
    }
    for session_id, damage in shapes.items():
        data = _doc(session_id, names=("y",)).to_dict()
        damage(data)
        (sessions / session_id).mkdir(parents=True)
        (sessions / session_id / "session.json").write_text(dumps(data), "utf-8")
    counts = index.reconcile(sessions, load_session)
    assert counts["unindexed"] == 1 and counts["corrupt"] == 4, counts
    for session_id in shapes:
        row = index.get(session_id)
        assert row["index_state"] == "corrupt" and row["index_error"], session_id
    assert index.list()[1] == 5


def test_reconcile_skips_a_session_whose_lock_is_held(index: HistoryIndex, tmp_path: Path):
    """A delete holds the session lock across rename + row delete; reconcile must not
    re-insert the row in between (it skips busy sessions and counts them)."""
    from contextlib import contextmanager

    sessions = tmp_path / "sessions"
    doc = _doc("20261011_100000_aaaaaa")
    _write(sessions, doc)

    @contextmanager
    def busy(_session_id: str):
        yield False

    counts = index.reconcile(sessions, load_session, session_lock=busy)
    assert counts["busy"] == 1 and index.get(doc.session_id) is None


def test_failed_delete_stays_visible_until_the_file_changes(index: HistoryIndex, tmp_path: Path):
    sessions = tmp_path / "sessions"
    doc = _doc("20261011_100000_aaaaaa")
    _write(sessions, doc)
    index.reconcile(sessions, load_session)
    index.mark(doc.session_id, "delete_failed", "held by viewer")
    index.reconcile(sessions, load_session)
    assert index.get(doc.session_id)["index_state"] == "delete_failed"


def test_rebuild_backup_and_auto_backup(index: HistoryIndex, tmp_path: Path):
    sessions = tmp_path / "sessions"
    for i in range(3):
        _write(sessions, _doc(f"20261011_10000{i}_aaaaa{i}"))
    assert index.rebuild(sessions, load_session)["unindexed"] == 3
    target = tmp_path / "backups" / "h.sqlite"
    assert index.backup(target) > 0
    conn = sqlite3.connect(str(target))
    try:
        assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 3
    finally:
        conn.close()
    first = index.auto_backup(tmp_path / "auto", interval_s=3600, keep=2)
    assert first is not None and first.exists()
    assert index.auto_backup(tmp_path / "auto", interval_s=3600, keep=2) is None  # too recent
    for _ in range(3):
        stale = time.time() - 7200
        for p in (tmp_path / "auto").glob("history_*.sqlite"):
            os.utime(p, (stale, stale))
        time.sleep(1.1)  # distinct timestamps in the file names
        index.auto_backup(tmp_path / "auto", interval_s=3600, keep=2)
    assert len(list((tmp_path / "auto").glob("history_*.sqlite"))) == 2
    assert index.checkpoint()[0] == 0
    index.record_engine_run("run1", 123, {"numpy": "2.4.6"})
    index.record_engine_run("run2", 123, {"numpy": "2.4.6"})
    stats = index.stats()
    assert stats["rows"] == 3 and stats["by_index_state"] == {"ok": 3} and stats["db_bytes"] > 0


# ----- version 2 (D12): the migration, the comparison columns, the filters ----------------------

V1_DDL = """
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY, camel_id TEXT NOT NULL DEFAULT '',
    operator TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '', bag_name TEXT, bag_path TEXT, bag_fingerprint TEXT,
    read_index INTEGER, n_measurements INTEGER NOT NULL DEFAULT 0,
    n_rejected INTEGER NOT NULL DEFAULT 0, outputs_stale INTEGER NOT NULL DEFAULT 0,
    report_stale INTEGER NOT NULL DEFAULT 0, overlay_version INTEGER NOT NULL DEFAULT 0,
    report_version INTEGER NOT NULL DEFAULT 0, session_mtime_ns INTEGER NOT NULL DEFAULT 0,
    session_size INTEGER NOT NULL DEFAULT 0, index_state TEXT NOT NULL DEFAULT 'ok',
    index_error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE measurement_names (
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    measurement_id INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
    PRIMARY KEY (session_id, measurement_id)
);
CREATE TABLE engine_runs (run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, pid INTEGER NOT NULL,
    library_versions TEXT NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO meta(key, value) VALUES ('index_version', '1');
INSERT INTO sessions(session_id, camel_id, status, session_mtime_ns, session_size, index_state)
    VALUES ('20261011_100000_aaaaaa', 'A001', 'open', 111, 222, 'ok'),
           ('20261011_100001_bbbbbb', '', '', 333, 444, 'corrupt'),
           ('20261011_100002_cccccc', 'C003', 'exported', 555, 666, 'delete_failed');
INSERT INTO measurement_names VALUES ('20261011_100000_aaaaaa', 1, 'distance_3d', 'طول');
"""


def _columns(index: HistoryIndex) -> set[str]:
    with index.connect() as conn:
        return {r[1] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()}


def test_a_version_1_index_migrates_in_place(tmp_path: Path):
    path = tmp_path / "history.sqlite"
    conn = sqlite3.connect(str(path))
    conn.executescript(V1_DDL)
    conn.close()
    index = HistoryIndex(path)
    assert index.migration == {
        "from": "1",
        "added_columns": [
            "event",
            "input_sha256",
            "overlay_sha256",
            "report_overlay_version",
            "report_model_schema",
        ],
        "rows_to_refresh": 2,
    }
    assert {"event", "report_model_schema"} <= _columns(index)
    a = index.get("20261011_100000_aaaaaa")
    assert a["session_mtime_ns"] == 0 and a["camel_id"] == "A001"  # refreshed at the next list
    assert index.get("20261011_100001_bbbbbb")["session_mtime_ns"] == 0
    kept = index.get("20261011_100002_cccccc")
    assert kept["index_state"] == "delete_failed" and kept["session_mtime_ns"] == 555
    assert index.measurement_names("20261011_100000_aaaaaa")[0]["name"] == "طول"
    assert index.stats()["index_version"] == 2
    again = HistoryIndex(path)  # a second start changes nothing
    assert again.migration == {"from": "2", "added_columns": [], "rows_to_refresh": 0}


def test_a_1_0_0_engine_on_a_version_2_index_forces_a_refresh(index: HistoryIndex, tmp_path: Path):
    sessions = tmp_path / "sessions"
    doc = _doc("20261011_100000_aaaaaa", names=("x",))
    doc.report_inputs.names["event"] = "مزاين"
    _write(sessions, doc)
    index.reconcile(sessions, load_session)
    assert index.get(doc.session_id)["event"] == "مزاين"
    # what release 1.0.0 does on the same data root: writes version 1 and upserts v1 columns
    with index.write() as conn:
        conn.execute("UPDATE meta SET value = '1' WHERE key = 'index_version'")
        conn.execute("UPDATE sessions SET event = '', input_sha256 = ''")
    reopened = HistoryIndex(index.path)
    assert reopened.migration["from"] == "1" and reopened.migration["rows_to_refresh"] == 1
    assert reopened.reconcile(sessions, load_session)["refreshed"] == 1
    row = reopened.get(doc.session_id)
    assert row["event"] == "مزاين" and row["input_sha256"]


def test_the_migration_keeps_a_comparison_whose_delete_failed(index: HistoryIndex):
    # D12 F2.8: a failed delete stays visible, also after a 1.0.0 engine ran on the root
    # (review, Stage 6: the refresh reset every comparison row)
    with index.write() as conn:
        conn.executemany(
            "INSERT INTO comparisons(comparison_id, file_mtime_ns, file_size, index_state)"
            " VALUES (?, ?, ?, ?)",
            [
                ("20261017_100000_aaaaaa", 111, 1, "ok"),
                ("20261017_100001_bbbbbb", 222, 1, "delete_failed"),
            ],
        )
        conn.execute("UPDATE meta SET value = '1' WHERE key = 'index_version'")
    reopened = HistoryIndex(index.path)
    assert reopened.get_comparison("20261017_100000_aaaaaa")["file_mtime_ns"] == 0
    kept = reopened.get_comparison("20261017_100001_bbbbbb")
    assert kept["index_state"] == "delete_failed" and kept["file_mtime_ns"] == 222


def test_the_comparison_columns(index: HistoryIndex, tmp_path: Path):
    sessions = tmp_path / "sessions"
    doc = _doc("20261011_100000_aaaaaa", status="finalized")
    doc.outputs.overlay_version = 2
    doc.outputs.overlay_sha256 = "o" * 64
    doc.outputs.report_model_file = "report_model_v2.json"
    path = _write(sessions, doc)
    index.reconcile(sessions, load_session)
    row = index.get(doc.session_id)
    assert row["overlay_sha256"] == "o" * 64 and row["report_model_schema"] == ""  # file missing
    (path.parent / "report_model_v2.json").write_text(
        '{"report_model_version": "1.1"}', encoding="utf-8"
    )
    index.upsert(doc, mtime_ns=1, size=1, session_dir=path.parent)
    assert index.get(doc.session_id)["report_model_schema"] == "1.1"
    doc.status, doc.outputs_stale = "open", True
    index.upsert(doc, mtime_ns=1, size=1, session_dir=path.parent)
    assert index.get(doc.session_id)["report_model_schema"] is None  # no current model
    assert index.get(doc.session_id)["n_comparisons"] == 0


def test_event_and_date_filters_compare_instants(index: HistoryIndex):
    stamps = {
        "20261011_100000_aaaaaa": ("2026-10-16T21:30:00+00:00", "مزاين الظفرة"),
        "20261011_100001_bbbbbb": ("2026-10-17T08:00:00+00:00", "مزاين الملك"),
        "20261011_100002_cccccc": ("2026-10-18T10:00:00+00:00", ""),
    }
    for session_id, (created, event) in stamps.items():
        doc = _doc(session_id)
        doc.created_at = doc.updated_at = created
        doc.report_inputs.names["event"] = event
        index.upsert(doc, mtime_ns=1, size=1)

    def ids(**kw) -> list[str]:
        return sorted(r["session_id"] for r in index.list(**kw)[0])

    # 17 October in Riyadh (+03:00) starts at 16 October 21:00 UTC
    day = ids(created_from="2026-10-17T00:00:00+03:00", created_to="2026-10-17T23:59:59+03:00")
    assert day == ["20261011_100000_aaaaaa", "20261011_100001_bbbbbb"]
    assert ids(created_from="2026-10-17T08:00:00Z") == [  # inclusive
        "20261011_100001_bbbbbb",
        "20261011_100002_cccccc",
    ]
    assert ids(created_to="2026-10-16T21:30:00+00:00") == ["20261011_100000_aaaaaa"]
    assert ids(event="مزاين") == ["20261011_100000_aaaaaa", "20261011_100001_bbbbbb"]
    assert ids(event="الملك") == ["20261011_100001_bbbbbb"]
    assert ids(q="الظفرة") == ["20261011_100000_aaaaaa"]  # the search reads the event too
    assert ids(event="%") == []  # LIKE wildcards are escaped
