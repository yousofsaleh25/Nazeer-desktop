"""``history.sqlite`` — a derived, rebuildable index of ``sessions/*/session.json`` and
``comparisons/*/comparison.json`` (C3.3, D12 F2.8).

The files are authoritative; this index only makes History fast to list and to search
(including operator-given measurement names). Rules: one connection per call, WAL +
``synchronous=NORMAL`` + ``foreign_keys=ON`` + ``busy_timeout=5000`` on every connection,
explicit ``BEGIN IMMEDIATE`` for writes, the engine process is the single writer (uvicorn
``--workers 1``), Electron never opens the file, reconcile on startup and before every list,
backups through ``Connection.backup()``.

Version 2 (D12) adds the ``comparisons`` and ``comparison_members`` tables and the sessions'
columns a comparison needs (event, input hash, overlay hash, report-overlay version, report
model schema). ``comparison_members`` has **no foreign key to ``sessions``**: an upsert is an
``INSERT OR REPLACE``, which SQLite carries out as a delete and would cascade into the
members. The migration runs in one transaction: it reads the stored version first, adds only
the columns ``PRAGMA table_info`` lacks, and — when the stored version is not 2 (a new file,
v1, or a 1.0.0 engine that ran on this data root since) — forces a refresh of every ``ok`` and
``corrupt`` row; a ``delete_failed`` row stays visible.
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager, nullcontext
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .constants import HISTORY_INDEX_VERSION
from .errors import CorruptFileError, EngineError
from .fsio import read_json

DDL = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    camel_id TEXT NOT NULL DEFAULT '',
    operator TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    bag_name TEXT,
    bag_path TEXT,
    bag_fingerprint TEXT,
    read_index INTEGER,
    n_measurements INTEGER NOT NULL DEFAULT 0,
    n_rejected INTEGER NOT NULL DEFAULT 0,
    outputs_stale INTEGER NOT NULL DEFAULT 0,
    report_stale INTEGER NOT NULL DEFAULT 0,
    overlay_version INTEGER NOT NULL DEFAULT 0,
    report_version INTEGER NOT NULL DEFAULT 0,
    session_mtime_ns INTEGER NOT NULL DEFAULT 0,
    session_size INTEGER NOT NULL DEFAULT 0,
    index_state TEXT NOT NULL DEFAULT 'ok',
    index_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_camel ON sessions(camel_id);
CREATE TABLE IF NOT EXISTS measurement_names (
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    measurement_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (session_id, measurement_id)
);
CREATE TABLE IF NOT EXISTS engine_runs (
    run_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    pid INTEGER NOT NULL,
    library_versions TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comparisons (
    comparison_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    event TEXT NOT NULL DEFAULT '',
    judge TEXT NOT NULL DEFAULT '',
    council TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    n_members INTEGER NOT NULL DEFAULT 0,
    model_version INTEGER NOT NULL DEFAULT 0,
    report_version INTEGER NOT NULL DEFAULT 0,
    report_stale INTEGER NOT NULL DEFAULT 0,
    file_mtime_ns INTEGER NOT NULL DEFAULT 0,
    file_size INTEGER NOT NULL DEFAULT 0,
    index_state TEXT NOT NULL DEFAULT 'ok',
    index_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_comparisons_created ON comparisons(created_at DESC);
CREATE TABLE IF NOT EXISTS comparison_members (
    comparison_id TEXT NOT NULL REFERENCES comparisons(comparison_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    camel_id TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 0,
    input_sha256 TEXT NOT NULL DEFAULT '',
    overlay_version INTEGER NOT NULL DEFAULT 0,
    overlay_sha256 TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (comparison_id, position)
);
CREATE INDEX IF NOT EXISTS idx_comparison_members_session ON comparison_members(session_id);
"""
# version 2's sessions columns, added to a version-1 file by the migration
SESSION_COLUMNS_V2: tuple[tuple[str, str], ...] = (
    ("event", "TEXT NOT NULL DEFAULT ''"),
    ("input_sha256", "TEXT NOT NULL DEFAULT ''"),
    ("overlay_sha256", "TEXT NOT NULL DEFAULT ''"),
    ("report_overlay_version", "INTEGER NOT NULL DEFAULT 0"),
    ("report_model_schema", "TEXT"),
)
INDEXES_V2: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_event ON sessions(event)",
)

INDEX_STATES: tuple[str, ...] = ("ok", "missing_files", "corrupt", "delete_failed")
SORTS: dict[str, str] = {
    "updated_desc": "updated_at DESC, session_id DESC",
    "created_desc": "created_at DESC, session_id DESC",
    "created_asc": "created_at ASC, session_id ASC",
    "camel_asc": "camel_id ASC, updated_at DESC",
}
COMPARISON_SORTS: dict[str, str] = {
    "created_desc": "created_at DESC, comparison_id DESC",
    "created_asc": "created_at ASC, comparison_id ASC",
    "updated_desc": "updated_at DESC, comparison_id DESC",
    "title_asc": "title ASC, created_at DESC",
}
COLUMNS: tuple[str, ...] = (
    "session_id",
    "camel_id",
    "operator",
    "status",
    "revision",
    "created_at",
    "updated_at",
    "bag_name",
    "bag_path",
    "bag_fingerprint",
    "read_index",
    "n_measurements",
    "n_rejected",
    "outputs_stale",
    "report_stale",
    "overlay_version",
    "report_version",
    "session_mtime_ns",
    "session_size",
    "index_state",
    "index_error",
    *(name for name, _decl in SESSION_COLUMNS_V2),
)
COMPARISON_COLUMNS: tuple[str, ...] = (
    "comparison_id",
    "title",
    "event",
    "judge",
    "council",
    "language",
    "status",
    "created_at",
    "updated_at",
    "n_members",
    "model_version",
    "report_version",
    "report_stale",
    "file_mtime_ns",
    "file_size",
    "index_state",
    "index_error",
)
MEMBER_COLUMNS: tuple[str, ...] = (
    "comparison_id",
    "position",
    "session_id",
    "camel_id",
    "revision",
    "input_sha256",
    "overlay_version",
    "overlay_sha256",
)
# a member still shows what its comparison shows (Q2, by content): the SQL twin of
# comparison_model.stale_reasons (a test keeps the two in agreement)
MEMBER_FRESH_SQL = (
    "EXISTS (SELECT 1 FROM sessions s WHERE s.session_id = m.session_id"
    " AND s.index_state IN ('ok', 'delete_failed') AND s.status IN ('finalized', 'exported')"
    " AND s.outputs_stale = 0 AND s.revision = m.revision"
    " AND (s.input_sha256 = '' OR s.input_sha256 = m.input_sha256)"
    " AND s.overlay_version = m.overlay_version"
    " AND (s.overlay_sha256 = '' OR s.overlay_sha256 = m.overlay_sha256))"
)
STALE_SQL = (
    "EXISTS (SELECT 1 FROM comparison_members m WHERE m.comparison_id = comparisons.comparison_id"
    f" AND NOT {MEMBER_FRESH_SQL})"
)
N_COMPARISONS_SQL = (
    "(SELECT COUNT(DISTINCT m.comparison_id) FROM comparison_members m"
    " JOIN comparisons c ON c.comparison_id = m.comparison_id"
    " WHERE m.session_id = sessions.session_id AND c.index_state != 'missing_files')"
)
SEALED_STATUSES: tuple[str, ...] = ("finalized", "exported")


class HistoryError(EngineError):
    code = "history_error"
    status = 500


def _like(q: str) -> str:
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _iso_from_ns(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, tz=UTC).replace(microsecond=0).isoformat()


def report_model_schema(session_dir: Path | None, doc: Any) -> str | None:
    """The ``report_model_version`` of a sealed session's current report model; ``""`` when
    that file is missing or unreadable; ``None`` while the session has no current model."""
    if (
        session_dir is None
        or doc.status not in SEALED_STATUSES
        or doc.outputs_stale
        or not doc.outputs.report_model_file
    ):
        return None
    try:
        data = read_json(Path(session_dir) / doc.outputs.report_model_file)
    except (OSError, CorruptFileError):
        return ""
    version = data.get("report_model_version") if isinstance(data, dict) else None
    return version if isinstance(version, str) else ""


class HistoryIndex:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.migration: dict[str, Any] = {}
        self.ensure_schema()

    # ----- connections -----
    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(str(self.path), timeout=5.0, isolation_level=None)
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=5000")
            yield conn
        finally:
            conn.close()

    @contextmanager
    def write(self) -> Iterator[sqlite3.Connection]:
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise

    def ensure_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(DDL)
        with self.write() as conn:
            row = conn.execute("SELECT value FROM meta WHERE key = 'index_version'").fetchone()
            stored = row[0] if row is not None else None
            have = {r[1] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()}
            added = [name for name, _decl in SESSION_COLUMNS_V2 if name not in have]
            for name, decl in SESSION_COLUMNS_V2:
                if name in added:
                    conn.execute(f"ALTER TABLE sessions ADD COLUMN {name} {decl}")
            for statement in INDEXES_V2:
                conn.execute(statement)
            refreshed = 0
            if stored != str(HISTORY_INDEX_VERSION):
                refreshed = conn.execute(
                    "UPDATE sessions SET session_mtime_ns = 0"
                    " WHERE index_state IN ('ok', 'corrupt')"
                ).rowcount
                conn.execute(
                    "UPDATE comparisons SET file_mtime_ns = 0"
                    " WHERE index_state IN ('ok', 'corrupt')"
                )
            conn.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES ('index_version', ?)",
                (str(HISTORY_INDEX_VERSION),),
            )
        self.migration = {"from": stored, "added_columns": added, "rows_to_refresh": refreshed}

    def pragmas(self) -> dict[str, Any]:
        with self.connect() as conn:
            return {
                "journal_mode": conn.execute("PRAGMA journal_mode").fetchone()[0],
                "synchronous": conn.execute("PRAGMA synchronous").fetchone()[0],
                "foreign_keys": conn.execute("PRAGMA foreign_keys").fetchone()[0],
                "busy_timeout": conn.execute("PRAGMA busy_timeout").fetchone()[0],
            }

    # ----- writes -----
    def record_engine_run(self, run_id: str, pid: int, versions: dict[str, Any]) -> None:
        with self.write() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO engine_runs(run_id, started_at, pid, library_versions) "
                "VALUES (?, ?, ?, ?)",
                (
                    run_id,
                    datetime.now(UTC).replace(microsecond=0).isoformat(),
                    int(pid),
                    json.dumps(versions, sort_keys=True, ensure_ascii=False, default=str),
                ),
            )

    def upsert(
        self,
        doc: Any,
        *,
        mtime_ns: int,
        size: int,
        index_state: str = "ok",
        session_dir: Path | None = None,
    ) -> None:
        """Index one session document (``SessionDocument``); names are re-derived.
        ``session_dir`` lets the index read the report model's schema (D12 F2.1)."""
        from .session_schema import document_input_sha256

        view = doc.frame_view
        values = {
            "session_id": doc.session_id,
            "camel_id": doc.camel_id,
            "operator": doc.operator,
            "status": doc.status,
            "revision": int(doc.revision),
            "created_at": doc.created_at,
            "updated_at": doc.updated_at,
            "bag_name": view.get("bag_name"),
            "bag_path": view.get("bag_path"),
            "bag_fingerprint": view.get("bag_fingerprint"),
            "read_index": view.get("read_index"),
            "n_measurements": doc.n_measurements(),
            "n_rejected": doc.n_rejected(),
            "outputs_stale": int(bool(doc.outputs_stale)),
            "report_stale": int(bool(doc.report_stale)),
            "overlay_version": int(doc.outputs.overlay_version or 0),
            "report_version": int(doc.outputs.report_version or 0),
            "session_mtime_ns": int(mtime_ns),
            "session_size": int(size),
            "index_state": index_state,
            "index_error": "",
            "event": str(doc.report_inputs.names.get("event") or ""),
            "input_sha256": document_input_sha256(doc),
            "overlay_sha256": doc.outputs.overlay_sha256 or "",
            "report_overlay_version": int(doc.outputs.report_overlay_version or 0),
            "report_model_schema": report_model_schema(session_dir, doc),
        }
        names = [
            (doc.session_id, int(row.id), row.measurement_type, row.name or "")
            for row in [*doc.lines, *doc.angles, *doc.curves]
        ]
        placeholders = ", ".join("?" for _ in COLUMNS)
        with self.write() as conn:
            conn.execute(
                f"INSERT OR REPLACE INTO sessions({', '.join(COLUMNS)}) VALUES ({placeholders})",
                tuple(values[c] for c in COLUMNS),
            )
            conn.execute("DELETE FROM measurement_names WHERE session_id = ?", (doc.session_id,))
            conn.executemany(
                "INSERT INTO measurement_names(session_id, measurement_id, kind, name) "
                "VALUES (?, ?, ?, ?)",
                names,
            )

    def upsert_corrupt(self, session_id: str, *, mtime_ns: int, size: int, error: str) -> None:
        stamp = _iso_from_ns(mtime_ns) if mtime_ns else ""
        with self.write() as conn:
            conn.execute(
                "INSERT INTO sessions(session_id, status, created_at, updated_at, session_mtime_ns,"
                " session_size, index_state, index_error) VALUES (?, '', ?, ?, ?, ?, 'corrupt', ?)"
                " ON CONFLICT(session_id) DO UPDATE SET index_state='corrupt',"
                " index_error=excluded.index_error, session_mtime_ns=excluded.session_mtime_ns,"
                " session_size=excluded.session_size",
                (session_id, stamp, stamp, int(mtime_ns), int(size), error[:500]),
            )
            conn.execute("DELETE FROM measurement_names WHERE session_id = ?", (session_id,))

    def mark(self, session_id: str, index_state: str, error: str = "") -> bool:
        if index_state not in INDEX_STATES:
            raise ValueError(f"unknown index_state {index_state!r}")
        with self.write() as conn:
            cur = conn.execute(
                "UPDATE sessions SET index_state = ?, index_error = ? WHERE session_id = ?",
                (index_state, error[:500], session_id),
            )
            return cur.rowcount > 0

    def delete(self, session_id: str) -> bool:
        with self.write() as conn:
            cur = conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
            return cur.rowcount > 0

    # ----- reads -----
    @staticmethod
    def _row(row: sqlite3.Row) -> dict[str, Any]:
        d = {key: row[key] for key in row.keys()}
        d["outputs_stale"] = bool(d.get("outputs_stale"))
        d["report_stale"] = bool(d.get("report_stale"))
        d["n_comparisons"] = int(d.get("n_comparisons") or 0)
        return d

    def get(self, session_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                f"SELECT *, {N_COMPARISONS_SQL} AS n_comparisons FROM sessions"
                " WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            return self._row(row) if row is not None else None

    def list(
        self,
        *,
        status: str | None = None,
        camel_id: str | None = None,
        q: str | None = None,
        index_state: str | None = None,
        event: str | None = None,
        created_from: str | None = None,
        created_to: str | None = None,
        limit: int = 50,
        offset: int = 0,
        sort: str = "updated_desc",
    ) -> tuple[list[dict[str, Any]], int]:
        """``created_from`` / ``created_to``: ISO instants, both inclusive, compared as
        instants (``julianday``), so a stored ``+00:00`` and a sent local offset agree."""
        where: list[str] = []
        params: list[Any] = []
        if status:
            where.append("status = ?")
            params.append(status)
        if camel_id:
            where.append("camel_id = ?")
            params.append(camel_id)
        if index_state:
            where.append("index_state = ?")
            params.append(index_state)
        if event:
            where.append("event LIKE ? ESCAPE '\\'")
            params.append(_like(event))
        if created_from:
            where.append("julianday(created_at) >= julianday(?)")
            params.append(created_from)
        if created_to:
            where.append("julianday(created_at) <= julianday(?)")
            params.append(created_to)
        if q:
            like = _like(q)
            where.append(
                "(camel_id LIKE ? ESCAPE '\\' OR operator LIKE ? ESCAPE '\\'"
                " OR bag_name LIKE ? ESCAPE '\\' OR session_id LIKE ? ESCAPE '\\'"
                " OR event LIKE ? ESCAPE '\\'"
                " OR session_id IN (SELECT session_id FROM measurement_names"
                " WHERE name LIKE ? ESCAPE '\\'))"
            )
            params.extend([like] * 6)
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        order = SORTS.get(sort, SORTS["updated_desc"])
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        with self.connect() as conn:
            total = int(
                conn.execute(f"SELECT COUNT(*) FROM sessions {clause}", params).fetchone()[0]
            )
            rows = conn.execute(
                f"SELECT *, {N_COMPARISONS_SQL} AS n_comparisons FROM sessions {clause}"
                f" ORDER BY {order} LIMIT ? OFFSET ?",
                [*params, limit, offset],
            ).fetchall()
            return [self._row(r) for r in rows], total

    def measurement_names(self, session_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT measurement_id, kind, name FROM measurement_names WHERE session_id = ?"
                " ORDER BY measurement_id",
                (session_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def stats(self) -> dict[str, Any]:
        with self.connect() as conn:
            n = int(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0])
            by_state = {
                r[0]: int(r[1])
                for r in conn.execute(
                    "SELECT index_state, COUNT(*) FROM sessions GROUP BY index_state"
                ).fetchall()
            }
            n_comparisons = int(conn.execute("SELECT COUNT(*) FROM comparisons").fetchone()[0])
            version = conn.execute("SELECT value FROM meta WHERE key = 'index_version'").fetchone()
        size = self.path.stat().st_size if self.path.exists() else 0
        return {
            "rows": n,
            "by_index_state": by_state,
            "comparison_rows": n_comparisons,
            "index_version": int(version[0]) if version is not None else None,
            "db_bytes": size,
        }

    # ----- reconcile -----
    def reconcile(
        self,
        sessions_root: Path | str,
        loader: Callable[[Path], Any],
        *,
        session_lock: Callable[[str], AbstractContextManager[bool]] | None = None,
    ) -> dict[str, int]:
        """Bring the index in line with the session folders (files win).

        One bad folder never stops the walk: any failure to load or index a session becomes
        a ``corrupt`` row with the reason. ``session_lock(session_id)`` (non-blocking, yields
        whether it was acquired) serialises the per-session load + upsert with the store's
        writers and deletes, so a just-deleted session is never re-inserted; a busy session
        is skipped and counted (the next list reconciles it)."""
        root = Path(sessions_root)
        counts = {
            "unindexed": 0,
            "refreshed": 0,
            "missing_files": 0,
            "corrupt": 0,
            "unchanged": 0,
            "busy": 0,
        }
        on_disk = _folders_with(root, "session.json")
        with self.connect() as conn:
            indexed = {
                r["session_id"]: r
                for r in conn.execute(
                    "SELECT session_id, session_mtime_ns, session_size, index_state FROM sessions"
                ).fetchall()
            }
        for session_id, path in on_disk.items():
            guard = session_lock(session_id) if session_lock is not None else nullcontext(True)
            with guard as acquired:
                if not acquired:
                    counts["busy"] += 1
                    continue
                outcome = self._reconcile_one(session_id, path, indexed.get(session_id), loader)
                if outcome:
                    counts[outcome] += 1
        for session_id, row in indexed.items():
            if session_id not in on_disk and row["index_state"] not in (
                "missing_files",
                "delete_failed",
            ):
                self.mark(session_id, "missing_files", "session folder not found")
                counts["missing_files"] += 1
        return counts

    def _reconcile_one(
        self, session_id: str, path: Path, row: Any, loader: Callable[[Path], Any]
    ) -> str | None:
        try:
            st = path.stat()  # re-checked under the session lock: deleted meanwhile -> skip
        except OSError:
            return None
        # a failed delete stays visible until the file changes or the delete is retried
        if _fresh(row, st, "session_mtime_ns", "session_size"):
            return "unchanged"
        try:
            doc = loader(path)
            if doc.session_id != session_id:
                raise CorruptFileError(f"session_id mismatch: file says {doc.session_id!r}")
            self.upsert(doc, mtime_ns=st.st_mtime_ns, size=st.st_size, session_dir=path.parent)
        except Exception as exc:  # one bad folder must not stop History or the engine start
            reason = exc.message if isinstance(exc, EngineError) else f"{type(exc).__name__}: {exc}"
            self.upsert_corrupt(session_id, mtime_ns=st.st_mtime_ns, size=st.st_size, error=reason)
            return "corrupt"
        return "refreshed" if row is not None else "unindexed"

    def rebuild(
        self,
        sessions_root: Path | str,
        loader: Callable[[Path], Any],
        *,
        session_lock: Callable[[str], AbstractContextManager[bool]] | None = None,
    ) -> dict[str, int]:
        with self.write() as conn:
            conn.execute("DELETE FROM sessions")
        return self.reconcile(sessions_root, loader, session_lock=session_lock)

    # ----- comparisons (D12 F2.8) -----
    def upsert_comparison(self, record: dict[str, Any], *, mtime_ns: int, size: int) -> None:
        """Index one ``comparison.json`` (its member snapshots replace the stored ones)."""
        cover = record.get("cover") or {}
        outputs = record.get("outputs") or {}
        cid = str(record["comparison_id"])
        values = {
            "comparison_id": cid,
            "title": str(cover.get("title") or ""),
            "event": str(cover.get("event") or ""),
            "judge": str(cover.get("judge") or ""),
            "council": str(cover.get("council") or ""),
            "language": str(record.get("language") or ""),
            "status": str(record.get("status") or ""),
            "created_at": str(record.get("created_at") or ""),
            "updated_at": str(record.get("updated_at") or ""),
            "n_members": len(record.get("members") or []),
            "model_version": int(outputs.get("model_version") or 0),
            "report_version": int(outputs.get("report_version") or 0),
            "report_stale": int(bool(record.get("report_stale"))),
            "file_mtime_ns": int(mtime_ns),
            "file_size": int(size),
            "index_state": "ok",
            "index_error": "",
        }
        members = [
            (
                cid,
                int(m["position"]),
                str(m["session_id"]),
                str(m.get("camel_id") or ""),
                int(m.get("revision") or 0),
                str(m.get("input_sha256") or ""),
                int(m.get("overlay_version") or 0),
                str(m.get("overlay_sha256") or ""),
            )
            for m in record.get("members") or []
        ]
        placeholders = ", ".join("?" for _ in COMPARISON_COLUMNS)
        updates = ", ".join(f"{c} = excluded.{c}" for c in COMPARISON_COLUMNS[1:])
        with self.write() as conn:
            conn.execute(
                f"INSERT INTO comparisons({', '.join(COMPARISON_COLUMNS)}) VALUES ({placeholders})"
                f" ON CONFLICT(comparison_id) DO UPDATE SET {updates}",
                tuple(values[c] for c in COMPARISON_COLUMNS),
            )
            conn.execute("DELETE FROM comparison_members WHERE comparison_id = ?", (cid,))
            conn.executemany(
                f"INSERT INTO comparison_members({', '.join(MEMBER_COLUMNS)})"
                f" VALUES ({', '.join('?' for _ in MEMBER_COLUMNS)})",
                members,
            )

    def upsert_comparison_corrupt(
        self, comparison_id: str, *, mtime_ns: int, size: int, error: str
    ) -> None:
        stamp = _iso_from_ns(mtime_ns) if mtime_ns else ""
        with self.write() as conn:
            conn.execute(
                "INSERT INTO comparisons(comparison_id, created_at, updated_at, file_mtime_ns,"
                " file_size, index_state, index_error) VALUES (?, ?, ?, ?, ?, 'corrupt', ?)"
                " ON CONFLICT(comparison_id) DO UPDATE SET index_state='corrupt',"
                " index_error=excluded.index_error, file_mtime_ns=excluded.file_mtime_ns,"
                " file_size=excluded.file_size",
                (comparison_id, stamp, stamp, int(mtime_ns), int(size), error[:500]),
            )
            conn.execute("DELETE FROM comparison_members WHERE comparison_id = ?", (comparison_id,))

    def mark_comparison(self, comparison_id: str, index_state: str, error: str = "") -> bool:
        if index_state not in INDEX_STATES:
            raise ValueError(f"unknown index_state {index_state!r}")
        with self.write() as conn:
            cur = conn.execute(
                "UPDATE comparisons SET index_state = ?, index_error = ? WHERE comparison_id = ?",
                (index_state, error[:500], comparison_id),
            )
            return cur.rowcount > 0

    def delete_comparison(self, comparison_id: str) -> bool:
        with self.write() as conn:
            cur = conn.execute("DELETE FROM comparisons WHERE comparison_id = ?", (comparison_id,))
            return cur.rowcount > 0

    @staticmethod
    def _comparison_row(row: sqlite3.Row) -> dict[str, Any]:
        d = {key: row[key] for key in row.keys()}
        d["report_stale"] = bool(d.get("report_stale"))
        if "stale" in d:
            d["stale"] = bool(d["stale"])
        return d

    def get_comparison(self, comparison_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                f"SELECT *, {STALE_SQL} AS stale FROM comparisons WHERE comparison_id = ?",
                (comparison_id,),
            ).fetchone()
            return self._comparison_row(row) if row is not None else None

    def list_comparisons(
        self,
        *,
        q: str | None = None,
        status: str | None = None,
        stale: bool | None = None,
        index_state: str | None = None,
        limit: int = 50,
        offset: int = 0,
        sort: str = "created_desc",
    ) -> tuple[list[dict[str, Any]], int]:
        where: list[str] = []
        params: list[Any] = []
        if status:
            where.append("status = ?")
            params.append(status)
        if index_state:
            where.append("index_state = ?")
            params.append(index_state)
        if stale is not None:
            where.append(STALE_SQL if stale else f"NOT {STALE_SQL}")
        if q:
            like = _like(q)
            where.append(
                "(title LIKE ? ESCAPE '\\' OR event LIKE ? ESCAPE '\\' OR judge LIKE ? ESCAPE '\\'"
                " OR council LIKE ? ESCAPE '\\' OR comparison_id LIKE ? ESCAPE '\\'"
                " OR comparison_id IN (SELECT comparison_id FROM comparison_members"
                " WHERE camel_id LIKE ? ESCAPE '\\' OR session_id LIKE ? ESCAPE '\\'))"
            )
            params.extend([like] * 7)
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        order = COMPARISON_SORTS.get(sort, COMPARISON_SORTS["created_desc"])
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        with self.connect() as conn:
            total = int(
                conn.execute(f"SELECT COUNT(*) FROM comparisons {clause}", params).fetchone()[0]
            )
            rows = conn.execute(
                f"SELECT *, {STALE_SQL} AS stale FROM comparisons {clause}"
                f" ORDER BY {order} LIMIT ? OFFSET ?",
                [*params, limit, offset],
            ).fetchall()
            return [self._comparison_row(r) for r in rows], total

    def comparison_members(self, comparison_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        """Member snapshots with their session's current index row (``current`` is ``None``
        when the session has no row), in position order, by comparison."""
        out: dict[str, list[dict[str, Any]]] = {cid: [] for cid in comparison_ids}
        if not comparison_ids:
            return out
        marks = ", ".join("?" for _ in comparison_ids)
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT m.*, s.session_id AS s_session_id, s.index_state AS s_index_state,"
                " s.status AS s_status, s.outputs_stale AS s_outputs_stale,"
                " s.revision AS s_revision, s.input_sha256 AS s_input_sha256,"
                " s.overlay_version AS s_overlay_version, s.overlay_sha256 AS s_overlay_sha256"
                " FROM comparison_members m LEFT JOIN sessions s ON s.session_id = m.session_id"
                f" WHERE m.comparison_id IN ({marks}) ORDER BY m.comparison_id, m.position",
                comparison_ids,
            ).fetchall()
        for r in rows:
            member = {key: r[key] for key in MEMBER_COLUMNS}
            current = None
            if r["s_session_id"] is not None:
                current = {
                    "index_state": r["s_index_state"],
                    "status": r["s_status"],
                    "outputs_stale": bool(r["s_outputs_stale"]),
                    "revision": r["s_revision"],
                    "input_sha256": r["s_input_sha256"],
                    "overlay_version": r["s_overlay_version"],
                    "overlay_sha256": r["s_overlay_sha256"],
                }
            member["current"] = current
            out[r["comparison_id"]].append(member)
        return out

    def reconcile_comparisons(
        self,
        comparisons_root: Path | str,
        loader: Callable[[Path], dict[str, Any]],
        *,
        comparison_lock: Callable[[str], AbstractContextManager[bool]] | None = None,
    ) -> dict[str, int]:
        """The comparisons twin of :meth:`reconcile` (``comparison.json`` files win)."""
        counts = {
            "unindexed": 0,
            "refreshed": 0,
            "missing_files": 0,
            "corrupt": 0,
            "unchanged": 0,
            "busy": 0,
        }
        on_disk = _folders_with(Path(comparisons_root), "comparison.json")
        with self.connect() as conn:
            indexed = {
                r["comparison_id"]: r
                for r in conn.execute(
                    "SELECT comparison_id, file_mtime_ns, file_size, index_state FROM comparisons"
                ).fetchall()
            }
        for cid, path in on_disk.items():
            guard = comparison_lock(cid) if comparison_lock is not None else nullcontext(True)
            with guard as acquired:
                if not acquired:
                    counts["busy"] += 1
                    continue
                try:
                    st = path.stat()
                except OSError:
                    continue
                row = indexed.get(cid)
                if _fresh(row, st, "file_mtime_ns", "file_size"):
                    counts["unchanged"] += 1
                    continue
                try:
                    record = loader(path)
                    if record.get("comparison_id") != cid:
                        raise CorruptFileError(
                            f"comparison_id mismatch: file says {record.get('comparison_id')!r}"
                        )
                    self.upsert_comparison(record, mtime_ns=st.st_mtime_ns, size=st.st_size)
                except Exception as exc:  # one bad folder must not stop the list
                    reason = (
                        exc.message
                        if isinstance(exc, EngineError)
                        else f"{type(exc).__name__}: {exc}"
                    )
                    self.upsert_comparison_corrupt(
                        cid, mtime_ns=st.st_mtime_ns, size=st.st_size, error=reason
                    )
                    counts["corrupt"] += 1
                    continue
                counts["refreshed" if row is not None else "unindexed"] += 1
        for cid, row in indexed.items():
            if cid not in on_disk and row["index_state"] not in ("missing_files", "delete_failed"):
                self.mark_comparison(cid, "missing_files", "comparison folder not found")
                counts["missing_files"] += 1
        return counts

    def rebuild_comparisons(
        self,
        comparisons_root: Path | str,
        loader: Callable[[Path], dict[str, Any]],
        *,
        comparison_lock: Callable[[str], AbstractContextManager[bool]] | None = None,
    ) -> dict[str, int]:
        with self.write() as conn:
            conn.execute("DELETE FROM comparisons")
        return self.reconcile_comparisons(comparisons_root, loader, comparison_lock=comparison_lock)

    # ----- maintenance -----
    def backup(self, dest: Path | str) -> int:
        target = Path(dest)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(f".tmp_{target.name}")
        if tmp.exists():
            tmp.unlink()
        src = sqlite3.connect(str(self.path), timeout=5.0)
        dst = sqlite3.connect(str(tmp))
        try:
            src.backup(dst, pages=256)
        finally:
            dst.close()
            src.close()
        from .fsio import replace_with_retries

        replace_with_retries(tmp, target)
        return target.stat().st_size

    def checkpoint(self) -> tuple[int, int, int]:
        with self.connect() as conn:
            row = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            return int(row[0]), int(row[1]), int(row[2])

    def auto_backup(self, backups_dir: Path | str, *, interval_s: float, keep: int) -> Path | None:
        """Daily rotating backup (keep the newest ``keep``); returns the new file or None."""
        directory = Path(backups_dir)
        directory.mkdir(parents=True, exist_ok=True)
        existing = sorted(directory.glob("history_*.sqlite"), key=lambda p: p.stat().st_mtime)
        if existing and time.time() - existing[-1].stat().st_mtime < interval_s:
            return None
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        target = directory / f"history_{stamp}.sqlite"
        self.backup(target)
        existing = sorted(directory.glob("history_*.sqlite"), key=lambda p: p.stat().st_mtime)
        for old in existing[:-keep] if keep > 0 else []:
            try:
                old.unlink()
            except OSError:
                pass
        return target


def _folders_with(root: Path, file_name: str) -> dict[str, Path]:
    on_disk: dict[str, Path] = {}
    if root.is_dir():
        for entry in root.iterdir():
            if entry.is_dir() and not entry.name.startswith(".") and (entry / file_name).is_file():
                on_disk[entry.name] = entry / file_name
    return on_disk


def _fresh(row: Any, st: Any, mtime_key: str, size_key: str) -> bool:
    return (
        row is not None
        and int(row[mtime_key]) == st.st_mtime_ns
        and int(row[size_key]) == st.st_size
        and row["index_state"] in ("ok", "corrupt", "delete_failed")
    )
