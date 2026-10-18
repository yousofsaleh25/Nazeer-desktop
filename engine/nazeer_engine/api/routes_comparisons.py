"""D12 F2: the combined comparison report — create from History, list, view, change the cover
or language, seal the printed PDF, read it back, delete."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Request
from starlette.concurrency import run_in_threadpool

from ..constants import COMPARISON_PDF_MAX_BYTES
from ..errors import Conflict, EngineError
from ..jsonsafe import FiniteJSONResponse
from .deps import app_meta, engine, errors
from .files import file_response
from .schemas import (
    ComparisonCreateIn,
    ComparisonInputsIn,
    ComparisonList,
    ComparisonReportOut,
    ComparisonStatus,
    ComparisonView,
    DeleteOut,
    IndexState,
)
from .state import EngineState
from .views import comparison_base, comparison_row, comparison_view

router = APIRouter(tags=["comparisons"])

ComparisonSort = Literal["created_desc", "created_asc", "updated_desc", "title_asc"]


def _view_response(
    state: EngineState, record: dict, *, status_code: int = 200, index_state: str | None = None
) -> FiniteJSONResponse:
    states = state.comparisons.member_states(record)
    return FiniteJSONResponse(
        comparison_view(record, states, index_state=index_state),
        status_code=status_code,
        headers={"Cache-Control": "no-store"},
    )


@router.post(
    "/comparisons",
    status_code=201,
    response_model=ComparisonView,
    responses=errors(404, 409, 422),
    summary="Compare camels picked in History (the operator's order); every member re-checked",
)
def create_comparison(
    body: ComparisonCreateIn, request: Request, state: EngineState = Depends(engine)
) -> FiniteJSONResponse:
    record, index_state = state.comparisons.create(
        body.session_ids,
        cover=body.cover.model_dump(exclude_none=True) if body.cover else None,
        language=body.language,
        app_meta=app_meta(request),
    )
    response = _view_response(state, record, status_code=201, index_state=index_state)
    response.headers["Location"] = comparison_base(record["comparison_id"])
    return response


@router.get(
    "/comparisons",
    response_model=ComparisonList,
    summary="The Comparisons tab: reconcile the index with the folders, then list",
)
def list_comparisons(
    q: str | None = Query(
        default=None, max_length=200, description="title, event, judge, council, camel ids"
    ),
    status: ComparisonStatus | None = None,
    stale: bool | None = Query(default=None, description="only stale (true) or current (false)"),
    index_state: IndexState | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    sort: ComparisonSort = "created_desc",
    state: EngineState = Depends(engine),
) -> FiniteJSONResponse:
    reconciled = state.store.reconcile()
    reconciled_comparisons = state.comparisons.reconcile()
    rows, total = state.history.list_comparisons(
        q=q,
        status=status,
        stale=stale,
        index_state=index_state,
        limit=limit,
        offset=offset,
        sort=sort,
    )
    members = state.history.comparison_members([r["comparison_id"] for r in rows])
    return FiniteJSONResponse(
        {
            "items": [comparison_row(r, members[r["comparison_id"]]) for r in rows],
            "total": total,
            "reconciled": {
                **{f"sessions_{k}": v for k, v in reconciled.items()},
                **reconciled_comparisons,
            },
        },
        headers={"Cache-Control": "no-store"},
    )


@router.get(
    "/comparisons/{comparison_id}",
    response_model=ComparisonView,
    responses=errors(404, 500),
    summary="One comparison; staleness read from the member files (no frame context is built)",
)
def get_comparison(comparison_id: str, state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    record = state.comparisons.load(comparison_id)
    return _view_response(state, record)


@router.patch(
    "/comparisons/{comparison_id}/inputs",
    response_model=ComparisonView,
    responses=errors(404, 409, 422),
    summary="Cover texts and language: a change writes a new comparison model version",
)
def patch_comparison_inputs(
    comparison_id: str,
    body: ComparisonInputsIn,
    request: Request,
    state: EngineState = Depends(engine),
) -> FiniteJSONResponse:
    record = state.comparisons.patch_inputs(
        comparison_id,
        cover=body.cover.model_dump(exclude_none=True) if body.cover else None,
        language=body.language,
        app_meta=app_meta(request),
    )
    return _view_response(state, record)


@router.post(
    "/comparisons/{comparison_id}/report",
    response_model=ComparisonReportOut,
    responses=errors(404, 409, 413, 415, 422),
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
    summary="Upload the printed comparison: ordered probes, attachments, version, manifest",
)
async def upload_comparison_report(
    comparison_id: str,
    request: Request,
    require_text: bool = Query(
        default=True, description="a missing operator string is a DRIFT (false: soft failure)"
    ),
    require_font: bool = Query(
        default=True, description="a missing IBM Plex Sans Arabic subset is a DRIFT"
    ),
    x_comparison_model_sha256: str | None = Header(
        default=None, description="sha256 of the comparison model the page was printed from"
    ),
) -> FiniteJSONResponse:
    state: EngineState = engine(request)
    state.comparisons.check_id(comparison_id)
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type != "application/pdf":
        raise EngineError(
            "send the PDF bytes with Content-Type: application/pdf",
            code="unsupported_media_type",
            status=415,
        )
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > COMPARISON_PDF_MAX_BYTES:
        raise EngineError("the PDF is too large", code="payload_too_large", status=413)
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > COMPARISON_PDF_MAX_BYTES:
            raise EngineError("the PDF is too large", code="payload_too_large", status=413)
        chunks.append(chunk)
    pdf_bytes = b"".join(chunks)
    del chunks
    try:
        record, probe = await run_in_threadpool(
            state.comparisons.attach_report,
            comparison_id,
            pdf_bytes,
            expected_model_sha256=x_comparison_model_sha256,
            app_meta=app_meta(request),
            require_text=require_text,
            require_font=require_font,
        )
    except Conflict as exc:
        rejected = exc.details.get("rejected_file")
        if rejected:
            exc.details["rejected_url"] = f"{comparison_base(comparison_id)}/assets/{rejected}"
        raise
    states = state.comparisons.member_states(record)
    return FiniteJSONResponse(
        {"comparison": comparison_view(record, states), "probe": probe},
        headers={"Cache-Control": "no-store"},
    )


@router.get(
    "/comparisons/{comparison_id}/report",
    responses={200: {"content": {"application/pdf": {}}}, **errors(404)},
    summary="The sealed comparison PDF (latest, or version v)",
)
def get_comparison_report(
    comparison_id: str,
    request: Request,
    v: int | None = Query(default=None, ge=1),
    state: EngineState = Depends(engine),
):
    path = state.comparisons.report_path(comparison_id, v)
    return file_response(request, path, download_name=f"comparison_{comparison_id}_{path.name}")


@router.get(
    "/comparisons/{comparison_id}/assets/{name}",
    responses={200: {"description": "the file"}, **errors(404)},
    summary="comparison_model_vN.json, comparison.json, comparison.manifest.json, PDFs",
)
def get_comparison_asset(
    comparison_id: str, name: str, request: Request, state: EngineState = Depends(engine)
):
    return file_response(request, state.comparisons.asset_path(comparison_id, name))


@router.delete(
    "/comparisons/{comparison_id}",
    response_model=DeleteOut,
    responses=errors(404, 409),
    summary="Move the comparison to the trash (purged at the next start); sessions stay",
)
def delete_comparison(
    comparison_id: str, state: EngineState = Depends(engine)
) -> FiniteJSONResponse:
    result = state.comparisons.delete(comparison_id)
    return FiniteJSONResponse(
        {"deleted": result["deleted"], "trashed_to": result.get("trashed_to")}
    )
