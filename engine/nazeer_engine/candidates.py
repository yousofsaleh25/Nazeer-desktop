"""The frame-candidate walk — contract C2 (rules C2.1-C2.9).

The operator's rule: candidates are the frames with the **minimum depth MSE about the
mask-mean depth** (``z_var = np.var`` over the 2-px-eroded mask) whose **mean depth is at
least 1 m** from the camera. The engine adds the gates of C2.4 (the camel not cut off by the
image border, mask area in [0.10, 0.80], valid depth fraction ≥ 0.6, a proposed median
floor; intruding into the depth-less colour margin is the soft flag ``mask_in_depth_margin``
unless ``strict_depth_fov``), keeps one payload per 1.5 s bin while walking (C2.6), ranks
ascending ``z_var`` (C2.5) with ≥ 2 slots for the minority view bucket, and persists the top
M with full assets and stats (C2.7). Every rejected frame is counted by reason.
"""

from __future__ import annotations

import math
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

import numpy as np

from . import candidate_cache as cache
from . import fsio, maskstats
from .bagreader import BagInfo, FramePair, WalkSummary, inspect_bag, walk_bag
from .constants import (
    BIN_SEC,
    CANDIDATES_M,
    CANDIDATES_M_MAX,
    CANDIDATES_VERSION,
    COMPLETENESS_MARGIN_PX,
    DEPTH_MAX_M,
    DEPTH_MIN_M,
    ENGINE_VERSION,
    FPS_NOMINAL,
    FRAME_MARGIN_PX,
    HOLDER_CAP,
    KNN_RING_EXCLUDE_PX,
    MAF_HIGH,
    MAF_LOW,
    MINORITY_RESERVE,
    NOISE_FLOOR_FRAC,
    SLOW_MEDIA_MB_S,
    SLOW_MEDIA_MIN_SAMPLE_BYTES,
    STRICT_DEPTH_FOV_DEFAULT,
    THUMB_SIZE,
    VALID_FRAC_MIN,
    YOLO_CONF,
    YOLO_IMGSZ,
    Z_MEAN_MIN_M,
    Z_MEDIAN_MIN_M_DEFAULT,
)
from .errors import JobCancelled, JobStopped, ModelContractError, Unprocessable
from .frames import FrameBundle, save_bundle
from .segmenter import Detection, SegmenterLike

TUNABLE_REASONS: frozenset[str] = frozenset(
    {
        "mask_area_out_of_range",
        "mask_cut_by_frame",
        "mask_incomplete",
        "z_median_below_min",
        "valid_frac_too_low",
    }
)
REJECTION_REASONS: tuple[str, ...] = (
    "no_detection",
    "mask_area_out_of_range",
    "mask_cut_by_frame",
    "mask_incomplete",  # only with strict_depth_fov
    "z_mean_below_floor",
    "z_median_below_min",
    "valid_frac_too_low",
    "no_valid_depth_in_mask",
)
# soft, visible, never a rejection (unless strict_depth_fov turns the first into one)
CANDIDATE_FLAGS: tuple[str, ...] = ("mask_in_depth_margin",)
ProgressCallback = Callable[[dict[str, Any]], None]


@dataclass(frozen=True)
class CandidateParams:
    sample_every: int = 0  # 0 = auto (max(5, n_frames // 400))
    m: int = CANDIDATES_M
    z_mean_min_m: float = Z_MEAN_MIN_M
    z_median_min_m: float = Z_MEDIAN_MIN_M_DEFAULT
    maf_low: float = MAF_LOW
    maf_high: float = MAF_HIGH
    valid_frac_min: float = VALID_FRAC_MIN
    frame_margin_px: int = FRAME_MARGIN_PX
    completeness_margin_px: int = COMPLETENESS_MARGIN_PX
    strict_depth_fov: bool = STRICT_DEPTH_FOV_DEFAULT
    bin_sec: float = BIN_SEC
    holder_cap: int = HOLDER_CAP
    erosion_px: int = KNN_RING_EXCLUDE_PX
    minority_reserve: int = MINORITY_RESERVE
    conf: float = YOLO_CONF
    imgsz: int = YOLO_IMGSZ
    depth_band: tuple[float, float] = (DEPTH_MIN_M, DEPTH_MAX_M)
    thumb_size: tuple[int, int] = THUMB_SIZE
    model_sha256: str = ""

    def validated(self) -> CandidateParams:
        problems: dict[str, Any] = {}
        if self.z_mean_min_m < Z_MEAN_MIN_M:
            problems["z_mean_min_m"] = f"must be >= {Z_MEAN_MIN_M} (operator floor)"
        if not (1 <= self.m <= CANDIDATES_M_MAX):
            problems["m"] = f"must be in 1..{CANDIDATES_M_MAX}"
        if self.sample_every < 0:
            problems["sample_every"] = "must be >= 0 (0 = auto)"
        if not (0.0 <= self.maf_low < self.maf_high <= 1.0):
            problems["maf"] = "need 0 <= maf_low < maf_high <= 1"
        if not (0.0 <= self.valid_frac_min <= 1.0):
            problems["valid_frac_min"] = "must be in [0, 1]"
        if self.frame_margin_px < 0 or self.completeness_margin_px < 0:
            problems["margins"] = "frame_margin_px and completeness_margin_px must be >= 0"
        if self.holder_cap < 1 or self.bin_sec <= 0:
            problems["misc"] = "holder_cap >= 1, bin_sec > 0"
        if self.minority_reserve < 0 or self.minority_reserve > self.m:
            problems["minority_reserve"] = "must be in 0..m"
        if problems:
            raise Unprocessable("invalid candidate params", code="invalid_params", details=problems)
        return self

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for f in fields(self):
            value = getattr(self, f.name)
            out[f.name] = list(value) if isinstance(value, tuple) else value
        return out

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None, *, model_sha256: str = "") -> CandidateParams:
        d = dict(d or {})
        kwargs: dict[str, Any] = {}
        for f in fields(cls):
            if f.name in d and d[f.name] is not None:
                value = d[f.name]
                if f.name in ("depth_band", "thumb_size"):
                    value = tuple(value)
                kwargs[f.name] = value
        kwargs["model_sha256"] = model_sha256 or kwargs.get("model_sha256", "")
        return cls(**kwargs).validated()

    def hash(self) -> str:
        return cache.params_hash(self.to_dict())


@dataclass
class FrameStats:
    read_index: int
    frame_number_color: int
    frame_number_depth: int
    color_timestamp_ms: float
    bag_time_s: float
    detected: bool = False
    conf: float | None = None
    bbox_yolo_xyxy: list[float] | None = None
    bbox_mask_xyxy: list[int] | None = None
    bbox_agreement_iou: float | None = None
    mask_area_frac: float | None = None
    aspect_wh: float | None = None
    bucket: str | None = None
    depth_valid_bbox: list[int] | None = None
    complete: bool | None = None  # the C2.4 gate outcome (see evaluate_frame)
    frame_clear: bool | None = None  # not cut off by the image border
    frame_violations: dict[str, int] = field(default_factory=dict)
    depth_fov_complete: bool | None = None  # inside the depth-valid region minus the margin
    completeness_violations: dict[str, int] = field(default_factory=dict)  # depth-FOV, per side
    z_mean: float | None = None
    z_median: float | None = None
    z_var: float | None = None
    z_std: float | None = None
    z_mad: float | None = None
    rel_disp: float | None = None
    n_total: int = 0
    n_valid: int = 0
    valid_frac: float | None = None
    passed: bool = False
    rejection_reasons: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {f.name: getattr(self, f.name) for f in fields(self)}


def evaluate_frame(pair: FramePair, det: Detection, params: CandidateParams) -> FrameStats:
    """C2.2-C2.4 for one sampled pair: stats on the eroded mask, every gate evaluated."""
    stats = FrameStats(
        read_index=pair.read_index,
        frame_number_color=pair.frame_number_color,
        frame_number_depth=pair.frame_number_depth,
        color_timestamp_ms=pair.color_timestamp_ms,
        bag_time_s=pair.bag_time_s,
    )
    if not det.ok or det.mask is None:
        stats.rejection_reasons = ["no_detection"]
        return stats
    mask = det.mask
    stats.detected = True
    stats.conf = det.conf
    stats.bbox_yolo_xyxy = list(det.bbox_xyxy) if det.bbox_xyxy is not None else None
    mb = maskstats.mask_bbox(mask)
    stats.bbox_mask_xyxy = list(mb) if mb is not None else None
    if det.bbox_xyxy is not None and mb is not None:
        yolo_box = (
            int(round(det.bbox_xyxy[0])),
            int(round(det.bbox_xyxy[1])),
            int(round(det.bbox_xyxy[2])) - 1,
            int(round(det.bbox_xyxy[3])) - 1,
        )
        stats.bbox_agreement_iou = maskstats.bbox_iou(mb, yolo_box)
    stats.mask_area_frac = maskstats.mask_area_frac(mask)
    if mb is not None:
        # the inclusive mask bbox -> exclusive xyxy, so a 120x40 block has aspect 3.0
        stats.aspect_wh = maskstats.bbox_aspect([mb[0], mb[1], mb[2] + 1, mb[3] + 1])
    else:
        stats.aspect_wh = 0.0
    stats.bucket = maskstats.bucket_from_aspect(stats.aspect_wh)
    stats.depth_valid_bbox = maskstats.depth_valid_bbox(pair.depth_m)
    clearance = maskstats.frame_clearance(mask, margin_px=params.frame_margin_px)
    stats.frame_clear = bool(clearance["clear"])
    stats.frame_violations = dict(clearance.get("violations", {}))
    completeness = maskstats.mask_completeness(
        mask, stats.depth_valid_bbox, margin_px=params.completeness_margin_px
    )
    stats.depth_fov_complete = bool(completeness["complete"])
    stats.completeness_violations = dict(completeness.get("violations", {}))
    stats.complete = stats.frame_clear and (stats.depth_fov_complete or not params.strict_depth_fov)
    if not stats.depth_fov_complete and not params.strict_depth_fov:
        stats.flags.append("mask_in_depth_margin")  # those clicks resolve by KNN, recorded
    eroded = maskstats.erode_mask(mask, params.erosion_px)
    z = maskstats.compute_mask_depth_stats(
        pair.depth_m, eroded, z_min=params.depth_band[0], z_max=params.depth_band[1]
    )
    stats.n_total = int(z["n_total"])
    stats.n_valid = int(z["n_valid"])
    stats.valid_frac = (stats.n_valid / stats.n_total) if stats.n_total else 0.0
    reasons: list[str] = []
    if not (params.maf_low <= stats.mask_area_frac <= params.maf_high):
        reasons.append("mask_area_out_of_range")
    if not stats.frame_clear:
        reasons.append("mask_cut_by_frame")
    if params.strict_depth_fov and not stats.depth_fov_complete:
        reasons.append("mask_incomplete")
    if z["rejection_reason"] != "ok":
        reasons.append("no_valid_depth_in_mask")
    else:
        stats.z_mean = float(z["z_mean"])
        stats.z_median = float(z["z_median"])
        stats.z_var = float(z["z_var"])
        stats.z_std = float(z["z_std"])
        stats.z_mad = float(z["z_mad"])
        stats.rel_disp = (stats.z_mad / stats.z_median) if stats.z_median > 0 else None
        if stats.z_mean < params.z_mean_min_m:
            reasons.append("z_mean_below_floor")
        if stats.z_median < params.z_median_min_m:
            reasons.append("z_median_below_min")
        if stats.valid_frac < params.valid_frac_min:
            reasons.append("valid_frac_too_low")
    stats.rejection_reasons = reasons
    stats.passed = not reasons
    return stats


@dataclass
class Holder:
    bin: int
    stats: FrameStats
    bgr: np.ndarray
    depth_m: np.ndarray
    mask: np.ndarray
    intrinsics: dict[str, Any]
    depth_units_m: float


class HolderSet:
    """One full payload per 1.5 s bin, lowest ``z_var`` wins; hard cap on holders (C2.6)."""

    def __init__(self, cap: int) -> None:
        self.cap = max(1, int(cap))
        self.by_bin: dict[int, Holder] = {}
        self.replaced = 0
        self.evicted = 0

    def offer(self, holder: Holder) -> bool:
        current = self.by_bin.get(holder.bin)
        if current is not None:
            if _zvar(holder.stats) < _zvar(current.stats):
                self.by_bin[holder.bin] = holder
                self.replaced += 1
                return True
            return False
        if len(self.by_bin) >= self.cap:
            worst_bin = max(self.by_bin, key=lambda b: _zvar(self.by_bin[b].stats))
            if _zvar(self.by_bin[worst_bin].stats) <= _zvar(holder.stats):
                return False
            del self.by_bin[worst_bin]
            self.evicted += 1
        self.by_bin[holder.bin] = holder
        return True

    def holders(self) -> list[Holder]:
        return list(self.by_bin.values())


def _zvar(stats: FrameStats) -> float:
    return stats.z_var if stats.z_var is not None else math.inf


def _rank_key(h: Holder) -> tuple[float, float, int]:
    return (_zvar(h.stats), h.stats.rel_disp or math.inf, h.stats.read_index)


def _bucket(h: Holder) -> str:
    return h.stats.bucket or "QUARTER"


def rank_and_select(
    holders: Iterable[Holder],
    *,
    m: int,
    reserve: int,
    min_gap_s: float = BIN_SEC,
    fps: int = FPS_NOMINAL,
) -> tuple[list[Holder], dict[str, Any]]:
    """C2.5: rank ascending ``z_var`` (ties: ``rel_disp``, read index) and pick greedily,
    skipping any frame closer than ``min_gap_s`` (on ``read_index / fps``) to a frame
    already picked — the 1.5 s temporal diversity also holds across the holder bins' edges.

    Then the view bucket that the *pick* starves gets slots: of SIDE and END (both present
    among the holders), the one with fewer picks is the minority; while it has fewer than
    ``reserve`` picks, its best remaining frame replaces the worst-ranked pick of another
    bucket, provided it keeps ``min_gap_s`` from every pick that stays. QUARTER is never
    reserved; a minority that cannot get its slots is reported as a shortfall."""
    ranked = sorted(holders, key=_rank_key)
    counts = {"SIDE": 0, "END": 0, "QUARTER": 0}
    for h in ranked:
        counts[_bucket(h)] = counts.get(_bucket(h), 0) + 1
    fps = int(fps) or FPS_NOMINAL

    def clear_of(h: Holder, picks: list[Holder]) -> bool:
        t = h.stats.read_index / fps
        return all(abs(t - p.stats.read_index / fps) >= min_gap_s for p in picks)

    selected: list[Holder] = []
    too_close = 0
    for h in ranked:
        if len(selected) >= m:
            break
        if clear_of(h, selected):
            selected.append(h)
        else:
            too_close += 1

    target = min(max(0, reserve), m)
    present = [b for b in ("SIDE", "END") if counts[b] > 0]
    picks = {b: sum(1 for h in selected if _bucket(h) == b) for b in present}
    minority: str | None = None
    if len(present) == 2:
        if picks["SIDE"] != picks["END"]:
            minority = min(present, key=lambda b: picks[b])
        elif picks["SIDE"] < target:  # tied below the reserve: favour the better-ranked one
            minority = next(_bucket(h) for h in ranked if _bucket(h) in present)
    swapped = 0
    shortfall = 0
    if minority is not None and target > 0:
        need = max(0, target - picks[minority])
        picked = {id(h) for h in selected}  # identity: Holders carry numpy arrays
        for incoming in [h for h in ranked if id(h) not in picked and _bucket(h) == minority]:
            if need == 0:
                break
            others = [i for i, p in enumerate(selected) if _bucket(p) != minority]
            if not others:
                break
            worst = others[-1]  # ``selected`` is in rank order
            rest = selected[:worst] + selected[worst + 1 :]
            if not clear_of(incoming, rest):
                continue  # it would sit within min_gap_s of a pick that stays
            selected = sorted([*rest, incoming], key=_rank_key)
            swapped += 1
            need -= 1
        shortfall = need
    selected.sort(key=_rank_key)
    diag = {
        "bucket_counts": counts,
        "minority_bucket": minority,
        "minority_reserved": (
            0 if minority is None else sum(1 for h in selected if _bucket(h) == minority)
        ),
        "minority_swapped_in": swapped,
        "minority_reserved_shortfall": shortfall,
        "skipped_too_close": too_close,
        "min_gap_s": min_gap_s,
        "n_ranked": len(ranked),
    }
    return selected, diag


@dataclass
class CandidateResult:
    fingerprint: str
    params_hash: str
    directory: Path
    candidates_json: dict[str, Any]


def _candidate_id(rank: int, read_index: int) -> str:
    return f"c{rank:02d}_{read_index:06d}"


def _histogram(values: Iterable[float], bins: int = 10) -> list[int]:
    counts = [0] * bins
    for v in values:
        i = min(bins - 1, max(0, int(v * bins)))
        counts[i] += 1
    return counts


def run_candidate_walk(
    bag_path: Path | str,
    params: CandidateParams,
    *,
    segmenter: SegmenterLike,
    cache_root: Path | str,
    job_id: str,
    bag_iter: Callable[..., Iterable[FramePair]] | None = None,
    bag_info: BagInfo | None = None,
    cancel: threading.Event | None = None,
    stop: threading.Event | None = None,
    progress: ProgressCallback | None = None,
    library_versions: dict[str, Any] | None = None,
) -> CandidateResult:
    """Walk, evaluate, retain, rank, persist (C2.1-C2.9). Raises ``JobCancelled`` on cancel;
    a ``stop`` persists the best so far with ``partial: true``."""
    params = params.validated()
    bag = Path(bag_path)
    t0 = time.perf_counter()
    info = bag_info or inspect_bag(bag)
    fingerprint = info.fingerprint
    ph = params.hash()
    sample_every = params.sample_every or info.sample_every_effective
    fps = int(info.color.get("fps") or 30) or 30

    def emit(stage: str, **extra: Any) -> None:
        if progress is not None:
            progress({"stage": stage, **extra})

    emit("opening", fraction=0.0)
    read_mb_s, probe_bytes, _ = fsio.read_throughput_probe(bag)
    warnings: list[str] = []
    # only a meaningful sample can call the medium slow (a tiny file reads in microseconds)
    slow_media = probe_bytes >= SLOW_MEDIA_MIN_SAMPLE_BYTES and read_mb_s < SLOW_MEDIA_MB_S
    if slow_media:
        warnings.append(
            f"slow_media: {read_mb_s:.0f} MB/s over the first {probe_bytes // 1048576} MiB "
            f"(below {SLOW_MEDIA_MB_S:.0f} MB/s; removable media?)"
        )
        emit("opening", fraction=0.0, warnings=list(warnings))  # visible while the walk runs

    holders = HolderSet(params.holder_cap)
    rows: list[FrameStats] = []
    rejected_by_reason: dict[str, int] = {r: 0 for r in REJECTION_REASONS}
    counters: dict[str, Any] = {"read": 0, "sampled": 0, "detected": 0, "passed": 0}
    stopped_early = False

    def snapshot() -> dict[str, Any]:
        """C2.8 job counters: read / sampled / detected / passed + rejections by reason."""
        return {**counters, "rejected_by_reason": dict(rejected_by_reason)}

    def on_progress(index: int, fraction: float) -> None:
        counters["read"] = index + 1
        emit("walking", fraction=fraction, counters=snapshot(), read_index=index)

    iterator = (bag_iter or walk_bag)(
        bag, sample_every=sample_every, cancel=cancel, stop=stop, on_progress=on_progress
    )
    summary: WalkSummary | None = getattr(iterator, "summary", None)
    try:
        for pair in iterator:
            counters["sampled"] += 1
            det = segmenter.predict(pair.bgr)
            stats = evaluate_frame(pair, det, params)
            rows.append(stats)
            if stats.detected:
                counters["detected"] += 1
            for reason in stats.rejection_reasons:
                rejected_by_reason[reason] = rejected_by_reason.get(reason, 0) + 1
            if stats.passed and det.mask is not None:
                counters["passed"] += 1
                bin_index = int(math.floor((pair.read_index / fps) / params.bin_sec))
                holders.offer(
                    Holder(
                        bin=bin_index,
                        stats=stats,
                        bgr=pair.bgr,
                        depth_m=pair.depth_m,
                        mask=det.mask,
                        intrinsics=dict(pair.intrinsics),
                        depth_units_m=pair.depth_units_m,
                    )
                )
    except JobStopped:
        stopped_early = True
    except JobCancelled:
        raise
    except ModelContractError as exc:
        exc.details.setdefault("read_index", counters["read"])
        raise
    finally:
        # a consumer-side failure (segmenter, stats) must still stop the playback pipeline
        close = getattr(iterator, "close", None)
        if callable(close):
            close()
    counters["read"] = summary.n_pairs if summary is not None else counters["read"]

    emit("ranking", fraction=1.0, counters=snapshot())
    selected, diag = rank_and_select(
        holders.holders(),
        m=params.m,
        reserve=params.minority_reserve,
        min_gap_s=params.bin_sec,
        fps=fps,
    )

    emit("persisting", fraction=1.0, counters=snapshot())
    tmp_dir = cache.building_dir(cache_root, fingerprint, job_id)
    if tmp_dir.exists():
        import shutil

        shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    candidates: list[dict[str, Any]] = []
    for rank, holder in enumerate(selected, start=1):
        cid = _candidate_id(rank, holder.stats.read_index)
        intr = dict(holder.intrinsics)
        intr["depth_units_m"] = holder.depth_units_m
        intr["depth_valid_bbox"] = holder.stats.depth_valid_bbox
        stats_dict = holder.stats.to_dict()
        stats_dict["rank"] = rank
        stats_dict["candidate_id"] = cid
        bundle = FrameBundle(
            bgr=holder.bgr,
            depth_m=holder.depth_m,
            mask=holder.mask,
            intrinsics=intr,
            stats=stats_dict,
        )
        sizes = save_bundle(tmp_dir / cid, bundle, thumb=True)
        candidates.append(
            {
                "candidate_id": cid,
                "dir": cid,
                "rank": rank,
                "bucket": holder.stats.bucket,
                **stats_dict,
                "assets": {
                    "thumb": f"{cid}/thumb.jpg",
                    "rgb": f"{cid}/rgb.png",
                    "mask": f"{cid}/mask.png",
                    "depth": f"{cid}/depth.npy",
                    "intrinsics": f"{cid}/intrinsics.json",
                    "stats": f"{cid}/stats.json",
                },
                "bytes": sizes,
            }
        )
    near_misses = sorted(
        (
            r.to_dict()
            for r in rows
            if not r.passed
            and r.rejection_reasons
            and set(r.rejection_reasons) <= TUNABLE_REASONS
            and r.z_var is not None
        ),
        key=lambda d: d["z_var"],
    )[: params.m]
    shortfall_reasons: list[str] = []
    if len(candidates) < params.m:
        shortfall_reasons.append(f"only {len(candidates)} of {params.m} frames passed the gates")
    if stopped_early:
        shortfall_reasons.append("stopped_early")
    if diag["minority_reserved_shortfall"]:
        shortfall_reasons.append("minority_reserved_shortfall")
    walk_block: dict[str, Any] = {
        "n_pairs": counters["read"],
        "n_sampled": counters["sampled"],
        "n_detected": counters["detected"],
        "n_passed": counters["passed"],
        "n_holders": len(holders.holders()),
        "replaced": holders.replaced,
        "evicted": holders.evicted,
        "stopped_early": stopped_early,
        "cancelled": False,
        "elapsed_s": time.perf_counter() - t0,
        "read_mb_s": read_mb_s,
        "slow_media": slow_media,
        "fps": fps,
    }
    if summary is not None:
        walk_block.update(
            {
                "n_incomplete": summary.n_incomplete,
                "end_reason": summary.end_reason,
                "walk_complete": summary.walk_complete and not stopped_early,
                "last_position_fraction": summary.last_position_fraction,
                "path_fallback": summary.path_fallback,
                "retries": summary.retries,
            }
        )
    else:
        walk_block.update(
            {
                "end_reason": "stopped" if stopped_early else "eof",
                "walk_complete": not stopped_early,
            }
        )
    result: dict[str, Any] = {
        "candidates_version": CANDIDATES_VERSION,
        "bag": info.to_dict(),
        "params": params.to_dict(),
        "params_hash": ph,
        "model": {
            "file": segmenter.weights_name,
            "sha256": segmenter.sha256,
            "stub": bool(getattr(segmenter, "is_stub", False)),
        },
        "engine_version": ENGINE_VERSION,
        "library_versions": dict(library_versions or {}),
        "created_at": _iso_now(),
        "job_id": job_id,
        "sample_every_effective": sample_every,
        "walk": walk_block,
        "rejected_by_reason": rejected_by_reason,
        "valid_frac_histogram": _histogram(
            [r.valid_frac for r in rows if r.valid_frac is not None]
        ),
        "selection": diag,
        "presentation": "unordered",
        "noise_floor_frac": NOISE_FLOOR_FRAC,
        "frames": [r.to_dict() for r in rows],
        "candidates": candidates,
        "near_misses": near_misses,
        "n_candidates": len(candidates),
        "partial": len(candidates) < params.m
        or stopped_early
        or not walk_block.get("walk_complete", True),
        "shortfall_reasons": shortfall_reasons,
        "warnings": warnings,
    }
    fsio.write_json(tmp_dir / cache.RESULT_FILE, result)
    final_dir = cache.result_dir(cache_root, fingerprint, ph)
    cache.publish(tmp_dir, final_dir)
    cache.touch(final_dir)
    cache.purge_lru(cache_root, keep=final_dir)
    emit("done", fraction=1.0, counters=snapshot())
    return CandidateResult(
        fingerprint=fingerprint, params_hash=ph, directory=final_dir, candidates_json=result
    )


def _iso_now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).replace(microsecond=0).isoformat()


def load_candidates(cache_root: Path | str, fingerprint: str, ph: str) -> dict[str, Any] | None:
    directory = cache.result_dir(cache_root, fingerprint, ph)
    if not cache.result_exists(directory):
        return None
    cache.touch(directory)
    return fsio.read_json(directory / cache.RESULT_FILE)
