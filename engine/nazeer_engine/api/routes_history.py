"""History housekeeping: rebuild the derived index, back it up, report disk use."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends

from .. import candidate_cache as cache
from ..errors import EngineError, ServiceUnavailable, Unprocessable
from ..jsonsafe import FiniteJSONResponse
from .deps import engine, errors
from .schemas import BackupIn, BackupOut, HistoryStats
from .state import EngineState

router = APIRouter(tags=["history"])


@router.post(
    "/history/rebuild",
    response_model=dict[str, int],
    summary="Rebuild the index from the session folders",
)
def rebuild_history(state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    return FiniteJSONResponse(state.store.rebuild_index())


@router.post(
    "/history/backup",
    response_model=BackupOut,
    responses=errors(422, 503),
    summary="Online backup of history.sqlite (Connection.backup)",
)
def backup_history(body: BackupIn, state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    if body.path:
        target = Path(body.path)
        if not target.is_absolute():
            raise Unprocessable("backup path must be absolute", code="invalid_field")
    else:
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        target = state.data_root / "backups" / f"history_{stamp}.sqlite"
    try:
        size = state.history.backup(target)
    except (OSError, sqlite3.Error, EngineError) as exc:
        message = getattr(exc, "message", None) or f"{type(exc).__name__}: {exc}"
        if body.path:  # the client's own path (missing drive, read-only folder, ...)
            raise Unprocessable(
                f"cannot write the backup there: {message}",
                code="backup_failed",
                details={"path": str(target)},
            ) from exc
        raise ServiceUnavailable(
            f"the history backup failed: {message}",
            code="backup_failed",
            details={"path": str(target)},
        ) from exc
    return FiniteJSONResponse({"path": str(target), "bytes": size})


@router.get(
    "/history/stats", response_model=HistoryStats, summary="Disk use of sessions, candidates, trash"
)
def history_stats(state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    backups = list((state.data_root / "backups").glob("*.sqlite"))
    return FiniteJSONResponse(
        {
            "sessions": state.store.sessions_stats(),
            "candidates": cache.cache_stats(state.data_root),
            "trash": state.store.trash_stats(),
            "index": state.history.stats(),
            "backups": {"count": len(backups), "bytes": sum(p.stat().st_size for p in backups)},
        }
    )
