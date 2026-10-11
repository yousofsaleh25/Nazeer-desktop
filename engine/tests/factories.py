"""Builders for persisted test fixtures (a candidate result dir exactly as the walk writes it)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from nazeer_engine import candidate_cache as cache
from nazeer_engine import fsio
from nazeer_engine.frames import FrameBundle, save_bundle
from nazeer_engine.maskstats import depth_valid_bbox
from tests.synthetic import SyntheticFrame, make_synthetic_frame

FINGERPRINT = "a" * 64
PARAMS_HASH = "b" * 16
CANDIDATE_ID = "c01_000180"


def make_candidate(
    root: Path,
    *,
    frame: SyntheticFrame | None = None,
    fingerprint: str = FINGERPRINT,
    params_hash: str = PARAMS_HASH,
    candidate_id: str = CANDIDATE_ID,
    bag_path: str = r"E:\bags\20260414_175757-006.bag",
) -> dict[str, Any]:
    """Write ``<root>/candidates/<fp>/<ph>/<candidate_id>/`` + ``candidates.json``; returns
    the candidate reference the API takes."""
    f = frame or make_synthetic_frame(seed=0)
    result_dir = cache.result_dir(root, fingerprint, params_hash)
    intr = dict(f.intrinsics)
    intr["depth_units_m"] = 0.001
    intr["depth_valid_bbox"] = depth_valid_bbox(f.depth_m)
    read_index = int(candidate_id.split("_")[1])
    stats = {
        "candidate_id": candidate_id,
        "rank": 1,
        "read_index": read_index,
        "frame_number_color": 25979 + read_index,
        "frame_number_depth": 25844 + read_index,
        "color_timestamp_ms": 1776178686547.8632,
        "bag_time_s": read_index / 30.0,
        "bucket": "SIDE",
        "z_mean": 2.0,
        "z_median": 2.0,
        "z_var": 0.0001,
        "rel_disp": 0.004,
        "valid_frac": 0.92,
        "passed": True,
        "rejection_reasons": [],
    }
    save_bundle(
        result_dir / candidate_id,
        FrameBundle(bgr=f.bgr, depth_m=f.depth_m, mask=f.mask, intrinsics=intr, stats=stats),
    )
    candidates_json = {
        "candidates_version": "1.0",
        "bag": {
            "path": bag_path,
            "name": Path(bag_path.replace("\\", "/")).name,
            "fingerprint": fingerprint,
            "duration_s": 58.4,
        },
        "params": {"m": 12},
        "params_hash": params_hash,
        "model": {"file": "stub", "sha256": "stub", "stub": True},
        "sample_every_effective": 5,
        "walk": {"n_pairs": 1751, "n_sampled": 351, "walk_complete": True, "end_reason": "eof"},
        "rejected_by_reason": {},
        "frames": [stats],
        "candidates": [{**stats, "dir": candidate_id, "assets": {}}],
        "near_misses": [],
        "n_candidates": 1,
        "partial": False,
        "presentation": "unordered",
    }
    fsio.write_json(result_dir / cache.RESULT_FILE, candidates_json)
    return {"fingerprint": fingerprint, "params_hash": params_hash, "candidate_id": candidate_id}
