"""Step 1 of the flow: find / open a bag (the renderer only ever passes a path)."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Query

from .. import candidate_cache as cache
from ..jsonsafe import FiniteJSONResponse
from .deps import engine, errors
from .schemas import BagInfoOut, BagPathIn, RecentBagList
from .state import EngineState

router = APIRouter(tags=["bags"])


def _cached_sets(state: EngineState, fingerprint: str) -> list[str]:
    directory = cache.candidates_root(state.data_root) / fingerprint
    if not directory.is_dir():
        return []
    return sorted(d.name for d in directory.iterdir() if d.is_dir() and cache.result_exists(d))


@router.post(
    "/bags/inspect",
    response_model=BagInfoOut,
    responses=errors(404, 422),
    summary="Open a .bag and read its streams, intrinsics and duration",
)
def inspect_bag(body: BagPathIn, state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    info = state.inspect_bag(Path(body.path))
    state.recent.add(body.path, fingerprint=info.fingerprint)
    return FiniteJSONResponse(
        {**info.to_dict(), "cached_candidate_sets": _cached_sets(state, info.fingerprint)}
    )


@router.get("/bags/recent", response_model=RecentBagList, summary="Recently opened bags")
def list_recent_bags(state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    items = state.recent.list()
    return FiniteJSONResponse({"items": items, "total": len(items)})


@router.post("/bags/recent", response_model=RecentBagList, summary="Remember a bag path")
def add_recent_bag(body: BagPathIn, state: EngineState = Depends(engine)) -> FiniteJSONResponse:
    items = state.recent.add(body.path)
    return FiniteJSONResponse({"items": items, "total": len(items)})


@router.delete("/bags/recent", response_model=RecentBagList, summary="Forget a bag path")
def remove_recent_bag(
    path: str = Query(min_length=1, max_length=4096), state: EngineState = Depends(engine)
) -> FiniteJSONResponse:
    items = state.recent.remove(path)
    return FiniteJSONResponse({"items": items, "total": len(items)})
