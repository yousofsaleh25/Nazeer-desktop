"""Session persistence, autosave and the status machine (contract C3).

* A session is one chosen candidate frame (assets copied into ``<root>/sessions/<id>/``)
  plus the operator's measurements in ``session.json`` (schema 2.1). The directory and
  ``session.json`` are written first, the history row second (C3.2); the files win.
* Autosave (C3.4): the renderer owns a monotonic ``revision``; ``revision <= stored`` is a
  409 ``stale_revision`` except the idempotent replay (same revision, identical inputs ->
  200 with the stored view, so a lost response never duplicates or conflicts). Writes are
  atomic (fsync + replace + retries) through ``fsio``.
* Status (C3.5): ``open`` -> finalize -> ``finalized`` -> report -> ``exported``. An edit on a
  non-open session reopens it (``outputs_stale``) and records the event in the manifest.
* The frame context (KNN tree, Z_ref, ...) is cached per session (LRU, B5); the copied
  frame assets are sha256-checked when the context is built.
* Delete = rename the folder into ``<root>/trash/`` then drop the index row; a failed
  rename stays visible as ``delete_failed``. Per-session locks are never evicted (B34).
"""

from __future__ import annotations

import logging
import re
import secrets
import shutil
import threading
from collections import OrderedDict
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import candidate_cache as cache
from . import fsio
from .constants import ENGINE_VERSION, FRAME_CONTEXT_CACHE, MANIFEST_VERSION, MAX_SAFE_INT
from .depthlookup import FrameContext, build_frame_context
from .errors import AtomicWriteError, Conflict, NotFound, Unprocessable
from .frames import copy_bundle
from .geometry import Intrinsics
from .history import HistoryIndex
from .maskstats import ground_rows
from .overlay import render_overlay_png
from .pdf_finalize import finalize_pdf
from .report_content import OBSERVATION_KEYS, RUBRIC_VARIANTS
from .report_model import build_report_model
from .session_compute import MeasurementInput, apply_inputs, parse_inputs
from .session_schema import (
    LANGUAGES,
    SESSION_ID_RE,
    ReportInputs,
    SessionDocument,
    document_etag,
    document_input_sha256,
    empty_document,
    iso_now,
    load_session,
    new_session_id,
    required_report_texts,
    save_session,
)

log = logging.getLogger("nazeer_engine.sessions")

FINGERPRINT_RE = re.compile(r"^[0-9a-f]{64}$")
PARAMS_HASH_RE = re.compile(r"^[0-9a-f]{16}$")
CANDIDATE_ID_RE = re.compile(r"^c\d{2}_\d{6}$")
FRAME_HASHED: tuple[str, ...] = ("rgb.png", "depth.npy", "mask.png", "intrinsics.json")
ASSET_RE = re.compile(
    r"^(rgb\.png|mask\.png|depth\.npy|thumb\.jpg|intrinsics\.json|stats\.json|session\.json"
    r"|report\.manifest\.json|overlay_v\d+\.png|report_model_v\d+\.json|report_v\d+\.pdf"
    r"|report_v\d+\.rejected_\d{8}T\d{6}(?:\d{3})?Z(?:_[0-9a-f]{4})?\.pdf)$"
)
MAX_CAMEL_ID = 64
MAX_OPERATOR = 100
MAX_NOTES = 4000
MAX_REPORT_NAME = 100
MAX_OBSERVATION = 2000
MANIFEST_FILE = "report.manifest.json"
APP_KEYS: tuple[str, ...] = ("app_version", "electron", "chromium")


@dataclass(frozen=True)
class FrameEntry:
    ctx: FrameContext
    frame_sha256: dict[str, str]


def _utc_stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


def _rejected_name(version: int) -> str:
    """``report_v<N>.rejected_<UTC to the ms>_<4 hex>.pdf``: two refusals in the same second
    never share a name (the evidence of the first is kept)."""
    now = datetime.now(UTC)
    stamp = now.strftime("%Y%m%dT%H%M%S") + f"{now.microsecond // 1000:03d}Z"
    return f"report_v{version}.rejected_{stamp}_{secrets.token_hex(2)}.pdf"


def _is_revision(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_SAFE_INT


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


class SessionStore:
    def __init__(
        self,
        data_root: Path | str,
        history: HistoryIndex,
        *,
        versions: Callable[[], dict[str, Any]] | None = None,
        cache_size: int = FRAME_CONTEXT_CACHE,
    ) -> None:
        self.root = Path(data_root)
        self.sessions_dir = self.root / "sessions"
        self.trash_dir = self.root / "trash"
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self.trash_dir.mkdir(parents=True, exist_ok=True)
        self.history = history
        self._versions = versions or (lambda: {})
        self._cache_size = max(1, int(cache_size))
        self._cache: OrderedDict[str, FrameEntry] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._locks: dict[str, threading.RLock] = {}
        self._locks_lock = threading.Lock()

    # ----- paths and locks -----
    def check_id(self, session_id: str) -> str:
        if not isinstance(session_id, str) or not SESSION_ID_RE.match(session_id):
            raise NotFound(
                "session not found", code="session_not_found", details={"session_id": session_id}
            )
        return session_id

    def session_dir(self, session_id: str) -> Path:
        return self.sessions_dir / self.check_id(session_id)

    def asset_path(self, session_id: str, name: str) -> Path:
        if not ASSET_RE.match(name or ""):
            raise NotFound("unknown asset", code="asset_not_found", details={"name": name})
        path = self.session_dir(session_id) / name
        if not path.is_file():
            raise NotFound("asset not found", code="asset_not_found", details={"name": name})
        return path

    def lock(self, session_id: str) -> threading.RLock:
        with self._locks_lock:
            lock = self._locks.get(session_id)
            if lock is None:
                lock = threading.RLock()
                self._locks[session_id] = lock
            return lock

    @contextmanager
    def locked(self, session_id: str, *, blocking: bool = True):
        lock = self.lock(session_id)
        if not lock.acquire(blocking=blocking):
            raise Conflict("session busy", code="session_busy", details={"session_id": session_id})
        try:
            yield
        finally:
            lock.release()

    # ----- documents -----
    def load(self, session_id: str) -> SessionDocument:
        path = self.session_dir(session_id) / "session.json"
        if not path.is_file():
            raise NotFound(
                "session not found", code="session_not_found", details={"session_id": session_id}
            )
        return load_session(path)

    def _save(self, doc: SessionDocument) -> None:
        sdir = self.session_dir(doc.session_id)
        save_session(doc, sdir / "session.json")
        self._index(doc)

    def _index(self, doc: SessionDocument) -> str:
        """Best-effort index update (the files are authoritative); returns the index state."""
        path = self.session_dir(doc.session_id) / "session.json"
        try:
            st = path.stat()
            self.history.upsert(doc, mtime_ns=st.st_mtime_ns, size=st.st_size)
            return "ok"
        except Exception as exc:  # the next reconcile repairs the index
            log.warning(
                "history upsert failed", extra={"session_id": doc.session_id, "error": str(exc)}
            )
            return "unindexed"

    @contextmanager
    def _try_lock(self, session_id: str):
        """Non-blocking session lock for the index reconcile; yields whether it was taken."""
        lock = self.lock(session_id)
        acquired = lock.acquire(blocking=False)
        try:
            yield acquired
        finally:
            if acquired:
                lock.release()

    def reconcile(self) -> dict[str, int]:
        return self.history.reconcile(self.sessions_dir, load_session, session_lock=self._try_lock)

    def rebuild_index(self) -> dict[str, int]:
        return self.history.rebuild(self.sessions_dir, load_session, session_lock=self._try_lock)

    # ----- frame context -----
    def frame(self, session_id: str, *, doc: SessionDocument | None = None) -> FrameEntry:
        with self._cache_lock:
            entry = self._cache.get(session_id)
            if entry is not None:
                self._cache.move_to_end(session_id)
                return entry
        doc = doc or self.load(session_id)
        sdir = self.session_dir(session_id)
        expected = dict(doc.frame_metadata.get("frame_sha256") or {})
        actual = {
            name: fsio.sha256_file(sdir / name) for name in FRAME_HASHED if (sdir / name).is_file()
        }
        changed = sorted(k for k in expected if expected.get(k) != actual.get(k))
        if changed:
            raise Conflict(
                "the session's frame files changed since the session was created",
                code="session_assets_changed",
                details={"files": changed},
            )
        depth = fsio.read_npy(sdir / "depth.npy")
        mask = fsio.read_image(sdir / "mask.png")
        if mask.ndim == 3:
            mask = mask[:, :, 0]
        intrinsics = Intrinsics.from_dict(fsio.read_json(sdir / "intrinsics.json"))
        ctx = build_frame_context(depth, mask, intrinsics)
        entry = FrameEntry(ctx=ctx, frame_sha256=actual)
        with self._cache_lock:
            self._cache[session_id] = entry
            self._cache.move_to_end(session_id)
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return entry

    def evict(self, session_id: str) -> None:
        with self._cache_lock:
            self._cache.pop(session_id, None)

    # ----- create -----
    def create(
        self,
        candidate: dict[str, Any],
        *,
        camel_id: str = "",
        operator: str = "",
        notes: str = "",
    ) -> tuple[SessionDocument, str]:
        """New session from a persisted candidate; returns (document, index_state)."""
        fingerprint = str(candidate.get("fingerprint", ""))
        params_hash = str(candidate.get("params_hash", ""))
        candidate_id = str(candidate.get("candidate_id", ""))
        if not (
            FINGERPRINT_RE.match(fingerprint)
            and PARAMS_HASH_RE.match(params_hash)
            and CANDIDATE_ID_RE.match(candidate_id)
        ):
            raise Unprocessable(
                "candidate reference must carry fingerprint, params_hash and candidate_id",
                code="invalid_candidate_ref",
                details={"candidate": candidate},
            )
        camel_id = _text(camel_id, "camel_id", MAX_CAMEL_ID)
        operator = _text(operator, "operator", MAX_OPERATOR)
        notes = _text(notes, "notes", MAX_NOTES)
        result_dir = cache.result_dir(self.root, fingerprint, params_hash)
        cand_dir = result_dir / candidate_id
        if not cache.result_exists(result_dir) or not all(
            (cand_dir / n).is_file() for n in FRAME_HASHED
        ):
            raise NotFound(
                "candidate not found (purged or never computed)",
                code="candidate_not_found",
                details={
                    "fingerprint": fingerprint,
                    "params_hash": params_hash,
                    "candidate_id": candidate_id,
                },
            )
        cache.touch(result_dir)
        cands = fsio.read_json(result_dir / cache.RESULT_FILE)
        entry = next(
            (c for c in cands.get("candidates", []) if c.get("candidate_id") == candidate_id), None
        )
        if entry is None:
            raise NotFound(
                "candidate not found",
                code="candidate_not_found",
                details={"candidate_id": candidate_id},
            )

        session_id = new_session_id()
        sdir = self.sessions_dir / session_id
        for _ in range(5):
            try:
                sdir.mkdir(parents=False, exist_ok=False)
                break
            except FileExistsError:
                session_id = new_session_id()
                sdir = self.sessions_dir / session_id
        else:  # pragma: no cover - five 24-bit collisions in one second
            raise Conflict("could not allocate a session id", code="session_id_collision")
        try:
            try:
                copy_bundle(cand_dir, sdir)
            except FileNotFoundError as exc:  # the candidate set was purged or republished
                raise NotFound(
                    "the candidate files disappeared (cache purged or rebuilt); reload the grid",
                    code="candidate_not_found",
                    details={"candidate_id": candidate_id, "error": str(exc)},
                ) from exc
            frame_sha = {name: fsio.sha256_file(sdir / name) for name in FRAME_HASHED}
            depth = fsio.read_npy(sdir / "depth.npy")
            mask = fsio.read_image(sdir / "mask.png")
            if mask.ndim == 3:
                mask = mask[:, :, 0]
            intr_record = fsio.read_json(sdir / "intrinsics.json")
            K = Intrinsics.from_dict(intr_record)
            ctx = build_frame_context(depth, mask, K)
            if ctx.z_ref.get("rejection_reason") != "ok":
                raise Unprocessable(
                    "the chosen frame has no valid depth on the camel",
                    code="frame_no_valid_depth",
                    details={"z_ref": ctx.z_ref},
                )
            ground = ground_rows(mask, depth, ctx.z_ref["z_ref_m"])
            stats = fsio.read_json(sdir / "stats.json") if (sdir / "stats.json").is_file() else {}
            bag = cands.get("bag", {})
            view = {
                "rgb": "rgb.png",
                "depth": "depth.npy",
                "mask": "mask.png",
                "intrinsics": "intrinsics.json",
                "thumb": "thumb.jpg",
                "operator_label": "",
                "bucket": entry.get("bucket"),
                "bag_name": bag.get("name"),
                "bag_path": bag.get("path"),
                "bag_fingerprint": fingerprint,
                "read_index": entry.get("read_index"),
                "frame_number_color": entry.get("frame_number_color"),
                "frame_number_depth": entry.get("frame_number_depth"),
                "color_timestamp_ms": entry.get("color_timestamp_ms"),
                "bag_time_s": entry.get("bag_time_s"),
                "candidate_id": candidate_id,
                "candidate_params_hash": params_hash,
            }
            intrinsics_block = dict(intr_record)
            intrinsics_block["distortion_note"] = "recorded; ignored by the pinhole math"
            view_metadata = {
                "width": ctx.width,
                "height": ctx.height,
                "z_ref": ctx.z_ref,
                "ground": ground,
                "depth_valid_bbox": ctx.depth_valid_bbox,
                "depth_units_m": intr_record.get("depth_units_m"),
                "intrinsics": intrinsics_block,
                "candidate_stats": stats,
                "candidate": {
                    "candidate_id": candidate_id,
                    "rank": entry.get("rank"),
                    "n_candidates": cands.get("n_candidates"),
                    "z_var": entry.get("z_var"),
                    "rel_disp": entry.get("rel_disp"),
                    "valid_fraction": entry.get("valid_frac"),
                    "params_hash": params_hash,
                    "sample_every": cands.get("sample_every_effective"),
                },
                "knn": ctx.info(),
                "model": dict(cands.get("model") or {}),
                "frame_sha256": frame_sha,
            }
            doc = empty_document(
                session_id=session_id,
                camel_id=camel_id,
                operator=operator,
                notes=notes,
                view=view,
                view_metadata=view_metadata,
                library_versions=self._versions(),
            )
            save_session(doc, sdir / "session.json")
        except BaseException:
            shutil.rmtree(sdir, ignore_errors=True)
            raise
        index_state = self._index(doc)
        with self._cache_lock:
            self._cache[session_id] = FrameEntry(ctx=ctx, frame_sha256=frame_sha)
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return doc, index_state

    # ----- autosave -----
    def save_document(
        self,
        session_id: str,
        revision: Any,
        payload: dict[str, Any],
        *,
        if_match: str | None = None,
    ) -> SessionDocument:
        """Whole-document autosave with the C3.4 revision rule (see module docstring).

        ``camel_id`` / ``operator`` / ``notes`` missing or ``None`` keep the stored value.
        Order of the checks, all under the session lock: the idempotent replay of the stored
        revision wins first (a retried save whose response was lost, whatever its
        ``If-Match``); then ``revision <= stored`` → 409; then ``If-Match`` against
        :func:`document_etag` → 409; an unchanged document never reopens a sealed session."""
        if not _is_revision(revision):
            raise Unprocessable(
                f"revision must be an integer in 0..{MAX_SAFE_INT}", code="invalid_revision"
            )
        inputs = parse_inputs(payload.get("measurements", []))
        texts = {
            "camel_id": (payload.get("camel_id"), MAX_CAMEL_ID),
            "operator": (payload.get("operator"), MAX_OPERATOR),
            "notes": (payload.get("notes"), MAX_NOTES),
        }
        sent = {k: _text(v, k, limit) for k, (v, limit) in texts.items() if v is not None}
        next_id = payload.get("next_measurement_id")
        if next_id is not None and not _is_revision(next_id):
            raise Unprocessable("next_measurement_id must be an integer", code="invalid_field")
        with self.locked(session_id):
            doc = self.load(session_id)
            ctx = self.frame(session_id, doc=doc).ctx
            camel_id = sent.get("camel_id", doc.camel_id)
            operator = sent.get("operator", doc.operator)
            notes = sent.get("notes", doc.notes)
            same = self._same_inputs(doc, ctx, inputs, camel_id, operator, notes)
            if revision <= doc.revision:
                if revision == doc.revision and same:
                    return doc  # idempotent replay of a save whose response was lost
                raise Conflict(
                    "stale revision",
                    code="stale_revision",
                    details={"stored_revision": doc.revision, "sent_revision": revision},
                )
            etag = document_etag(doc)
            if if_match is not None and if_match.strip() not in ("*", etag):
                raise Conflict(
                    "If-Match does not match the stored document",
                    code="stale_revision",
                    details={"stored_revision": doc.revision, "if_match": if_match, "etag": etag},
                )
            if doc.status != "open":
                if same:
                    return doc  # nothing changed: keep the sealed outputs (no reopen)
                self._reopen(doc, reason="edited")
            doc.camel_id, doc.operator, doc.notes = camel_id, operator, notes
            apply_inputs(doc, ctx, inputs, next_measurement_id=next_id)
            doc.revision = revision
            doc.updated_at = iso_now()
            self._save(doc)
            return doc

    @staticmethod
    def _same_inputs(
        doc: SessionDocument,
        ctx: FrameContext,
        inputs: list[MeasurementInput],
        camel_id: str,
        operator: str,
        notes: str,
    ) -> bool:
        trial = SessionDocument.from_dict(doc.to_dict())
        trial.camel_id, trial.operator, trial.notes = camel_id, operator, notes
        apply_inputs(trial, ctx, inputs, next_measurement_id=doc.next_measurement_id)
        return document_input_sha256(trial) == document_input_sha256(doc)

    # ----- status machine -----
    def _manifest_path(self, session_id: str) -> Path:
        return self.session_dir(session_id) / MANIFEST_FILE

    def append_manifest_event(self, session_id: str, event: dict[str, Any]) -> None:
        path = self._manifest_path(session_id)
        if not path.is_file():
            return
        manifest = fsio.read_json(path)
        manifest.setdefault("history", []).append({"at": iso_now(), **event})
        fsio.write_json(path, manifest)

    def _reopen(self, doc: SessionDocument, *, reason: str) -> None:
        previous = doc.status
        had_outputs = bool(doc.outputs.overlay_version or doc.outputs.report_version)
        doc.status = "open"
        doc.outputs_stale = had_outputs
        if doc.outputs.report_file:
            doc.report_stale = True
        if not self._manifest_path(doc.session_id).is_file():
            return
        manifest = self._manifest(doc)
        at = iso_now()
        event: dict[str, Any] = {
            "event": "reopened",
            "at": at,
            "reason": reason,
            "previous_status": previous,
        }
        pdf = (manifest.get("files") or {}).get("pdf")
        if doc.outputs.report_file:
            event["superseded_pdf"] = doc.outputs.report_file
            event["sha256"] = doc.outputs.report_sha256
            if isinstance(pdf, dict):
                pdf["superseded_at"] = at  # the file stays; it no longer reflects the session
        manifest.setdefault("history", []).append(event)
        self._write_manifest(doc, manifest)  # top-level status follows the session

    def reopen(self, session_id: str) -> SessionDocument:
        with self.locked(session_id):
            doc = self.load(session_id)
            if doc.status == "open":
                return doc
            self._reopen(doc, reason="explicit")
            doc.updated_at = iso_now()
            self._save(doc)
            return doc

    # ----- report inputs, finalize, report (ADR-D7, C3.5, C3.7, B19, B22) -----
    @staticmethod
    def _validated_report_inputs(current: ReportInputs, raw: Any) -> ReportInputs:
        if raw is None:
            return current
        if not isinstance(raw, dict):
            raise Unprocessable("report inputs must be an object", code="invalid_field")
        language = raw.get("language", current.language)
        if language not in LANGUAGES:
            raise Unprocessable(
                "language must be 'ar', 'en' or 'both'",
                code="invalid_field",
                details={"field": "language"},
            )
        variant = raw.get("rubric_variant", current.rubric_variant)
        if variant not in RUBRIC_VARIANTS:
            raise Unprocessable(
                "rubric_variant must be 'mjaheem' or 'maghateer'",
                code="invalid_field",
                details={"field": "rubric_variant"},
            )
        names = dict(current.names)
        raw_names = raw.get("names")
        if raw_names is not None:
            if not isinstance(raw_names, dict) or set(raw_names) - {"judge", "council", "event"}:
                raise Unprocessable(
                    "names takes judge, council and event",
                    code="invalid_field",
                    details={"field": "names"},
                )
            for key, value in raw_names.items():
                names[key] = _text(value, f"names.{key}", MAX_REPORT_NAME)
        observations = dict(current.observations)
        raw_obs = raw.get("observations")
        if raw_obs is not None:
            if not isinstance(raw_obs, dict) or set(raw_obs) - set(OBSERVATION_KEYS):
                raise Unprocessable(
                    f"observations takes {list(OBSERVATION_KEYS)}",
                    code="invalid_field",
                    details={"field": "observations"},
                )
            for key, value in raw_obs.items():
                observations[key] = _text(value, f"observations.{key}", MAX_OBSERVATION)
        return ReportInputs(
            language=language, rubric_variant=variant, names=names, observations=observations
        )

    @staticmethod
    def _stamp_app(doc: SessionDocument, app_meta: dict[str, Any] | None) -> None:
        """Electron / Chromium / app version into the library-version stamp (eng. rule)."""
        for key in APP_KEYS:
            value = (app_meta or {}).get(key)
            if value:
                doc.library_versions[key] = str(value)[:100]

    @staticmethod
    def _overlay_block(doc: SessionDocument) -> dict[str, Any]:
        """The report model's overlay block — identical at finalize and at every later
        report-input change (the overlay never changes in between)."""
        out = doc.outputs
        return {
            "file": out.overlay_file,
            "version": out.overlay_version,
            "sha256": out.overlay_sha256,
            "width": out.overlay_width,
            "height": out.overlay_height,
            "frame_height": out.overlay_frame_height,
            "footer_px": out.overlay_footer_px,
        }

    def _write_report_model(self, doc: SessionDocument) -> str:
        """A new ``report_model_v<M>.json`` (never rewritten in place: an exported PDF keeps
        pointing at the exact model it carries); returns the file name."""
        version = int(doc.outputs.report_model_version or 0) + 1
        model_file = f"report_model_v{version}.json"
        model = build_report_model(doc, overlay=self._overlay_block(doc))
        model_bytes = fsio.write_json(self.session_dir(doc.session_id) / model_file, model)
        doc.outputs.report_model_version = version
        doc.outputs.report_model_file = model_file
        doc.outputs.report_model_sha256 = fsio.sha256_bytes(model_bytes)
        return model_file

    def _manifest(self, doc: SessionDocument) -> dict[str, Any]:
        path = self._manifest_path(doc.session_id)
        if path.is_file():
            return fsio.read_json(path)
        return {
            "manifest_version": MANIFEST_VERSION,
            "session_id": doc.session_id,
            "created_at": iso_now(),
            "engine_version": ENGINE_VERSION,
            "files": {},
            "history": [],
        }

    def _write_manifest(self, doc: SessionDocument, manifest: dict[str, Any]) -> None:
        manifest["updated_at"] = iso_now()
        manifest["status"] = doc.status
        manifest["overlay_version"] = doc.outputs.overlay_version
        manifest["report_version"] = doc.outputs.report_version
        manifest["versions"] = dict(doc.library_versions)
        fsio.write_json(self._manifest_path(doc.session_id), manifest)

    def patch_report_inputs(
        self, session_id: str, raw: Any, *, app_meta: dict[str, Any] | None = None
    ) -> SessionDocument:
        """Language / rubric variant / names / observations; on a finalized session the
        report model is rewritten (the overlay never changes) and an exported PDF is marked
        ``report_stale`` until it is reprinted."""
        with self.locked(session_id):
            doc = self.load(session_id)
            return self._patch_report_inputs_locked(doc, raw, app_meta)

    def _patch_report_inputs_locked(
        self, doc: SessionDocument, raw: Any, app_meta: dict[str, Any] | None
    ) -> SessionDocument:
        new_inputs = self._validated_report_inputs(doc.report_inputs, raw)
        if new_inputs.to_dict() == doc.report_inputs.to_dict():
            return doc  # nothing changed: no new model, an exported PDF stays current
        doc.report_inputs = new_inputs
        self._stamp_app(doc, app_meta)
        sealed = doc.status in ("finalized", "exported") and not doc.outputs_stale
        if sealed and doc.outputs.overlay_file and doc.outputs.report_model_file:
            model_file = self._write_report_model(doc)
            if doc.outputs.report_file:
                doc.report_stale = True  # the sealed PDF shows the previous inputs
            manifest = self._manifest(doc)
            manifest.setdefault("files", {})["report_model"] = {
                "file": model_file,
                "version": doc.outputs.report_model_version,
                "sha256": doc.outputs.report_model_sha256,
            }
            manifest.setdefault("history", []).append(
                {
                    "event": "report_inputs_changed",
                    "at": iso_now(),
                    "report_model_version": doc.outputs.report_model_version,
                    "report_model_sha256": doc.outputs.report_model_sha256,
                }
            )
            self._write_manifest(doc, manifest)
        doc.updated_at = iso_now()
        self._save(doc)
        return doc

    def finalize(
        self,
        session_id: str,
        revision: Any,
        *,
        report_inputs: Any = None,
        document: dict[str, Any] | None = None,
        app_meta: dict[str, Any] | None = None,
    ) -> SessionDocument:
        """Render the overlay once, write the report model, seal the session (C3.5).

        ``document`` (optional) is applied first as an autosave at ``revision`` so the engine
        finalizes exactly what the canvas shows. On a finalized, non-stale session at the
        same revision the call is idempotent (no new versions)."""
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise Unprocessable("revision must be a non-negative integer", code="invalid_revision")
        with self.locked(session_id):
            if document is not None:
                self.save_document(session_id, revision, document)
            doc = self.load(session_id)
            if revision != doc.revision:
                raise Conflict(
                    "stale revision",
                    code="stale_revision",
                    details={"stored_revision": doc.revision, "sent_revision": revision},
                )
            sealed = doc.status in ("finalized", "exported") and not doc.outputs_stale
            if sealed and doc.outputs.overlay_file:
                if report_inputs is not None:
                    return self._patch_report_inputs_locked(doc, report_inputs, app_meta)
                return doc
            if not doc.camel_id.strip():
                raise Unprocessable("set the camel id before finalizing", code="camel_id_required")
            doc.report_inputs = self._validated_report_inputs(doc.report_inputs, report_inputs)
            self._stamp_app(doc, app_meta)
            sdir = self.session_dir(session_id)
            bgr = fsio.read_image(sdir / "rgb.png")
            mask = fsio.read_image(sdir / "mask.png")
            if mask.ndim == 3:
                mask = mask[:, :, 0]
            png, meta = render_overlay_png(bgr[:, :, :3], doc, mask=mask)
            version = int(doc.outputs.overlay_version or 0) + 1
            overlay_file = f"overlay_v{version}.png"
            fsio.atomic_write_bytes(sdir / overlay_file, png)
            doc.outputs.overlay_version = version
            doc.outputs.overlay_file = overlay_file
            doc.outputs.overlay_sha256 = fsio.sha256_bytes(png)
            doc.outputs.overlay_width = meta["width"]
            doc.outputs.overlay_height = meta["height"]
            doc.outputs.overlay_frame_height = meta["frame_height"]
            doc.outputs.overlay_footer_px = meta["footer_px"]
            doc.outputs.manifest_file = MANIFEST_FILE
            doc.status = "finalized"
            doc.outputs_stale = False
            # a report printed from an earlier overlay no longer matches (re-export needed)
            doc.report_stale = bool(doc.outputs.report_file)
            doc.updated_at = iso_now()
            overlay_block = self._overlay_block(doc)
            model_file = self._write_report_model(doc)
            session_bytes = save_session(doc, sdir / "session.json")
            self._index(doc)
            manifest = self._manifest(doc)
            files = manifest.setdefault("files", {})
            files["session_json"] = {
                "file": "session.json",
                "sha256_finalized": fsio.sha256_bytes(session_bytes),
                "bytes": len(session_bytes),
            }
            files["overlay"] = overlay_block
            files["report_model"] = {
                "file": model_file,
                "version": doc.outputs.report_model_version,
                "sha256": doc.outputs.report_model_sha256,
            }
            files["pdf"] = None  # until this overlay is exported (earlier PDFs: see history)
            manifest["render"] = {
                "font_file": meta["font_file"],
                "font_sha256": meta["font_sha256"],
                "native_text_layout": meta["native_text_layout"],
                "rendered_at": meta["rendered_at"],
                "labels_moved": meta["labels_moved"],
            }
            manifest["probes"] = None
            manifest.setdefault("history", []).append(
                {
                    "event": "finalized",
                    "at": iso_now(),
                    "overlay_version": version,
                    "overlay_sha256": doc.outputs.overlay_sha256,
                    "revision": doc.revision,
                }
            )
            self._write_manifest(doc, manifest)
            return doc

    def attach_report(
        self,
        session_id: str,
        pdf_bytes: bytes,
        *,
        expected_overlay_sha256: str | None,
        expected_report_model_sha256: str | None = None,
        overlay_version: int | None = None,
        app_meta: dict[str, Any] | None = None,
        require_text: bool = True,
        require_font: bool = True,
    ) -> tuple[SessionDocument, dict[str, Any]]:
        """Seal the app-printed PDF (C3.7): probe, attach, version, manifest. A refused PDF
        is kept as ``report_v<N>.rejected_<utc ms>_<hex>.pdf`` and the 409 carries the probe.

        The caller names both the overlay and the report model it printed; a page printed
        from an older model (report inputs changed meanwhile) is refused, so the sealed PDF
        and its attached ``report_model.json`` always agree. The text and font probes are
        hard by default (B39); pass ``False`` to record them as soft failures instead."""
        with self.locked(session_id):
            doc = self.load(session_id)
            if (
                doc.status not in ("finalized", "exported")
                or doc.outputs_stale
                or not doc.outputs.overlay_file
                or not doc.outputs.report_model_file
            ):
                raise Conflict(
                    "finalize the session before attaching a report",
                    code="status_not_finalized",
                    details={"status": doc.status, "outputs_stale": doc.outputs_stale},
                )
            sent = (expected_overlay_sha256 or "").strip().lower()
            if sent != (doc.outputs.overlay_sha256 or "") or (
                overlay_version is not None and int(overlay_version) != doc.outputs.overlay_version
            ):
                raise Conflict(
                    "the printed overlay is not the approved one",
                    code="overlay_sha_mismatch",
                    details={
                        "expected": doc.outputs.overlay_sha256,
                        "sent": expected_overlay_sha256,
                        "overlay_version": doc.outputs.overlay_version,
                    },
                )
            model_sent = (expected_report_model_sha256 or "").strip().lower()
            model_details = {
                "expected": doc.outputs.report_model_sha256,
                "sent": expected_report_model_sha256,
                "report_model_version": doc.outputs.report_model_version,
            }
            if not model_sent:
                raise Unprocessable(
                    "send X-Report-Model-Sha256: the sha256 of the report model the page was "
                    "printed from",
                    code="report_model_sha_required",
                    details=model_details,
                )
            if model_sent != (doc.outputs.report_model_sha256 or ""):
                raise Conflict(
                    "the page was printed from another report model (report inputs changed?)",
                    code="report_model_mismatch",
                    details=model_details,
                )
            sdir = self.session_dir(session_id)
            overlay_png = fsio.read_bytes(sdir / doc.outputs.overlay_file)
            model_bytes = fsio.read_bytes(sdir / doc.outputs.report_model_file)
            changed = [
                name
                for name, data, sha in (
                    (doc.outputs.overlay_file, overlay_png, doc.outputs.overlay_sha256),
                    (doc.outputs.report_model_file, model_bytes, doc.outputs.report_model_sha256),
                )
                if fsio.sha256_bytes(data) != sha
            ]
            if changed:
                raise Conflict(
                    "an output file changed after finalize",
                    code="session_assets_changed",
                    details={"files": changed},
                )
            session_bytes = fsio.read_bytes(sdir / "session.json")
            final_bytes, probe = finalize_pdf(
                pdf_bytes,
                overlay_png=overlay_png,
                overlay_name=doc.outputs.overlay_file,
                session_json=session_bytes,
                report_model_json=model_bytes,
                names=required_report_texts(doc),
                require_text=require_text,
                require_font=require_font,
                metadata={
                    "NazeerSession": session_id,
                    "NazeerOverlaySha256": doc.outputs.overlay_sha256 or "",
                    "NazeerReportModelSha256": doc.outputs.report_model_sha256 or "",
                },
            )
            version = int(doc.outputs.report_version or 0) + 1
            if probe["verdict"] != "PASS":
                rejected = _rejected_name(version)
                while (sdir / rejected).exists():  # pragma: no cover - same ms and 16 bits
                    rejected = _rejected_name(version)
                fsio.atomic_write_bytes(sdir / rejected, pdf_bytes)
                manifest = self._manifest(doc)
                manifest.setdefault("history", []).append(
                    {
                        "event": "report_rejected",
                        "at": iso_now(),
                        "file": rejected,
                        "sha256": probe["sha256_in"],
                        "hard_failures": probe["hard_failures"],
                    }
                )
                self._write_manifest(doc, manifest)
                raise Conflict(
                    "the printed PDF does not carry the approved overlay or required text",
                    code=probe["hard_failures"][0],
                    details={"probe": probe, "rejected_file": rejected},
                )
            report_file = f"report_v{version}.pdf"
            fsio.atomic_write_bytes(sdir / report_file, final_bytes)
            re_export = doc.status == "exported"
            self._stamp_app(doc, app_meta)
            doc.outputs.report_version = version
            doc.outputs.report_file = report_file
            doc.outputs.report_sha256 = fsio.sha256_bytes(final_bytes)
            doc.outputs.report_overlay_version = doc.outputs.overlay_version
            doc.outputs.report_model_version_sealed = doc.outputs.report_model_version
            doc.status = "exported"
            doc.report_stale = False
            doc.updated_at = iso_now()
            after = save_session(doc, sdir / "session.json")
            self._index(doc)
            manifest = self._manifest(doc)
            files = manifest.setdefault("files", {})
            files["pdf"] = {
                "file": report_file,
                "sha256": doc.outputs.report_sha256,
                "bytes": len(final_bytes),
                "n_pages": probe["n_pages"],
                "overlay_version": doc.outputs.overlay_version,
                "report_model_version": doc.outputs.report_model_version,
            }
            session_entry = files.setdefault("session_json", {"file": "session.json"})
            session_entry["sha256_attached"] = fsio.sha256_bytes(session_bytes)
            session_entry["sha256_after_export"] = fsio.sha256_bytes(after)
            manifest["probes"] = probe
            manifest["printer"] = {key: (app_meta or {}).get(key) for key in APP_KEYS}
            manifest.setdefault("history", []).append(
                {
                    "event": "re-exported" if re_export else "exported",
                    "at": iso_now(),
                    "report_version": version,
                    "overlay_version": doc.outputs.overlay_version,
                    "pdf_sha256": doc.outputs.report_sha256,
                }
            )
            self._write_manifest(doc, manifest)
            return doc, probe

    # ----- delete -----
    def delete(self, session_id: str) -> dict[str, Any]:
        with self.locked(session_id, blocking=False):
            sdir = self.session_dir(session_id)
            if not sdir.is_dir():
                if self.history.delete(session_id):
                    return {"deleted": True, "trashed_to": None, "note": "index row only"}
                raise NotFound(
                    "session not found",
                    code="session_not_found",
                    details={"session_id": session_id},
                )
            self.evict(session_id)
            target = self.trash_dir / session_id
            if target.exists():
                target = self.trash_dir / f"{session_id}_{_utc_stamp()}"
            try:
                fsio.replace_with_retries(sdir, target)
            except (AtomicWriteError, OSError) as exc:
                self.history.mark(session_id, "delete_failed", str(exc))
                raise Conflict(
                    "the session folder could not be moved to the trash (is a file open?)",
                    code="delete_failed",
                    details={"session_id": session_id, "error": str(exc)},
                ) from exc
            self.history.delete(session_id)
            return {"deleted": True, "trashed_to": str(target)}

    def purge_trash(self) -> int:
        removed = 0
        for entry in self.trash_dir.iterdir() if self.trash_dir.is_dir() else []:
            try:
                if entry.is_dir():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
                removed += 1
            except OSError as exc:
                log.warning("trash purge failed", extra={"path": str(entry), "error": str(exc)})
        return removed

    def trash_stats(self) -> dict[str, int]:
        if not self.trash_dir.is_dir():
            return {"count": 0, "bytes": 0}
        entries = list(self.trash_dir.iterdir())
        return {
            "count": len(entries),
            "bytes": sum(fsio.dir_size_bytes(e) for e in entries if e.is_dir()),
        }

    def sessions_stats(self) -> dict[str, int]:
        entries = (
            [e for e in self.sessions_dir.iterdir() if e.is_dir()]
            if self.sessions_dir.is_dir()
            else []
        )
        return {"count": len(entries), "bytes": sum(fsio.dir_size_bytes(e) for e in entries)}
