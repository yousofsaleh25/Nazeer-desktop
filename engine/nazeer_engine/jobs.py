"""Candidate job manager (C2.8): one job at a time, a daemon thread, cooperative cancel /
stop events, progress snapshots safe to serialise while the walk mutates its counters."""

from __future__ import annotations

import copy
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import candidate_cache as cache
from .bagreader import BagInfo, FramePair, inspect_bag
from .candidates import CandidateParams, CandidateResult, run_candidate_walk
from .constants import JOB_HISTORY_KEEP
from .errors import Conflict, EngineError, JobCancelled, NotFound
from .segmenter import SegmenterLike

TERMINAL_STATES: frozenset[str] = frozenset({"done", "cancelled", "failed"})


def _iso_now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).replace(microsecond=0).isoformat()


@dataclass
class JobState:
    job_id: str
    bag_path: str
    fingerprint: str
    params_hash: str
    state: str = "queued"  # queued | running | cancelling | done | cancelled | failed
    stage: str = "queued"  # queued | opening | walking | ranking | persisting | done
    progress_fraction: float = 0.0
    counters: dict[str, Any] = field(
        default_factory=lambda: {
            "read": 0,
            "sampled": 0,
            "detected": 0,
            "passed": 0,
            "rejected_by_reason": {},
        }
    )
    eta_s: float | None = None
    elapsed_s: float = 0.0
    message: str = ""
    warnings: list[str] = field(default_factory=list)
    error: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    started_at: str = field(default_factory=_iso_now)
    finished_at: str | None = None
    _t0: float = field(default_factory=time.perf_counter, repr=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "bag_path": self.bag_path,
            "fingerprint": self.fingerprint,
            "params_hash": self.params_hash,
            "state": self.state,
            "stage": self.stage,
            "progress_fraction": self.progress_fraction,
            "counters": dict(self.counters),
            "eta_s": self.eta_s,
            "elapsed_s": self.elapsed_s,
            "message": self.message,
            "warnings": list(self.warnings),
            "error": copy.deepcopy(self.error),
            "result": copy.deepcopy(self.result),
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "terminal": self.state in TERMINAL_STATES,
        }


class CandidateJobManager:
    def __init__(
        self,
        cache_root: Path | str,
        segmenter: SegmenterLike,
        *,
        bag_iter: Callable[..., Iterable[FramePair]] | None = None,
        inspect: Callable[[Path], BagInfo] | None = None,
        library_versions: dict[str, Any] | None = None,
    ) -> None:
        self.cache_root = Path(cache_root)
        self.segmenter = segmenter
        self.bag_iter = bag_iter
        self.inspect = inspect or inspect_bag
        self.library_versions = dict(library_versions or {})
        self._lock = threading.Lock()
        self._active: JobState | None = None
        self._thread: threading.Thread | None = None
        self._cancel = threading.Event()
        self._stop = threading.Event()
        self._history: deque[JobState] = deque(maxlen=JOB_HISTORY_KEEP)

    # ----- queries -----
    def active(self) -> dict[str, Any] | None:
        with self._lock:
            return self._active.to_dict() if self._active else None

    def get(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            if self._active and self._active.job_id == job_id:
                return self._active.to_dict()
            for state in self._history:
                if state.job_id == job_id:
                    return state.to_dict()
        raise NotFound(f"job not found: {job_id}", code="job_not_found", details={"job_id": job_id})

    # ----- commands -----
    def start(
        self, bag_path: Path | str, params: CandidateParams, *, force: bool = False
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        """Returns (job_state, None) for a new job or (None, cached_ref) on a cache hit."""
        bag = Path(bag_path)
        info = self.inspect(bag)
        params = params.validated()
        ph = params.hash()
        final_dir = cache.result_dir(self.cache_root, info.fingerprint, ph)
        summary = None if force else cache.complete_summary(final_dir)
        if summary is not None:  # a walk stopped early is never a cache hit: it re-runs
            cache.touch(final_dir)
            return None, {
                "fingerprint": info.fingerprint,
                "params_hash": ph,
                "cached": True,
                **summary,
            }
        with self._lock:
            if self._active is not None and self._active.state not in TERMINAL_STATES:
                raise Conflict(
                    "a candidate job is already running",
                    code="job_busy",
                    details={"job_id": self._active.job_id},
                )
            job_id = uuid.uuid4().hex[:12]
            state = JobState(
                job_id=job_id, bag_path=str(bag), fingerprint=info.fingerprint, params_hash=ph
            )
            state.state = "queued"
            self._active = state
            self._cancel = threading.Event()
            self._stop = threading.Event()
            cancel, stop = self._cancel, self._stop
            self._thread = threading.Thread(
                target=self._run,
                args=(state, bag, params, info, cancel, stop),
                daemon=True,
                name=f"candidates-{job_id}",
            )
            self._thread.start()
            return state.to_dict(), None

    def cancel(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            if self._active is None or self._active.job_id != job_id:
                return self.get(job_id)
            if self._active.state not in TERMINAL_STATES:
                self._active.state = "cancelling"
                self._cancel.set()
            return self._active.to_dict()

    def stop(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            if self._active is None or self._active.job_id != job_id:
                return self.get(job_id)
            if self._active.state not in TERMINAL_STATES:
                self._active.message = "stopping: ranking the frames gathered so far"
                self._stop.set()
            return self._active.to_dict()

    def wait(self, timeout: float | None = None) -> None:
        thread = self._thread
        if thread is not None:
            thread.join(timeout)

    # ----- worker -----
    def _progress(self, state: JobState, event: dict[str, Any]) -> None:
        with self._lock:
            stage = str(event.get("stage", state.stage))
            state.stage = stage
            if state.state == "queued":
                state.state = "running"
            fraction = event.get("fraction")
            if fraction is not None:
                state.progress_fraction = min(1.0, max(0.0, float(fraction)))
            counters = event.get("counters")
            if counters:
                state.counters = copy.deepcopy(counters)
            warnings = event.get("warnings")
            if warnings:  # e.g. slow_media, visible while the slow walk is still running
                state.warnings = list(warnings)
            state.elapsed_s = time.perf_counter() - state._t0
            f = state.progress_fraction
            state.eta_s = (
                (state.elapsed_s / f - state.elapsed_s)
                if f >= 0.05 and stage == "walking"
                else None
            )

    def _run(
        self,
        state: JobState,
        bag: Path,
        params: CandidateParams,
        info: BagInfo,
        cancel: threading.Event,
        stop: threading.Event,
    ) -> None:
        with self._lock:
            if state.state == "queued":  # a cancel that arrived first keeps "cancelling"
                state.state = "running"
            state.stage = "opening"
        try:
            result: CandidateResult = run_candidate_walk(
                bag,
                params,
                segmenter=self.segmenter,
                cache_root=self.cache_root,
                job_id=state.job_id,
                bag_iter=self.bag_iter,
                bag_info=info,
                cancel=cancel,
                stop=stop,
                progress=lambda event: self._progress(state, event),
                library_versions=self.library_versions,
            )
            with self._lock:
                state.state = "done"
                state.stage = "done"
                state.progress_fraction = 1.0
                state.warnings = list(result.candidates_json.get("warnings", []))
                state.result = {
                    "fingerprint": result.fingerprint,
                    "params_hash": result.params_hash,
                    "n_candidates": result.candidates_json.get("n_candidates"),
                    "partial": result.candidates_json.get("partial"),
                    "cached": False,
                }
        except JobCancelled:
            self._cleanup_building(state)
            with self._lock:
                state.state = "cancelled"
                state.message = "cancelled by the operator"
        except EngineError as exc:
            self._cleanup_building(state)
            with self._lock:
                state.state = "failed"
                state.error = {"code": exc.code, "message": exc.message, "details": exc.details}
        except Exception as exc:  # never let the thread die silently
            self._cleanup_building(state)
            with self._lock:
                state.state = "failed"
                state.error = {
                    "code": "internal_error",
                    "message": f"{type(exc).__name__}: {exc}",
                    "details": {"type": type(exc).__name__},
                }
        finally:
            with self._lock:
                state.elapsed_s = time.perf_counter() - state._t0
                state.finished_at = _iso_now()
                state.eta_s = None
                self._history.appendleft(state)

    def _cleanup_building(self, state: JobState) -> None:
        import shutil

        directory = cache.building_dir(self.cache_root, state.fingerprint, state.job_id)
        shutil.rmtree(directory, ignore_errors=True)
