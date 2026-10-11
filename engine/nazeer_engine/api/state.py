"""Everything a request needs, built once at startup (``build_state``)."""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .. import candidate_cache as cache
from .. import fsio
from ..arabic import stack_status
from ..bagreader import BagInfo, FramePair, inspect_bag
from ..constants import BACKUP_INTERVAL_S, BACKUP_KEEP
from ..history import HistoryIndex
from ..jobs import CandidateJobManager
from ..recent import RecentBags
from ..segmenter import SegmenterLike
from ..session_store import SessionStore
from ..settings import Settings, ensure_layout
from ..versions import library_versions

log = logging.getLogger("nazeer_engine.state")


@dataclass
class EngineState:
    settings: Settings
    segmenter: SegmenterLike
    history: HistoryIndex
    store: SessionStore
    jobs: CandidateJobManager
    recent: RecentBags
    inspect_bag: Callable[[Path], BagInfo]
    versions: dict[str, Any]
    run_id: str
    pid: int
    started_at: str
    started_monotonic: float
    warmup_ms: float | None
    arabic: dict[str, Any]
    boot: dict[str, Any] = field(default_factory=dict)
    shutdown: Callable[[], None] | None = None

    @property
    def data_root(self) -> Path:
        return self.settings.data_root


def build_state(
    settings: Settings,
    *,
    segmenter: SegmenterLike,
    bag_iter: Callable[..., Iterable[FramePair]] | None = None,
    inspect: Callable[[Path], BagInfo] | None = None,
    warmup_ms: float | None = None,
) -> EngineState:
    """Layout, index, reconcile, housekeeping; never touches the network."""
    import time

    root = settings.data_root
    layout = ensure_layout(root)
    history = HistoryIndex(Path(layout["history_db"]))
    versions = library_versions(
        model_file=getattr(segmenter, "weights_name", None),
        model_sha256=getattr(segmenter, "sha256", None),
        data_root=root,
    )
    store = SessionStore(root, history, versions=lambda: dict(versions))
    jobs = CandidateJobManager(
        root,
        segmenter,
        bag_iter=bag_iter,
        inspect=inspect or inspect_bag,
        library_versions=versions,
    )
    run_id = uuid.uuid4().hex
    boot: dict[str, Any] = {}
    history.record_engine_run(run_id, os.getpid(), versions)
    boot["trash_purged"] = store.purge_trash()
    boot["temps_purged"] = fsio.purge_stale_temps(root / "sessions") + fsio.purge_stale_temps(
        root / "candidates"
    )
    boot["building_purged"] = cache.purge_building_dirs(root)
    boot["reconciled"] = store.reconcile()
    try:
        backup = history.auto_backup(
            root / "backups", interval_s=BACKUP_INTERVAL_S, keep=BACKUP_KEEP
        )
        boot["backup"] = str(backup) if backup else None
    except Exception as exc:  # a failed backup must not stop the engine; it is reported
        log.warning("history backup failed", extra={"error": str(exc)})
        boot["backup_error"] = str(exc)
    return EngineState(
        settings=settings,
        segmenter=segmenter,
        history=history,
        store=store,
        jobs=jobs,
        recent=RecentBags(Path(layout["recent"])),
        inspect_bag=inspect or inspect_bag,
        versions=versions,
        run_id=run_id,
        pid=os.getpid(),
        started_at=datetime.now(UTC).replace(microsecond=0).isoformat(),
        started_monotonic=time.monotonic(),
        warmup_ms=warmup_ms,
        arabic=stack_status(),
        boot=boot,
    )
