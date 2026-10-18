"""Comparison persistence (D12 F2.1, F2.6-F2.10): create, view, cover / language changes, the
seal (probe, attachments, manifest), delete, reconcile.

* ``<root>/comparisons/<comparison_id>/``: ``comparison.json`` (schema 1.0: status, language,
  cover, the members' snapshots, outputs), ``comparison_model_vN.json`` (never rewritten),
  ``comparison.manifest.json``. The files are written first, the index row second (C3.2).
* Create re-checks every member from its files under its session lock (taken in sorted order;
  session code never takes a comparison lock): finalized, not reopened, the overlay and the
  report model unchanged since finalize (SHA-256), a report model the comparison can read. The
  member blocks come from the frozen report model — the engine computes nothing new.
* Staleness is computed, never stored (Q2: by content): from the member files on every view,
  from the index on every list. A changed ``session.json`` alone is a note.
* Delete = rename the folder into ``<root>/trash/comparison_<id>``; a failed rename stays
  visible as ``delete_failed``.
"""

from __future__ import annotations

import logging
import re
import shutil
import threading
from collections.abc import Iterator, Sequence
from contextlib import ExitStack, contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import comparison_model as cm
from . import fsio, jsonsafe
from .constants import (
    COMPARISON_LOCK_TIMEOUT_S,
    COMPARISON_MANIFEST_VERSION,
    COMPARISON_MAX_NAME,
    COMPARISON_MAX_SESSIONS,
    COMPARISON_MAX_TITLE,
    COMPARISON_REPORT_MODELS,
    COMPARISON_SCHEMA_VERSION,
    CONSTANTS_STAMP,
    ENGINE_VERSION,
)
from .errors import (
    AtomicWriteError,
    Conflict,
    CorruptFileError,
    EngineError,
    NotFound,
    Unprocessable,
    UnsupportedSchemaVersion,
)
from .history import HistoryIndex
from .pdf_finalize import MemberEvidence, finalize_comparison_pdf
from .session_schema import (
    LANGUAGES,
    SESSION_ID_RE,
    SessionDocument,
    document_input_sha256,
    iso_now,
    new_session_id,
)
from .session_store import SessionStore, rejected_report_name

log = logging.getLogger("nazeer_engine.comparisons")

COMPARISON_FILE = "comparison.json"
MANIFEST_FILE = "comparison.manifest.json"
ASSET_RE = re.compile(
    r"^(comparison\.json|comparison\.manifest\.json|comparison_model_v\d+\.json|report_v\d+\.pdf"
    r"|report_v\d+\.rejected_\d{8}T\d{9}Z_[0-9a-f]{4}\.pdf)$"
)
APP_KEYS: tuple[str, ...] = ("app_version", "electron", "chromium")
COVER_LIMITS: dict[str, int] = {
    "title": COMPARISON_MAX_TITLE,
    "event": COMPARISON_MAX_NAME,
    "judge": COMPARISON_MAX_NAME,
    "council": COMPARISON_MAX_NAME,
}


class MemberNotFound(NotFound):
    code = "comparison_member_not_found"


class MemberNotFinal(Conflict):
    code = "comparison_member_not_final"


class MemberModelOutdated(Conflict):
    code = "comparison_member_model_outdated"


class MemberUnavailable(Conflict):
    code = "comparison_member_unavailable"


class MemberFilesChanged(Conflict):
    code = "session_assets_changed"


# a member refused at create: its labelled reason (comparison_ineligible) -> the error
REFUSALS: dict[str, type[EngineError]] = {
    "files_missing": MemberUnavailable,
    "file_corrupt": MemberUnavailable,
    "delete_failed": MemberUnavailable,
    "files_changed": MemberFilesChanged,
    "not_finalized": MemberNotFinal,
    "reopened": MemberNotFinal,
    "model_outdated": MemberModelOutdated,
}
SNAPSHOT_KEYS: tuple[str, ...] = (
    "position",
    "session_id",
    "camel_id",
    "status",
    "revision",
    "input_sha256",
    "overlay_version",
    "overlay_sha256",
    "overlay_file",
    "overlay_width",
    "overlay_height",
    "report_model_file",
    "report_model_version",
    "report_model_sha256",
    "session_json_sha256",
)


class _Refused(Exception):
    def __init__(self, reason: str, message: str = "") -> None:
        super().__init__(message or reason)
        self.reason = reason
        self.message = message or reason


def _text(value: Any, field: str, limit: int) -> str:
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > limit:
        raise Unprocessable(
            f"{field} must be a string of at most {limit} characters",
            code="invalid_field",
            details={"field": field, "limit": limit},
        )
    return value


def _stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


class ComparisonStore:
    def __init__(
        self,
        data_root: Path | str,
        history: HistoryIndex,
        sessions: SessionStore,
        *,
        versions: Any = None,
    ) -> None:
        self.root = Path(data_root)
        self.dir = self.root / "comparisons"
        self.trash_dir = self.root / "trash"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.trash_dir.mkdir(parents=True, exist_ok=True)
        self.history = history
        self.sessions = sessions
        self._versions = versions or (lambda: {})
        self._locks: dict[str, threading.RLock] = {}
        self._locks_lock = threading.Lock()

    # ----- paths and locks -----
    def check_id(self, comparison_id: str) -> str:
        if not isinstance(comparison_id, str) or not SESSION_ID_RE.match(comparison_id):
            raise NotFound(
                "comparison not found",
                code="comparison_not_found",
                details={"comparison_id": comparison_id},
            )
        return comparison_id

    def comparison_dir(self, comparison_id: str) -> Path:
        return self.dir / self.check_id(comparison_id)

    def asset_path(self, comparison_id: str, name: str) -> Path:
        if not ASSET_RE.match(name or ""):
            raise NotFound("unknown asset", code="asset_not_found", details={"name": name})
        path = self.comparison_dir(comparison_id) / name
        if not path.is_file():
            raise NotFound("asset not found", code="asset_not_found", details={"name": name})
        return path

    def lock(self, comparison_id: str) -> threading.RLock:
        with self._locks_lock:
            lock = self._locks.get(comparison_id)
            if lock is None:
                lock = threading.RLock()
                self._locks[comparison_id] = lock
            return lock

    @contextmanager
    def locked(self, comparison_id: str, *, blocking: bool = True) -> Iterator[None]:
        lock = self.lock(comparison_id)
        acquired = (
            lock.acquire(timeout=COMPARISON_LOCK_TIMEOUT_S) if blocking else lock.acquire(False)
        )
        if not acquired:
            raise Conflict(
                "comparison busy", code="comparison_busy", details={"comparison_id": comparison_id}
            )
        try:
            yield
        finally:
            lock.release()

    @contextmanager
    def _try_lock(self, comparison_id: str) -> Iterator[bool]:
        lock = self.lock(comparison_id)
        acquired = lock.acquire(blocking=False)
        try:
            yield acquired
        finally:
            if acquired:
                lock.release()

    @contextmanager
    def member_locks(self, session_ids: Sequence[str]) -> Iterator[None]:
        """Every member's session lock, in sorted order (the one lock order, F2.9)."""
        with ExitStack() as stack:
            for session_id in sorted(set(session_ids)):
                lock = self.sessions.lock(session_id)
                if not lock.acquire(timeout=COMPARISON_LOCK_TIMEOUT_S):
                    raise Conflict(
                        "session busy", code="session_busy", details={"session_id": session_id}
                    )
                stack.callback(lock.release)
            yield

    # ----- files -----
    def load(self, comparison_id: str) -> dict[str, Any]:
        path = self.comparison_dir(comparison_id) / COMPARISON_FILE
        if not path.is_file():
            raise NotFound(
                "comparison not found",
                code="comparison_not_found",
                details={"comparison_id": comparison_id},
            )
        return load_record(path)

    def _write_record(self, record: dict[str, Any]) -> None:
        fsio.write_json(self.comparison_dir(record["comparison_id"]) / COMPARISON_FILE, record)

    def _index(self, record: dict[str, Any]) -> str:
        """Best-effort index update (the files are authoritative); returns the index state."""
        path = self.comparison_dir(record["comparison_id"]) / COMPARISON_FILE
        try:
            st = path.stat()
            self.history.upsert_comparison(record, mtime_ns=st.st_mtime_ns, size=st.st_size)
            return "ok"
        except Exception as exc:  # the next reconcile repairs the index
            log.warning(
                "comparison index upsert failed",
                extra={"comparison_id": record["comparison_id"], "error": str(exc)},
            )
            return "unindexed"

    def _manifest(self, comparison_id: str) -> dict[str, Any]:
        return fsio.read_json(self.comparison_dir(comparison_id) / MANIFEST_FILE)

    def _write_manifest(self, record: dict[str, Any], manifest: dict[str, Any]) -> None:
        manifest["updated_at"] = iso_now()
        manifest["status"] = record["status"]
        manifest["versions"] = dict(record.get("versions") or {})
        fsio.write_json(self.comparison_dir(record["comparison_id"]) / MANIFEST_FILE, manifest)

    def reconcile(self) -> dict[str, int]:
        return self.history.reconcile_comparisons(
            self.dir, load_record, comparison_lock=self._try_lock
        )

    def rebuild_index(self) -> dict[str, int]:
        return self.history.rebuild_comparisons(
            self.dir, load_record, comparison_lock=self._try_lock
        )

    # ----- inputs -----
    @staticmethod
    def validated_cover(current: dict[str, str] | None, raw: Any) -> dict[str, str]:
        cover = {key: str((current or {}).get(key) or "") for key in cm.COVER_KEYS}
        if raw is None:
            return cover
        if not isinstance(raw, dict) or set(raw) - set(cm.COVER_KEYS):
            raise Unprocessable(
                f"cover takes {list(cm.COVER_KEYS)}",
                code="invalid_field",
                details={"field": "cover"},
            )
        for key, value in raw.items():
            if value is not None:
                cover[key] = _text(value, f"cover.{key}", COVER_LIMITS[key])
        return cover

    @staticmethod
    def validated_language(value: Any, current: str = "both") -> str:
        if value is None:
            return current
        if value not in LANGUAGES:
            raise Unprocessable(
                "language must be 'ar', 'en' or 'both'",
                code="invalid_field",
                details={"field": "language"},
            )
        return str(value)

    @staticmethod
    def validated_members(session_ids: Any) -> list[str]:
        if not isinstance(session_ids, list) or not session_ids:
            raise Unprocessable("pick at least one camel to compare", code="comparison_no_members")
        if len(session_ids) > COMPARISON_MAX_SESSIONS:
            raise Unprocessable(
                f"a comparison holds at most {COMPARISON_MAX_SESSIONS} camels",
                code="comparison_too_many_members",
                details={"limit": COMPARISON_MAX_SESSIONS, "sent": len(session_ids)},
            )
        ids = [str(s) for s in session_ids]
        duplicates = sorted({s for s in ids if ids.count(s) > 1})
        if duplicates:
            raise Unprocessable(
                "a session can appear only once in a comparison",
                code="comparison_duplicate_members",
                details={"session_ids": duplicates},
            )
        return ids

    def _stamped_versions(self, base: dict[str, Any], app_meta: dict[str, Any] | None) -> dict:
        versions = dict(base)
        for key in APP_KEYS:
            value = (app_meta or {}).get(key)
            if value:
                versions[key] = str(value)[:100]
        return versions

    # ----- create -----
    def _read_member(self, position: int, session_id: str) -> tuple[dict, dict]:
        """(model member block, snapshot) of one member, from its files; raises ``_Refused``
        with the labelled reason. The caller holds the member's session lock."""
        if not SESSION_ID_RE.match(session_id):
            raise _Refused("not_found")
        sdir = self.sessions.sessions_dir / session_id
        path = sdir / "session.json"
        if not path.is_file():
            raise _Refused("not_found")
        row = self.history.get(session_id)
        if row is not None and row.get("index_state") == "delete_failed":
            raise _Refused("delete_failed")
        try:
            session_bytes = fsio.read_bytes(path)
            doc = parse_session(session_bytes, path)
        except (OSError, EngineError) as exc:
            raise _Refused("file_corrupt", getattr(exc, "message", str(exc))) from exc
        out = doc.outputs
        if doc.status not in cm.SEALED_STATUSES or doc.outputs_stale or not out.overlay_version:
            raise _Refused("reopened" if doc.outputs_stale else "not_finalized")
        if not out.overlay_file or not out.report_model_file:
            raise _Refused("files_missing")
        overlay_path = sdir / out.overlay_file
        model_path = sdir / out.report_model_file
        if not overlay_path.is_file() or not model_path.is_file():
            raise _Refused("files_missing")
        if fsio.sha256_file(overlay_path) != out.overlay_sha256:
            raise _Refused("files_changed", f"{out.overlay_file} changed after finalize")
        model_bytes = fsio.read_bytes(model_path)
        if fsio.sha256_bytes(model_bytes) != out.report_model_sha256:
            raise _Refused("files_changed", f"{out.report_model_file} changed after finalize")
        try:
            model = jsonsafe.loads_strict(model_bytes)
        except (ValueError, UnicodeDecodeError) as exc:
            raise _Refused("file_corrupt", str(exc)) from exc
        if not isinstance(model, dict):
            raise _Refused("file_corrupt", "the report model is not an object")
        if model.get("report_model_version") not in COMPARISON_REPORT_MODELS:
            raise _Refused("model_outdated")
        if (model.get("overlay") or {}).get("sha256") != out.overlay_sha256:
            raise _Refused("files_changed", "the report model names another overlay")
        input_sha = document_input_sha256(doc)
        session_sha = fsio.sha256_bytes(session_bytes)
        overlay = {
            "file": out.overlay_file,
            "version": out.overlay_version,
            "sha256": out.overlay_sha256,
            "width": out.overlay_width,
            "height": out.overlay_height,
        }
        model_ref = {
            "file": out.report_model_file,
            "version": out.report_model_version,
            "sha256": out.report_model_sha256,
        }
        try:
            block = cm.member_block(
                position,
                session={
                    "session_id": doc.session_id,
                    "camel_id": doc.camel_id,
                    "operator": doc.operator,
                    "status": doc.status,
                    "revision": doc.revision,
                    "created_at": doc.created_at,
                },
                report_model=model,
                report_model_ref=model_ref,
                overlay=overlay,
                session_json_sha256=session_sha,
                input_sha256=input_sha,
            )
        except CorruptFileError as exc:
            raise _Refused("file_corrupt", exc.message) from exc
        snapshot = {
            "position": position,
            "session_id": doc.session_id,
            "camel_id": doc.camel_id,
            "status": doc.status,
            "revision": doc.revision,
            "input_sha256": input_sha,
            "overlay_version": out.overlay_version,
            "overlay_sha256": out.overlay_sha256,
            "overlay_file": out.overlay_file,
            "overlay_width": out.overlay_width,
            "overlay_height": out.overlay_height,
            "report_model_file": out.report_model_file,
            "report_model_version": out.report_model_version,
            "report_model_sha256": out.report_model_sha256,
            "session_json_sha256": session_sha,
            "approved_by_seal_at_creation": cm.approved_by_seal(
                {
                    "status": doc.status,
                    "outputs_stale": doc.outputs_stale,
                    "overlay_version": out.overlay_version,
                    "report_version": out.report_version,
                    "report_overlay_version": out.report_overlay_version,
                }
            ),
        }
        return block, snapshot

    def create(
        self,
        session_ids: Any,
        *,
        cover: Any = None,
        language: Any = None,
        app_meta: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], str]:
        """A new comparison of ``session_ids`` in the operator's order; returns (record,
        index_state). One refused member refuses the whole request; ``details.members``
        lists every refused member with its reason."""
        ids = self.validated_members(session_ids)
        cover_values = self.validated_cover(None, cover)
        lang = self.validated_language(language)
        blocks: list[dict[str, Any]] = []
        snapshots: list[dict[str, Any]] = []
        refused: list[dict[str, Any]] = []
        with self.member_locks([s for s in ids if SESSION_ID_RE.match(s)]):
            for position, session_id in enumerate(ids, start=1):
                try:
                    block, snapshot = self._read_member(position, session_id)
                except _Refused as no:
                    refused.append(
                        {
                            "position": position,
                            "session_id": session_id,
                            "reason": "files_missing" if no.reason == "not_found" else no.reason,
                            "not_found": no.reason == "not_found",
                            "message": no.message,
                        }
                    )
                    continue
                blocks.append(block)
                snapshots.append(snapshot)
        if refused:
            first = refused[0]
            error = MemberNotFound if first["not_found"] else REFUSALS[first["reason"]]
            raise error(
                f"camel #{first['position']} ({first['session_id']}) cannot join a comparison",
                details={"members": refused},
            )
        comparison_id, cdir = self._allocate()
        now = iso_now()
        try:
            versions = self._stamped_versions(self._versions(), app_meta)
            model = cm.build_model(
                comparison_id=comparison_id,
                version=1,
                language=lang,
                cover=cover_values,
                members=blocks,
                created_at=now,
                generated_at=now,
                versions=versions,
                constants=CONSTANTS_STAMP,
            )
            model_file = "comparison_model_v1.json"
            model_bytes = fsio.write_json(cdir / model_file, model)
            record = {
                "schema_version": COMPARISON_SCHEMA_VERSION,
                "comparison_id": comparison_id,
                "created_at": now,
                "updated_at": now,
                "status": "created",
                "language": lang,
                "cover": cover_values,
                "members": snapshots,
                "required_report_texts": cm.required_texts(model),
                "outputs": {
                    "model_version": 1,
                    "model_file": model_file,
                    "model_sha256": fsio.sha256_bytes(model_bytes),
                    "report_version": 0,
                    "report_file": None,
                    "report_sha256": None,
                    "report_model_version": 0,
                    "manifest_file": MANIFEST_FILE,
                },
                "report_stale": False,
                "versions": versions,
                "engine": {"version": ENGINE_VERSION, "constants": dict(CONSTANTS_STAMP)},
            }
            record_bytes = fsio.write_json(cdir / COMPARISON_FILE, record)
            manifest = {
                "manifest_version": COMPARISON_MANIFEST_VERSION,
                "comparison_id": comparison_id,
                "created_at": now,
                "engine_version": ENGINE_VERSION,
                "files": {
                    "comparison_json": {
                        "file": COMPARISON_FILE,
                        "sha256_created": fsio.sha256_bytes(record_bytes),
                    },
                    "model": {
                        "file": model_file,
                        "version": 1,
                        "sha256": record["outputs"]["model_sha256"],
                    },
                    "pdf": None,
                },
                "members": [
                    {
                        "position": s["position"],
                        "session_id": s["session_id"],
                        "camel_id": s["camel_id"],
                        "overlay": {
                            "file": s["overlay_file"],
                            "version": s["overlay_version"],
                            "sha256": s["overlay_sha256"],
                        },
                        "report_model": {
                            "file": s["report_model_file"],
                            "version": s["report_model_version"],
                            "sha256": s["report_model_sha256"],
                        },
                        "session_json": {"sha256_at_creation": s["session_json_sha256"]},
                    }
                    for s in snapshots
                ],
                "probes": None,
                "history": [
                    {
                        "event": "created",
                        "at": now,
                        "n_members": len(snapshots),
                        "model_version": 1,
                        "model_sha256": record["outputs"]["model_sha256"],
                    }
                ],
            }
            self._write_manifest(record, manifest)
        except BaseException:
            shutil.rmtree(cdir, ignore_errors=True)
            raise
        return record, self._index(record)

    def _allocate(self) -> tuple[str, Path]:
        for _ in range(5):
            comparison_id = new_session_id()
            cdir = self.dir / comparison_id
            try:
                cdir.mkdir(parents=False, exist_ok=False)
                return comparison_id, cdir
            except FileExistsError:
                continue
        raise Conflict(  # pragma: no cover - five 24-bit collisions in one second
            "could not allocate a comparison id", code="comparison_id_collision"
        )

    # ----- view -----
    def member_states(self, record: dict[str, Any]) -> list[dict[str, Any]]:
        """Each member's current state from its files (authoritative): stale reasons, notes
        and the approval proof (F2.2, F2.7)."""
        out: list[dict[str, Any]] = []
        sealed_here = int((record.get("outputs") or {}).get("report_version") or 0) > 0
        for snap in record["members"]:
            current, doc, raw = self._member_now(snap["session_id"])
            session_sha = fsio.sha256_bytes(raw) if raw is not None else None
            reasons = cm.stale_reasons(_snapshot_fields(snap), current)
            notes: list[str] = []
            if not reasons and session_sha and session_sha != snap.get("session_json_sha256"):
                notes.append("member_session_changed")
            by_session = (
                doc is not None
                and not reasons
                and cm.approved_by_seal(
                    {
                        "status": doc.status,
                        "outputs_stale": doc.outputs_stale,
                        "overlay_version": doc.outputs.overlay_version,
                        "report_version": doc.outputs.report_version,
                        "report_overlay_version": doc.outputs.report_overlay_version,
                    }
                )
            )
            out.append(
                {
                    "snapshot": snap,
                    "current": current,
                    "stale_reasons": reasons,
                    "notes": notes,
                    # this comparison's own seal showed the same image (its members are fixed)
                    "approved_by_seal": bool(not reasons and (by_session or sealed_here)),
                }
            )
        return out

    def _member_now(self, session_id: str) -> tuple[dict[str, Any] | None, Any, bytes | None]:
        """(current state for ``stale_reasons``, the document, the ``session.json`` bytes);
        a deleted session is (None, None, None), an unreadable one has no document."""
        path = self.sessions.sessions_dir / session_id / "session.json"
        try:
            raw = fsio.read_bytes(path)
        except FileNotFoundError:
            return None, None, None
        except OSError:
            return {"index_state": "corrupt"}, None, None
        try:
            doc = parse_session(raw, path)
        except EngineError:
            return {"index_state": "corrupt"}, None, None
        current = {
            "index_state": "ok",
            "status": doc.status,
            "outputs_stale": doc.outputs_stale,
            "revision": doc.revision,
            "input_sha256": document_input_sha256(doc),
            "overlay_version": doc.outputs.overlay_version,
            "overlay_sha256": doc.outputs.overlay_sha256 or "",
        }
        return current, doc, raw

    # ----- cover and language (F2.6) -----
    def patch_inputs(
        self,
        comparison_id: str,
        *,
        cover: Any = None,
        language: Any = None,
        app_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """A cover or language change writes model v+1 from vN (no member file is read);
        a sealed PDF then shows the previous texts (``report_stale``) until it is printed
        again. An unchanged request writes nothing."""
        with self.locked(comparison_id):
            record = self.load(comparison_id)
            new_cover = self.validated_cover(record["cover"], cover)
            new_language = self.validated_language(language, record["language"])
            if new_cover == record["cover"] and new_language == record["language"]:
                return record
            cdir = self.comparison_dir(comparison_id)
            outputs = record["outputs"]
            model_bytes = fsio.read_bytes(cdir / outputs["model_file"])
            if fsio.sha256_bytes(model_bytes) != outputs["model_sha256"]:
                raise Conflict(
                    "the comparison model changed after it was written",
                    code="comparison_assets_changed",
                    details={"files": [outputs["model_file"]]},
                )
            version = int(outputs["model_version"]) + 1
            now = iso_now()
            versions = self._stamped_versions(record.get("versions") or {}, app_meta)
            model = cm.revise_model(
                jsonsafe.loads_strict(model_bytes),
                version=version,
                language=new_language,
                cover=new_cover,
                generated_at=now,
                versions=versions,
            )
            model_file = f"comparison_model_v{version}.json"
            written = fsio.write_json(cdir / model_file, model)
            outputs.update(
                {
                    "model_version": version,
                    "model_file": model_file,
                    "model_sha256": fsio.sha256_bytes(written),
                }
            )
            record.update(
                {
                    "cover": new_cover,
                    "language": new_language,
                    "updated_at": now,
                    "versions": versions,
                    "required_report_texts": cm.required_texts(model),
                    "report_stale": bool(outputs.get("report_file")),
                }
            )
            self._write_record(record)
            manifest = self._manifest(comparison_id)
            manifest.setdefault("files", {})["model"] = {
                "file": model_file,
                "version": version,
                "sha256": outputs["model_sha256"],
            }
            manifest.setdefault("history", []).append(
                {
                    "event": "inputs_changed",
                    "at": now,
                    "model_version": version,
                    "model_sha256": outputs["model_sha256"],
                }
            )
            self._write_manifest(record, manifest)
            self._index(record)
            return record

    # ----- the seal (F2.9, F2.10) -----
    def _evidence(self, record: dict[str, Any], model: dict[str, Any]) -> list[MemberEvidence]:
        """Each member's evidence, read under the member locks and checked against its
        snapshot: a stale member is ``comparison_stale`` (every one listed), a changed image or
        report model ``session_assets_changed``."""
        stale: list[dict[str, Any]] = []
        changed: list[dict[str, Any]] = []
        evidence: list[MemberEvidence] = []
        texts = {m.get("session_id"): cm.member_texts(m) for m in model.get("members") or []}
        for snap in record["members"]:
            session_id = snap["session_id"]
            current, _doc, raw = self._member_now(session_id)
            reasons = cm.stale_reasons(_snapshot_fields(snap), current)
            if reasons or raw is None:
                stale.append(
                    {
                        "position": snap["position"],
                        "session_id": session_id,
                        "stale_reasons": reasons or ["member_unreadable"],
                    }
                )
                continue
            sdir = self.sessions.sessions_dir / session_id
            files: dict[str, bytes] = {}
            for name, sha in (
                (snap["overlay_file"], snap["overlay_sha256"]),
                (snap["report_model_file"], snap["report_model_sha256"]),
            ):
                try:
                    data = fsio.read_bytes(sdir / name)
                except OSError:
                    data = b""
                if fsio.sha256_bytes(data) != sha:
                    changed.append(
                        {"position": snap["position"], "session_id": session_id, "file": name}
                    )
                files[name] = data
            evidence.append(
                MemberEvidence(
                    position=int(snap["position"]),
                    session_id=session_id,
                    overlay_png=files[snap["overlay_file"]],
                    overlay_name=snap["overlay_file"],
                    session_json=raw,
                    report_model_json=files[snap["report_model_file"]],
                    report_model_name=snap["report_model_file"],
                    texts=tuple(texts.get(session_id) or ()),
                )
            )
        if stale:
            raise Conflict(
                "a camel changed since the comparison was made: compare again",
                code="comparison_stale",
                details={"members": stale},
            )
        if changed:
            raise Conflict(
                "a camel's image or report data changed after finalize",
                code="session_assets_changed",
                details={"members": changed},
            )
        return evidence

    def _moved_since(self, record: dict[str, Any]) -> list[dict[str, Any]]:
        """The members that changed while the PDF was probed (the second look, F2.9)."""
        moved: list[dict[str, Any]] = []
        for snap in record["members"]:
            current, _doc, raw = self._member_now(snap["session_id"])
            reasons = cm.stale_reasons(_snapshot_fields(snap), current)
            if not reasons and raw is not None:
                overlay = self.sessions.sessions_dir / snap["session_id"] / snap["overlay_file"]
                try:
                    if fsio.sha256_file(overlay) != snap["overlay_sha256"]:
                        reasons = ["member_refinalized"]
                except OSError:
                    reasons = ["member_unreadable"]
            if reasons or raw is None:
                moved.append(
                    {
                        "position": snap["position"],
                        "session_id": snap["session_id"],
                        "stale_reasons": reasons or ["member_unreadable"],
                    }
                )
        return moved

    def _keep_rejected(
        self, record: dict[str, Any], version: int, pdf_bytes: bytes, failures: list[str]
    ) -> str:
        """The refused print, kept as evidence (D7), and its manifest event."""
        cdir = self.comparison_dir(record["comparison_id"])
        rejected = rejected_report_name(version)
        while (cdir / rejected).exists():  # pragma: no cover - same ms and 16 bits
            rejected = rejected_report_name(version)
        fsio.atomic_write_bytes(cdir / rejected, pdf_bytes)
        manifest = self._manifest(record["comparison_id"])
        manifest.setdefault("history", []).append(
            {
                "event": "report_rejected",
                "at": iso_now(),
                "file": rejected,
                "sha256": fsio.sha256_bytes(pdf_bytes),
                "hard_failures": list(failures),
            }
        )
        self._write_manifest(record, manifest)
        return rejected

    def attach_report(
        self,
        comparison_id: str,
        pdf_bytes: bytes,
        *,
        expected_model_sha256: str | None,
        app_meta: dict[str, Any] | None = None,
        require_text: bool = True,
        require_font: bool = True,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Seal the app-printed comparison (F2.9): probe, attach, version, manifest; returns
        (record, probe). Lock order: this comparison's lock for the whole seal, the member
        session locks (sorted) only to read the evidence and again to re-check and write — the
        probe runs without them, and a member that changed meanwhile is ``comparison_stale``
        with the print kept. A refused print is kept as ``report_v<N>.rejected_<utc ms>_<hex>.pdf``
        and the 409 carries the probe."""
        with self.locked(comparison_id):
            record = self.load(comparison_id)
            outputs = record["outputs"]
            sent = (expected_model_sha256 or "").strip().lower()
            details = {
                "expected": outputs["model_sha256"],
                "sent": expected_model_sha256,
                "model_version": outputs["model_version"],
            }
            if not sent:
                raise Unprocessable(
                    "send X-Comparison-Model-Sha256: the sha256 of the comparison model the page "
                    "was printed from",
                    code="comparison_model_sha_required",
                    details=details,
                )
            if sent != outputs["model_sha256"]:
                raise Conflict(
                    "the page was printed from another comparison model (cover or language "
                    "changed?)",
                    code="comparison_model_mismatch",
                    details=details,
                )
            cdir = self.comparison_dir(comparison_id)
            model_bytes = fsio.read_bytes(cdir / outputs["model_file"])
            if fsio.sha256_bytes(model_bytes) != outputs["model_sha256"]:
                raise Conflict(
                    "the comparison model changed after it was written",
                    code="comparison_assets_changed",
                    details={"files": [outputs["model_file"]]},
                )
            model = jsonsafe.loads_strict(model_bytes)
            ids = [m["session_id"] for m in record["members"]]
            with self.member_locks(ids):
                evidence = self._evidence(record, model)
            final_bytes, probe = finalize_comparison_pdf(
                pdf_bytes,
                members=evidence,
                model_name=outputs["model_file"],
                model_json=model_bytes,
                required=cm.required_texts(model),
                require_text=require_text,
                require_font=require_font,
                metadata={
                    "NazeerComparison": comparison_id,
                    "NazeerComparisonModelSha256": outputs["model_sha256"],
                },
            )
            version = int(outputs.get("report_version") or 0) + 1
            if probe["verdict"] != "PASS":
                rejected = self._keep_rejected(record, version, pdf_bytes, probe["hard_failures"])
                raise Conflict(
                    "the printed PDF does not carry the approved images or the required text",
                    code=probe["hard_failures"][0],
                    details={"probe": probe, "rejected_file": rejected},
                )
            with self.member_locks(ids):
                moved = self._moved_since(record)
                if moved:
                    rejected = self._keep_rejected(record, version, pdf_bytes, ["comparison_stale"])
                    raise Conflict(
                        "a camel changed while the PDF was being checked: compare again",
                        code="comparison_stale",
                        details={"members": moved, "rejected_file": rejected, "probe": probe},
                    )
                return self._write_report(record, version, final_bytes, probe, evidence, app_meta)

    def _write_report(
        self,
        record: dict[str, Any],
        version: int,
        final_bytes: bytes,
        probe: dict[str, Any],
        evidence: list[MemberEvidence],
        app_meta: dict[str, Any] | None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        comparison_id = record["comparison_id"]
        cdir = self.comparison_dir(comparison_id)
        outputs = record["outputs"]
        report_file = f"report_v{version}.pdf"
        fsio.atomic_write_bytes(cdir / report_file, final_bytes)
        re_export = record["status"] == "sealed"
        now = iso_now()
        outputs.update(
            {
                "report_version": version,
                "report_file": report_file,
                "report_sha256": fsio.sha256_bytes(final_bytes),
                "report_model_version": outputs["model_version"],
            }
        )
        record.update(
            {
                "status": "sealed",
                "report_stale": False,
                "updated_at": now,
                "versions": self._stamped_versions(record.get("versions") or {}, app_meta),
            }
        )
        self._write_record(record)
        manifest = self._manifest(comparison_id)
        manifest.setdefault("files", {})["pdf"] = {
            "file": report_file,
            "sha256": outputs["report_sha256"],
            "bytes": len(final_bytes),
            "n_pages": probe["n_pages"],
            "model_version": outputs["model_version"],
        }
        pixel = {m["position"]: m for m in probe["pixel"]["members"]}
        attached = {e.position: fsio.sha256_bytes(e.session_json) for e in evidence}
        for entry in manifest.get("members") or []:
            position = entry.get("position")
            found = pixel.get(position) or {}
            entry.setdefault("overlay", {}).update(
                {"page": found.get("page"), "max_abs_diff": found.get("max_abs_diff")}
            )
            session_entry = entry.setdefault("session_json", {})
            session_entry["sha256_attached"] = attached.get(position)
            entry["notes"] = (
                ["member_session_changed"]
                if attached.get(position) != session_entry.get("sha256_at_creation")
                else []
            )
        manifest["probes"] = probe
        manifest["printer"] = {key: (app_meta or {}).get(key) for key in APP_KEYS}
        manifest.setdefault("history", []).append(
            {
                "event": "re-exported" if re_export else "exported",
                "at": now,
                "report_version": version,
                "model_version": outputs["model_version"],
                "pdf_sha256": outputs["report_sha256"],
            }
        )
        self._write_manifest(record, manifest)
        self._index(record)
        return record, probe

    def report_path(self, comparison_id: str, version: int | None = None) -> Path:
        record = self.load(comparison_id)
        number = version or int(record["outputs"].get("report_version") or 0)
        if not number:
            raise NotFound("no report sealed yet", code="report_not_found")
        return self.asset_path(comparison_id, f"report_v{number}.pdf")

    # ----- delete -----
    def delete(self, comparison_id: str) -> dict[str, Any]:
        with self.locked(comparison_id, blocking=False):
            cdir = self.comparison_dir(comparison_id)
            if not cdir.is_dir():
                if self.history.delete_comparison(comparison_id):
                    return {"deleted": True, "trashed_to": None, "note": "index row only"}
                raise NotFound(
                    "comparison not found",
                    code="comparison_not_found",
                    details={"comparison_id": comparison_id},
                )
            target = self.trash_dir / f"comparison_{comparison_id}"
            if target.exists():
                target = self.trash_dir / f"comparison_{comparison_id}_{_stamp()}"
            try:
                fsio.replace_with_retries(cdir, target)
            except (AtomicWriteError, OSError) as exc:
                self.history.mark_comparison(comparison_id, "delete_failed", str(exc))
                raise Conflict(
                    "the comparison folder could not be moved to the trash (is a file open?)",
                    code="delete_failed",
                    details={"comparison_id": comparison_id, "error": str(exc)},
                ) from exc
            self.history.delete_comparison(comparison_id)
            return {"deleted": True, "trashed_to": str(target)}

    def stats(self) -> dict[str, int]:
        entries = [e for e in self.dir.iterdir() if e.is_dir()] if self.dir.is_dir() else []
        return {"count": len(entries), "bytes": sum(fsio.dir_size_bytes(e) for e in entries)}


# ----- module helpers ---------------------------------------------------------------------------


def parse_session(raw: bytes, path: Path) -> SessionDocument:
    """``session.json`` bytes as a document, with ``load_session``'s error mapping."""
    try:
        data = jsonsafe.loads_strict(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise CorruptFileError(
            f"corrupt JSON file {path.name}: {exc}", details={"path": str(path)}
        ) from exc
    if not isinstance(data, dict):
        raise CorruptFileError("session.json is not a JSON object", details={"path": str(path)})
    try:
        return SessionDocument.from_dict(data)
    except UnsupportedSchemaVersion:
        raise
    except (KeyError, ValueError, TypeError, AttributeError, OverflowError) as exc:
        raise CorruptFileError(
            f"session.json does not have the 2.1 shape: {type(exc).__name__}: {exc}",
            details={"path": str(path)},
        ) from exc


def load_record(path: Path) -> dict[str, Any]:
    """Strict ``comparison.json`` load: a wrong shape is ``CorruptFileError``, another schema
    version ``UnsupportedSchemaVersion``."""
    data = fsio.read_json(path)
    if not isinstance(data, dict):
        raise CorruptFileError("comparison.json is not a JSON object", details={"path": str(path)})
    version = str(data.get("schema_version", ""))
    if version != COMPARISON_SCHEMA_VERSION:
        raise UnsupportedSchemaVersion(
            f"unsupported comparison schema_version {version!r}",
            details={"schema_version": version, "expected": COMPARISON_SCHEMA_VERSION},
        )
    problems: list[str] = []
    if not isinstance(data.get("comparison_id"), str):
        problems.append("comparison_id")
    if data.get("status") not in cm.COMPARISON_STATUSES:
        problems.append("status")
    if data.get("language") not in LANGUAGES:
        problems.append("language")
    if not isinstance(data.get("cover"), dict):
        problems.append("cover")
    outputs = data.get("outputs")
    if not isinstance(outputs, dict) or not isinstance(outputs.get("model_file"), str):
        problems.append("outputs")
    members = data.get("members")
    if not isinstance(members, list) or not members:
        problems.append("members")
    else:
        for i, member in enumerate(members):
            if not isinstance(member, dict) or any(k not in member for k in SNAPSHOT_KEYS):
                problems.append(f"members[{i}]")
    if problems:
        raise CorruptFileError(
            f"comparison.json does not have the 1.0 shape: {', '.join(problems)}",
            details={"path": str(path), "fields": problems},
        )
    return data


def _snapshot_fields(snap: dict[str, Any]) -> dict[str, Any]:
    return {
        "revision": snap.get("revision"),
        "input_sha256": snap.get("input_sha256"),
        "overlay_version": snap.get("overlay_version"),
        "overlay_sha256": snap.get("overlay_sha256"),
    }
