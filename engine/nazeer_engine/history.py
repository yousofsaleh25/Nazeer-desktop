"""``history.sqlite`` — a derived, rebuildable index of ``sessions/*/session.json`` (C3.3).

The session files are authoritative; this index only makes History fast to list and to
search (including operator-given measurement names). Rules: one connection per call,
WAL + ``synchronous=NORMAL`` + ``foreign_keys=ON`` + ``busy_timeout=5000`` on every
connection, explicit ``BEGIN IMMEDIATE`` for writes, the engine process is the single
writer (uvicorn ``--workers 1``), Electron never opens the file, reconcile on startup and
before every list, backups through ``Connection.backup()``.
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
"""

INDEX_STATES: tuple[str, ...] = ("ok", "missing_files", "corrupt", "delete_failed")
SORTS: dict[str, str] = {
    "updated_desc": "updated_at DESC, session_id DESC",
    "created_desc": "created_at DESC, session_id DESC",
    "created_asc": "created_at ASC, session_id ASC",
    "camel_asc": "camel_id ASC, updated_at DESC",
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
)


class HistoryError(EngineError):
    code = "history_error"
    status = 500


def _like(q: str) -> str:
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _iso_from_ns(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, tz=UTC).replace(microsecond=0).isoformat()


class HistoryIndex:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
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
            conn.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES ('index_version', ?)",
                (str(HISTORY_INDEX_VERSION),),
            )

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

    def upsert(self, doc: Any, *, mtime_ns: int, size: int, index_state: str = "ok") -> None:
        """Index one session document (``SessionDocument``); names are re-derived."""
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
        return d

    def get(self, session_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
            return self._row(row) if row is not None else None

    def list(
        self,
        *,
        status: str | None = None,
        camel_id: str | None = None,
        q: str | None = None,
        index_state: str | None = None,
        limit: int = 50,
        offset: int = 0,
        sort: str = "updated_desc",
    ) -> tuple[list[dict[str, Any]], int]:
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
        if q:
            like = _like(q)
            where.append(
                "(camel_id LIKE ? ESCAPE '\\' OR operator LIKE ? ESCAPE '\\'"
                " OR bag_name LIKE ? ESCAPE '\\' OR session_id LIKE ? ESCAPE '\\'"
                " OR session_id IN (SELECT session_id FROM measurement_names"
                " WHERE name LIKE ? ESCAPE '\\'))"
            )
            params.extend([like] * 5)
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        order = SORTS.get(sort, SORTS["updated_desc"])
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        with self.connect() as conn:
            total = int(
                conn.execute(f"SELECT COUNT(*) FROM sessions {clause}", params).fetchone()[0]
            )
            rows = conn.execute(
                f"SELECT * FROM sessions {clause} ORDER BY {order} LIMIT ? OFFSET ?",
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
        size = self.path.stat().st_size if self.path.exists() else 0
        return {"rows": n, "by_index_state": by_state, "db_bytes": size}

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
        on_disk: dict[str, Path] = {}
        if root.is_dir():
            for entry in root.iterdir():
                if (
                    entry.is_dir()
                    and not entry.name.startswith(".")
                    and (entry / "session.json").is_file()
                ):
                    on_disk[entry.name] = entry / "session.json"
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
        fresh = (
            row is not None
            and int(row["session_mtime_ns"]) == st.st_mtime_ns
            and int(row["session_size"]) == st.st_size
            and row["index_state"] in ("ok", "corrupt", "delete_failed")
        )
        if fresh:
            return "unchanged"
        try:
            doc = loader(path)
            if doc.session_id != session_id:
                raise CorruptFileError(f"session_id mismatch: file says {doc.session_id!r}")
            self.upsert(doc, mtime_ns=st.st_mtime_ns, size=st.st_size)
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
