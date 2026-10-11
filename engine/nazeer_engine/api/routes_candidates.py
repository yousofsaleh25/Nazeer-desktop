"""Step 2 of the flow: the candidate job (C2.8) and the persisted candidate sets (C2.7)."""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from .. import candidate_cache as cache
from ..candidates import CandidateParams, load_candidates
from ..errors import NotFound
from ..frames import FRAME_FILES
from ..jsonsafe import FiniteJSONResponse, to_finite
from .deps import engine, errors
from .files import file_response
from .schemas import CandidateSet, JobSnapshot, JobStartIn, JobStartOut
from .state import EngineState
from .views import candidate_set_view

router = APIRouter(tags=["candidates"])

FINGERPRINT_RE = re.compile(r"^[0-9a-f]{64}$")
PARAMS_HASH_RE = re.compile(r"^[0-9a-f]{16}$")
CANDIDATE_ID_RE = re.compile(r"^c\d{2}_\d{6}$")
SSE_INTERVAL_S = 0.25


def _check_set(fingerprint: str, params_hash: str) -> None:
    if not FINGERPRINT_RE.match(fingerprint) or not PARAMS_HASH_RE.match(params_hash):
        raise NotFound("candidate set not found", code="candidates_not_found")


@router.post(
    "/candidates/jobs",
    status_code=202,
    response_model=JobStartOut,
    responses={200: {"model": JobStartOut, "description": "cache hit"}, **errors(404, 409, 422)},
    summary="Start the candidate walk (202) or reuse a cached result (200)",
)
def start_candidate_job(
    body: JobStartIn, state: EngineState = Depends(engine)
) -> FiniteJSONResponse:
    raw = body.params.model_dump(exclude_none=True) if body.params else {}
    params = CandidateParams.from_dict(raw, model_sha256=getattr(state.segmenter, "sha256", ""))
    job, cached = state.jobs.start(Path(body.bag_path), params, force=body.force)
    if cached is not None:
        state.recent.add(body.bag_path, fingerprint=cached["fingerprint"])
        url = f"/candidates/{cached['fingerprint']}/{cached['params_hash']}"
        return FiniteJSONResponse(
            {"cached": True, "job": None, "result": cached, "candidates_url": url}, status_code=200
        )
    state.recent.add(body.bag_path, fingerprint=job["fingerprint"])  # type: ignore[index]
    return FiniteJSONResponse(
        {"cached": False, "job": job, "result": None, "candidates_url": None}, status_code=202
    )


@router.get(
    "/candidates/jobs/{job_id}",
    response_model=JobSnapshot,
    responses=errors(404),
    summary="Job progress snapshot (poll every 500 ms until terminal)",
)
def get_candidate_job(job_id: str, state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    return FiniteJSONResponse(state.jobs.get(job_id), headers={"Cache-Control": "no-store"})


@router.post(
    "/candidates/jobs/{job_id}/cancel",
    status_code=202,
    response_model=JobSnapshot,
    responses=errors(404),
    summary="Cancel: discard the walk (state 'cancelling' until 'cancelled')",
)
def cancel_candidate_job(job_id: str, state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    return FiniteJSONResponse(state.jobs.cancel(job_id), status_code=202)


@router.post(
    "/candidates/jobs/{job_id}/stop",
    status_code=202,
    response_model=JobSnapshot,
    responses=errors(404),
    summary="Stop reading and keep the best frames found so far (partial result)",
)
def stop_candidate_job(job_id: str, state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    return FiniteJSONResponse(state.jobs.stop(job_id), status_code=202)


@router.get(
    "/candidates/jobs/{job_id}/events",
    responses={
        200: {"content": {"text/event-stream": {}}, "description": "progress events"},
        **errors(404),
    },
    summary="Server-sent events: 'progress' snapshots, then 'done' | 'cancelled' | 'failed'",
)
async def stream_candidate_job(
    job_id: str, request: Request, state: EngineState = Depends(engine)
) -> StreamingResponse:
    state.jobs.get(job_id)  # 404 before the stream starts

    async def events() -> AsyncIterator[str]:
        last = ""
        while True:
            snapshot = state.jobs.get(job_id)
            payload = json.dumps(to_finite(snapshot), ensure_ascii=False, allow_nan=False)
            if payload != last:
                yield f"event: progress\ndata: {payload}\n\n"
                last = payload
            if snapshot["terminal"]:
                yield f"event: {snapshot['state']}\ndata: {payload}\n\n"
                return
            if await request.is_disconnected():
                return
            await asyncio.sleep(SSE_INTERVAL_S)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get(
    "/candidates/{fingerprint}/{params_hash}",
    response_model=CandidateSet,
    responses=errors(404),
    summary="A persisted candidate set: the unordered grid with URLs and session refs",
)
def get_candidates(
    fingerprint: str,
    params_hash: str,
    include_frames: bool = False,
    state: EngineState = Depends(engine),
) -> FiniteJSONResponse:
    _check_set(fingerprint, params_hash)
    data = load_candidates(state.data_root, fingerprint, params_hash)
    if data is None:
        raise NotFound(
            "candidate set not found (never computed or purged)",
            code="candidates_not_found",
            details={"fingerprint": fingerprint, "params_hash": params_hash},
        )
    return FiniteJSONResponse(
        candidate_set_view(data, fingerprint, params_hash, include_frames=include_frames),
        headers={"Cache-Control": "no-store"},
    )


@router.get(
    "/candidates/{fingerprint}/{params_hash}/{candidate_id}/{asset}",
    responses={200: {"description": "the file"}, **errors(404)},
    summary="A candidate asset (thumb.jpg, rgb.png, mask.png, depth.npy, intrinsics/stats json)",
)
def get_candidate_asset(
    fingerprint: str,
    params_hash: str,
    candidate_id: str,
    asset: str,
    request: Request,
    state: EngineState = Depends(engine),
):
    _check_set(fingerprint, params_hash)
    if not CANDIDATE_ID_RE.match(candidate_id) or asset not in FRAME_FILES:
        raise NotFound("asset not found", code="asset_not_found")
    path = cache.result_dir(state.data_root, fingerprint, params_hash) / candidate_id / asset
    if not path.is_file():
        raise NotFound("asset not found", code="asset_not_found")
    return file_response(request, path)
