"""``create_app`` — the FastAPI application (one worker, 127.0.0.1, B16 conventions).

* Every error is ``{"error": {"code", "message", "details"}}`` with a stable ``code``.
* Every JSON body passes the finite-only normaliser (``FiniteJSONResponse``).
* Operation ids are the route function names (snake_case, unique) for
  ``openapi-typescript`` / RTK Query code generation.
* CORS for the Vite dev server and the packaged ``app://`` renderer; an optional token
  (``X-Nazeer-Token`` header or ``token`` query parameter for ``<img>`` / EventSource);
  FastAPI's built-in OpenTelemetry is switched off (no network, B26).
"""

from __future__ import annotations

import hmac
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import parse_qs

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Receive, Scope, Send

from ..constants import ENGINE_VERSION, THREADPOOL_TOKENS
from ..errors import EngineError
from ..jsonsafe import FiniteJSONResponse
from ..settings import dev_env_enabled
from . import routes_bags, routes_candidates, routes_history, routes_sessions, routes_system
from .state import EngineState

log = logging.getLogger("nazeer_engine.api")

TELEMETRY_OFF: dict[str, Any] = {
    "tracing": False,
    "metrics": False,
    "logs": False,
    "operation_spans": False,
    "auto_configure": False,
}
OPEN_PATHS = frozenset({"/health"})
ALLOWED_HEADERS = [
    "Content-Type",
    "X-Nazeer-Token",
    "X-Overlay-Sha256",
    "X-Overlay-Version",
    "X-Report-Model-Sha256",
    "X-App-Version",
    "X-Electron",
    "X-Chromium",
    "If-Match",
    "If-None-Match",
]
EXPOSED_HEADERS = ["ETag", "Location", "Content-Disposition"]
TAGS = [
    {"name": "system", "description": "Health, versions, bilingual labels"},
    {"name": "bags", "description": "Step 1 — open a D455 .bag"},
    {"name": "candidates", "description": "Step 2 — best frames by mask depth statistics"},
    {"name": "sessions", "description": "Steps 3-5 — measure, autosave, finalize, PDF"},
    {"name": "history", "description": "History index housekeeping"},
]
STATUS_CODES = {404: "not_found", 405: "method_not_allowed", 413: "payload_too_large"}


class TokenMiddleware:
    """Pure-ASGI shared-secret check; ``/health`` and CORS preflights stay open."""

    def __init__(self, app: ASGIApp, token: str) -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope.get("method") == "OPTIONS"
            or scope.get("path") in OPEN_PATHS
        ):
            await self.app(scope, receive, send)
            return
        sent = ""
        for key, value in scope.get("headers") or []:
            if key == b"x-nazeer-token":
                sent = value.decode("latin-1")
                break
        if not sent:
            query = parse_qs((scope.get("query_string") or b"").decode("latin-1"))
            sent = (query.get("token") or [""])[0]
        if not hmac.compare_digest(sent.encode(), self.token.encode()):
            response = FiniteJSONResponse(
                {
                    "error": {
                        "code": "unauthorized",
                        "message": "missing or wrong token",
                        "details": {},
                    }
                },
                status_code=401,
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


class ErrorMiddleware:
    """Pure-ASGI catch-all *inside* CORS: an unexpected exception becomes the uniform JSON
    500 carrying the CORS headers (Starlette's own catch-all runs outside every middleware,
    so a renderer on another origin could not read that body)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracking_send(message: dict[str, Any]) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as exc:
            if started:  # a streamed response broke midway: nothing valid can follow
                raise
            log.exception("unhandled error")
            if isinstance(exc, EngineError):
                response = FiniteJSONResponse(exc.to_body(), status_code=exc.status)
            else:
                response = _error("internal_error", f"{type(exc).__name__}: {exc}", 500)
            await response(scope, receive, send)


def _operation_id(route: APIRoute) -> str:
    return route.name


ERROR_REF = {"$ref": "#/components/schemas/ErrorOut"}
COMMON_ERRORS: dict[str, str] = {
    "401": "Missing or wrong token (only when the engine runs with --token); code unauthorized",
    "422": "Request validation (code validation_error) or a semantic 422 with its own code",
    "500": "Unexpected engine error (code internal_error) or a typed 500 such as corrupt_file",
    "503": "Engine not ready, or a file could not be saved (code save_failed)",
}


def uniform_error_responses(schema: dict[str, Any]) -> dict[str, Any]:
    """Make the OpenAPI document say what the wire says: every error response is ``ErrorOut``
    (FastAPI documents its own ``HTTPValidationError`` for 422, which this engine never
    sends), and 401 / 500 / 503 — possible on every route — are listed for codegen."""
    for path, item in (schema.get("paths") or {}).items():
        for operation in item.values():
            responses = operation.setdefault("responses", {})
            for code, description in COMMON_ERRORS.items():
                if code == "401" and path in OPEN_PATHS:
                    continue
                if code == "422" and "422" not in responses:
                    continue  # only routes that take parameters or a body can answer 422
                entry = responses.setdefault(code, {})
                if code == "422" or not entry.get("content"):  # 422: replace FastAPI's shape
                    entry["content"] = {"application/json": {"schema": dict(ERROR_REF)}}
                if code == "422" or not entry.get("description"):
                    entry["description"] = description
    components = schema.get("components", {}).get("schemas", {})
    for name in ("HTTPValidationError", "ValidationError"):
        components.pop(name, None)
    return schema


def _error(
    code: str, message: str, status: int, details: dict[str, Any] | None = None
) -> FiniteJSONResponse:
    return FiniteJSONResponse(
        {"error": {"code": code, "message": message, "details": details or {}}}, status_code=status
    )


def create_app(state: EngineState | None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        import anyio.to_thread

        anyio.to_thread.current_default_thread_limiter().total_tokens = THREADPOOL_TOKENS
        on_ready = getattr(app.state, "on_ready", None)
        if callable(on_ready):
            on_ready()
        yield
        if state is not None:
            try:
                state.history.checkpoint()
            except Exception as exc:  # shutdown must not fail on a busy index
                log.warning("wal checkpoint failed", extra={"error": str(exc)})

    dev = dev_env_enabled()
    app = FastAPI(
        title="Nazeer Engine",
        version=ENGINE_VERSION,
        summary="Camel body measurement engine for the Nazeer Desktop app (offline, localhost)",
        default_response_class=FiniteJSONResponse,
        generate_unique_id_function=_operation_id,
        openapi_tags=TAGS,
        telemetry=TELEMETRY_OFF,
        lifespan=lifespan,
        # the interactive pages load Swagger / ReDoc from a CDN: dev only (no network rule);
        # /openapi.json itself is local and always served
        docs_url="/docs" if dev else None,
        redoc_url="/redoc" if dev else None,
    )
    app.state.engine = state
    app.state.on_ready = None

    @app.exception_handler(EngineError)
    async def engine_error(_request: Request, exc: EngineError) -> FiniteJSONResponse:
        return FiniteJSONResponse(exc.to_body(), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(
        _request: Request, exc: RequestValidationError
    ) -> FiniteJSONResponse:
        return _error(
            "validation_error",
            "the request does not match the API schema",
            422,
            {"errors": jsonable_encoder(exc.errors())},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException) -> FiniteJSONResponse:
        code = STATUS_CODES.get(exc.status_code, "http_error")
        return _error(code, str(exc.detail), exc.status_code)

    @app.exception_handler(Exception)
    async def unhandled_error(_request: Request, exc: Exception) -> FiniteJSONResponse:
        log.exception("unhandled error")
        return _error("internal_error", f"{type(exc).__name__}: {exc}", 500)

    for module in (routes_system, routes_bags, routes_candidates, routes_sessions, routes_history):
        app.include_router(module.router)

    generate_openapi = app.openapi
    patched: dict[str, bool] = {"done": False}

    def openapi() -> dict[str, Any]:
        schema = generate_openapi()  # FastAPI caches it on the app
        if not patched["done"]:
            uniform_error_responses(schema)
            patched["done"] = True
        return schema

    app.openapi = openapi  # type: ignore[method-assign]

    settings = state.settings if state is not None else None
    app.add_middleware(ErrorMiddleware)  # innermost of ours: its 500s pass through CORS
    if settings is not None and settings.token:
        app.add_middleware(TokenMiddleware, token=settings.token)
    origins = list(settings.cors_origins) if settings is not None else []
    if settings is not None and settings.allow_null_origin:
        origins.append("null")
    app.add_middleware(  # added last = outermost: preflights and error bodies carry CORS
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=ALLOWED_HEADERS,
        expose_headers=EXPOSED_HEADERS,
        allow_credentials=False,
        max_age=600,
    )
    return app
