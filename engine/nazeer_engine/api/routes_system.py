"""Health, versions, bilingual labels, shutdown."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends

from ..constants import ENGINE_VERSION
from ..jsonsafe import FiniteJSONResponse
from ..labels import labels_payload
from .deps import engine
from .schemas import Health
from .state import EngineState

router = APIRouter(tags=["system"])


@router.get("/health", response_model=Health, summary="Liveness, model, Arabic stack, active job")
def get_health(state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    seg = state.segmenter
    return FiniteJSONResponse(
        {
            "status": "ok",
            "engine_version": ENGINE_VERSION,
            "pid": state.pid,
            "run_id": state.run_id,
            "started_at": state.started_at,
            "uptime_s": time.monotonic() - state.started_monotonic,
            "data_root": str(state.data_root),
            "model": {
                "file": getattr(seg, "weights_name", None),
                "sha256": getattr(seg, "sha256", None),
                "stub": bool(getattr(seg, "is_stub", False)),
            },
            "warmup_ms": state.warmup_ms,
            "arabic_stack": state.arabic,
            "job": state.jobs.active(),
        },
        headers={"Cache-Control": "no-store"},
    )


@router.get("/versions", response_model=dict[str, Any], summary="Library-version stamp")
def get_versions(state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    return FiniteJSONResponse(state.versions)


@router.get(
    "/meta/labels",
    response_model=dict[str, Any],
    summary="Every code the engine emits, with Arabic and English labels",
)
def get_labels() -> FiniteJSONResponse:
    return FiniteJSONResponse(labels_payload(), headers={"Cache-Control": "private, max-age=3600"})


@router.post("/system/shutdown", status_code=202, summary="Graceful shutdown (supervisor)")
def shutdown_engine(state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    if state.shutdown is not None:
        state.shutdown()
    return FiniteJSONResponse({"shutting_down": True}, status_code=202)
