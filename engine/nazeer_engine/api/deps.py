"""Shared route helpers."""

from __future__ import annotations

from typing import Any

from fastapi import Request

from ..errors import EngineError
from .schemas import ErrorOut
from .state import EngineState


def engine(request: Request) -> EngineState:
    state = request.app.state.engine
    if state is None:  # only an OpenAPI-dump app has no state
        raise EngineError("engine not initialised", code="engine_not_ready", status=503)
    return state


def errors(*codes: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI ``responses`` entries for the error body every route uses."""
    return {code: {"model": ErrorOut} for code in codes}


def app_meta(request: Request) -> dict[str, str | None]:
    """Electron / Chromium / app versions sent by the renderer (library-version stamp)."""
    return {
        "app_version": request.headers.get("x-app-version"),
        "electron": request.headers.get("x-electron"),
        "chromium": request.headers.get("x-chromium"),
    }
