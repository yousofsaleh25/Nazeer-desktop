"""Steps 3-5 of the flow: measuring sessions, autosave, preview, finalize, PDF report."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Request
from starlette.concurrency import run_in_threadpool

from ..constants import PDF_MAX_BYTES
from ..depthlookup import depth_for_pixel
from ..errors import Conflict, EngineError, NotFound
from ..jsonsafe import FiniteJSONResponse
from ..labels import depth_basis
from ..session_compute import MeasurementInput, compute_row, family_of_row, present_row
from ..session_schema import SessionDocument, flat_measurements
from .deps import app_meta, engine, errors
from .files import file_response
from .schemas import (
    DeleteOut,
    DepthIn,
    DepthOut,
    DocumentIn,
    FinalizeIn,
    HistoryList,
    IndexState,
    PreviewIn,
    PreviewOut,
    ReportInputsIn,
    ReportOut,
    SessionCreateIn,
    SessionView,
    Status,
)
from .state import EngineState
from .views import history_row, session_base, session_etag, session_view

router = APIRouter(tags=["sessions"])

SortName = Literal["updated_desc", "created_desc", "created_asc", "camel_asc"]


def _view_response(
    doc: SessionDocument, *, status_code: int = 200, index_state: str | None = None
) -> FiniteJSONResponse:
    return FiniteJSONResponse(
        session_view(doc, index_state=index_state),
        status_code=status_code,
        headers={"ETag": session_etag(doc), "Cache-Control": "no-store"},
    )


def _with_current(state: EngineState, session_id: str, exc: Conflict) -> Conflict:
    """A 409 stale_revision carries the current view so the Redux store can rebase."""
    if exc.code == "stale_revision":
        try:
            exc.details["current"] = session_view(state.store.load(session_id))
        except EngineError:
            pass
    return exc


@router.post(
    "/sessions",
    status_code=201,
    response_model=SessionView,
    responses=errors(404, 422),
    summary="Start a measuring session from a chosen candidate frame",
)
def create_session(
    body: SessionCreateIn, state: EngineState = Depends(engine)
) -> FiniteJSONResponse:
    doc, index_state = state.store.create(
        body.candidate.model_dump(),
        camel_id=body.camel_id,
        operator=body.operator,
        notes=body.notes,
    )
    response = _view_response(doc, status_code=201, index_state=index_state)
    response.headers["Location"] = session_base(doc.session_id)
    return response


@router.get(
    "/sessions",
    response_model=HistoryList,
    summary="History: reconcile the index with the session folders, then list",
)
def list_sessions(
    status: Status | None = None,
    camel_id: str | None = Query(default=None, max_length=64),
    q: str | None = Query(default=None, max_length=200, description="camel, operator, bag, names"),
    index_state: IndexState | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    sort: SortName = "updated_desc",
    state: EngineState = Depends(engine),
) -> FiniteJSONResponse:
    reconciled = state.store.reconcile()
    items, total = state.history.list(
        status=status,
        camel_id=camel_id,
        q=q,
        index_state=index_state,
        limit=limit,
        offset=offset,
        sort=sort,
    )
    return FiniteJSONResponse(
        {"items": [history_row(r) for r in items], "total": total, "reconciled": reconciled},
        headers={"Cache-Control": "no-store"},
    )


@router.get(
    "/sessions/{session_id}",
    response_model=SessionView,
    responses=errors(404, 409, 422),
    summary="Open / continue a session (also warms the KNN tree so the first click is fast)",
)
def get_session(session_id: str, state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    doc = state.store.load(session_id)
    state.store.frame(session_id, doc=doc)  # 409 session_assets_changed if the frame was edited
    return _view_response(doc)


@router.put(
    "/sessions/{session_id}/document",
    response_model=SessionView,
    responses=errors(404, 409, 422),
    summary="Autosave the whole measurement list (revision = stored + 1; 409 carries `current`)",
)
def put_document(
    session_id: str,
    body: DocumentIn,
    if_match: str | None = Header(
        default=None, description="optional: the ETag of the view this save is based on"
    ),
    state: EngineState = Depends(engine),
) -> FiniteJSONResponse:
    try:
        doc = state.store.save_document(
            session_id, body.revision, body.model_dump(exclude={"revision"}), if_match=if_match
        )
    except Conflict as exc:
        raise _with_current(state, session_id, exc) from None
    return _view_response(doc)


@router.post(
    "/sessions/{session_id}/depth",
    response_model=DepthOut,
    responses=errors(404, 409),
    summary="Depth probe for one pixel (hover): provenance, KNN fallback, flags",
)
def probe_depth(
    session_id: str, body: DepthIn, state: EngineState = Depends(engine)
) -> FiniteJSONResponse:
    ctx = state.store.frame(session_id).ctx
    prov = depth_for_pixel(body.u, body.v, ctx, target=body.target)
    out = prov.to_dict()
    out["seq"] = body.seq
    out["ok"] = prov.ok
    out["basis"] = depth_basis(out, kind="distance_3d", z_ref_m=ctx.z_ref.get("z_ref_m"))
    return FiniteJSONResponse(out, headers={"Cache-Control": "no-store"})


@router.post(
    "/sessions/{session_id}/preview",
    response_model=PreviewOut,
    responses=errors(404, 409, 422),
    summary="Compute one measurement without saving it (drag-time values)",
)
def preview_measurement(
    session_id: str, body: PreviewIn, state: EngineState = Depends(engine)
) -> FiniteJSONResponse:
    doc = state.store.load(session_id)
    ctx = state.store.frame(session_id, doc=doc).ctx
    inp = MeasurementInput.from_dict(body.measurement.model_dump())
    ids = [int(r["id"]) for r in flat_measurements(doc)]
    order = ids.index(inp.id) if inp.id in ids else len(ids)
    row = compute_row(inp, ctx, order=order, lines_by_id={line.id: line for line in doc.lines})
    presented = present_row(row, family=family_of_row(row), z_ref_m=ctx.z_ref.get("z_ref_m"))
    return FiniteJSONResponse(
        {"seq": body.seq, "row": presented}, headers={"Cache-Control": "no-store"}
    )


@router.post(
    "/sessions/{session_id}/finalize",
    response_model=SessionView,
    responses=errors(404, 409, 422, 500),
    summary="Render the overlay once and freeze the report model (optionally save first)",
)
def finalize_session(
    session_id: str, body: FinalizeIn, request: Request, state: EngineState = Depends(engine)
) -> FiniteJSONResponse:
    try:
        doc = state.store.finalize(
            session_id,
            body.revision,
            report_inputs=(
                body.report_inputs.model_dump(exclude_none=True) if body.report_inputs else None
            ),
            document=body.document.model_dump() if body.document else None,
            app_meta=app_meta(request),
        )
    except Conflict as exc:
        raise _with_current(state, session_id, exc) from None
    return _view_response(doc)


@router.post(
    "/sessions/{session_id}/reopen",
    response_model=SessionView,
    responses=errors(404),
    summary="Reopen a finalized / exported session for editing (outputs become stale)",
)
def reopen_session(session_id: str, state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    return _view_response(state.store.reopen(session_id))


@router.patch(
    "/sessions/{session_id}/report-inputs",
    response_model=SessionView,
    responses=errors(404, 422),
    summary="Language, rubric variant, judge / council / event names, observations",
)
def patch_report_inputs(
    session_id: str, body: ReportInputsIn, request: Request, state: EngineState = Depends(engine)
) -> FiniteJSONResponse:
    doc = state.store.patch_report_inputs(
        session_id, body.model_dump(exclude_none=True), app_meta=app_meta(request)
    )
    return _view_response(doc)


@router.post(
    "/sessions/{session_id}/report",
    response_model=ReportOut,
    responses=errors(404, 409, 413, 415, 422),
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
    summary="Upload the printToPDF bytes: probe, attach evidence, version, manifest",
)
async def upload_report(
    session_id: str,
    request: Request,
    require_text: bool = Query(
        default=True, description="a missing operator string is a DRIFT (false: soft failure)"
    ),
    require_font: bool = Query(
        default=True, description="a missing IBM Plex Sans Arabic subset is a DRIFT"
    ),
    x_overlay_sha256: str | None = Header(
        default=None, description="sha256 of the overlay PNG embedded in the page"
    ),
    x_overlay_version: int | None = Header(default=None),
    x_report_model_sha256: str | None = Header(
        default=None, description="sha256 of the report model the page was rendered from"
    ),
) -> FiniteJSONResponse:
    state: EngineState = engine(request)
    state.store.check_id(session_id)
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type != "application/pdf":
        raise EngineError(
            "send the PDF bytes with Content-Type: application/pdf",
            code="unsupported_media_type",
            status=415,
        )
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > PDF_MAX_BYTES:
        raise EngineError("the PDF is too large", code="payload_too_large", status=413)
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > PDF_MAX_BYTES:
            raise EngineError("the PDF is too large", code="payload_too_large", status=413)
        chunks.append(chunk)
    try:
        doc, probe = await run_in_threadpool(
            state.store.attach_report,
            session_id,
            b"".join(chunks),
            expected_overlay_sha256=x_overlay_sha256,
            expected_report_model_sha256=x_report_model_sha256,
            overlay_version=x_overlay_version,
            app_meta=app_meta(request),
            require_text=require_text,
            require_font=require_font,
        )
    except Conflict as exc:
        rejected = exc.details.get("rejected_file")
        if rejected:
            exc.details["rejected_url"] = f"{session_base(session_id)}/assets/{rejected}"
        raise
    return FiniteJSONResponse({"session": session_view(doc), "probe": probe})


@router.get(
    "/sessions/{session_id}/report",
    responses={200: {"content": {"application/pdf": {}}}, **errors(404)},
    summary="The sealed PDF (latest, or version v)",
)
def get_report(
    session_id: str,
    request: Request,
    v: int | None = Query(default=None, ge=1),
    state: EngineState = Depends(engine),
):
    doc = state.store.load(session_id)
    version = v or doc.outputs.report_version
    if not version:
        raise NotFound("no report exported yet", code="report_not_found")
    name = f"report_v{version}.pdf"
    path = state.store.asset_path(session_id, name)
    return file_response(request, path, download_name=f"{session_id}_{name}")


@router.get(
    "/sessions/{session_id}/assets/{name}",
    responses={200: {"description": "the file"}, **errors(404)},
    summary="Frame and output files (rgb.png, mask.png, overlay_vN.png, report_model_vN.json …)",
)
def get_session_asset(
    session_id: str, name: str, request: Request, state: EngineState = Depends(engine)
):
    return file_response(request, state.store.asset_path(session_id, name))


@router.delete(
    "/sessions/{session_id}",
    response_model=DeleteOut,
    responses=errors(404, 409),
    summary="Move the session to the trash (purged at the next start)",
)
def delete_session(session_id: str, state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    result = state.store.delete(session_id)
    return FiniteJSONResponse(
        {"deleted": result["deleted"], "trashed_to": result.get("trashed_to")}
    )
