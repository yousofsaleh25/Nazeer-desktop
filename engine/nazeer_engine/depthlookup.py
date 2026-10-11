"""Depth at a clicked pixel with the KNN fallback — contract C1 (rules C1.1-C1.6).

The operator's rule: a point with invalid depth, or outside the mask, takes the depth of
the k nearest valid mask pixels. The engine implements it as the **median** of the k = 9
nearest valid pixels of the mask eroded by 2 px (D8 evidence: the raw boundary ring
carries misaligned background depth), records full provenance for every point, and
never applies the fallback silently.

Decision procedure (plan "Depth lookup", steps 1-6):

1. half-up pixel rounding (B32); outside the image -> ``pixel_out_of_image``; outside the
   aligned depth FOV -> soft flag ``outside_depth_fov``;
2. ``inside_mask`` / ``inside_depth_bbox``;
3. direct window: 5x5, restricted to in-mask pixels when inside the mask and >= 30 % of
   the window is in-mask (else ``window_unmasked``); ``depth_edge`` on a wide spread,
   near-cluster median when the median sits in the far cluster;
4. KNN over the frame's cKDTree: k = min(9, N), median depth, max neighbour distance in
   px and metres (px · Z / fx), centroid, spread (``knn_spread``);
5. value choice by target and mask membership (see ``depth_for_pixel``);
6. hard rejections only when KNN is the chosen source: ``no_valid_depth_in_mask``,
   ``mask_valid_too_sparse``, ``knn_too_far``.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Any

import numpy as np

from .constants import (
    AGREE_ABS_M,
    AGREE_FRAC,
    DEPTH_WINDOW,
    EDGE_CLUSTER_MIN_FRAC,
    EDGE_CLUSTER_MIN_PX,
    EDGE_SPREAD_ABS_M,
    EDGE_SPREAD_FRAC,
    KNN_FAR_M,
    KNN_K,
    KNN_MAX_DIST_M,
    KNN_RING_EXCLUDE_PX,
    MASK_SPARSE_MIN_FRAC,
    WINDOW_MIN_IN_MASK_FRAC,
    WINDOW_MIN_VALID_FRAC,
)
from .geometry import Intrinsics
from .maskstats import depth_valid_bbox, erode_mask, point_in_bbox, valid_depth_mask, z_ref_block
from .provenance import TARGETS, DepthProvenance


@dataclass(frozen=True, eq=False)
class FrameContext:
    """Everything a session needs to answer clicks; built once per session (B5)."""

    depth_m: np.ndarray
    mask_u8: np.ndarray
    mask_eroded_u8: np.ndarray
    intrinsics: Intrinsics
    z_ref: dict[str, Any]
    depth_valid_bbox: list[int] | None
    height: int
    width: int
    kd_tree: Any | None
    kd_points_uv: np.ndarray
    kd_depths: np.ndarray
    n_mask_raw: int
    n_valid_eroded: int
    n_tree: int
    knn_source: str  # "eroded" | "raw" | "none"
    sparse: bool
    built_ms: float

    @property
    def knn_available(self) -> bool:
        return self.kd_tree is not None and not self.sparse

    def info(self) -> dict[str, Any]:
        return {
            "n_points": self.n_tree,
            "source": self.knn_source,
            "sparse": self.sparse,
            "k": KNN_K,
            "erosion_px": KNN_RING_EXCLUDE_PX,
            "built_ms": self.built_ms,
        }


def build_frame_context(
    depth_m: np.ndarray,
    mask_u8: np.ndarray,
    K: Intrinsics,
    *,
    erosion_px: int = KNN_RING_EXCLUDE_PX,
) -> FrameContext:
    """Erode once, share the pixel set between the Z_ref block and the KNN tree (C1.3)."""
    t0 = time.perf_counter()
    depth = np.asarray(depth_m, dtype=np.float32)
    mask_bin = (np.asarray(mask_u8) != 0).astype(np.uint8) * 255
    eroded = erode_mask(mask_bin, erosion_px)
    valid = valid_depth_mask(depth)
    n_mask_raw = int((mask_bin != 0).sum())
    sel = (eroded != 0) & valid
    n_valid_eroded = int(sel.sum())
    knn_source = "eroded"
    if n_valid_eroded == 0:
        sel = (mask_bin != 0) & valid
        knn_source = "raw" if int(sel.sum()) > 0 else "none"
    vs, us = np.nonzero(sel)
    points = (
        np.stack([us, vs], axis=1).astype(np.float32) if us.size else np.zeros((0, 2), np.float32)
    )
    depths = depth[vs, us].astype(np.float32) if us.size else np.zeros((0,), np.float32)
    tree = None
    if points.shape[0] > 0:
        from scipy.spatial import cKDTree

        tree = cKDTree(points)
    n_tree = int(points.shape[0])
    sparse = n_tree < max(KNN_K, MASK_SPARSE_MIN_FRAC * n_mask_raw)
    z_ref = z_ref_block(depth, mask_bin, erosion_px=erosion_px, mask_eroded_u8=eroded)
    bbox = depth_valid_bbox(depth)
    h, w = depth.shape
    return FrameContext(
        depth_m=depth,
        mask_u8=mask_bin,
        mask_eroded_u8=eroded,
        intrinsics=K,
        z_ref=z_ref,
        depth_valid_bbox=bbox,
        height=int(h),
        width=int(w),
        kd_tree=tree,
        kd_points_uv=points,
        kd_depths=depths,
        n_mask_raw=n_mask_raw,
        n_valid_eroded=n_valid_eroded,
        n_tree=n_tree,
        knn_source=knn_source,
        sparse=bool(sparse),
        built_ms=(time.perf_counter() - t0) * 1000.0,
    )


def pixel_index(u: float, v: float) -> tuple[int, int]:
    """Half-up rounding (B32): matches JavaScript ``Math.round`` on the canvas."""
    return int(math.floor(float(u) + 0.5)), int(math.floor(float(v) + 0.5))


def largest_gap_split(values_sorted: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """Split sorted depths at their largest consecutive gap -> (near, far, gap)."""
    values_sorted = np.asarray(values_sorted, dtype=np.float64)
    if values_sorted.size < 2:
        return values_sorted, values_sorted[:0], 0.0
    diffs = np.diff(values_sorted)
    i = int(np.argmax(diffs))
    return values_sorted[: i + 1], values_sorted[i + 1 :], float(diffs[i])


def _edge_threshold(depth_m: float) -> float:
    return max(EDGE_SPREAD_ABS_M, EDGE_SPREAD_FRAC * depth_m)


def _is_cluster(size: int, n_values: int) -> bool:
    """A depth cluster worth trusting over the median: max(3, 20 %) of the values."""
    return size >= max(EDGE_CLUSTER_MIN_PX, EDGE_CLUSTER_MIN_FRAC * n_values)


def _agree(a: float, b: float) -> bool:
    return abs(a - b) <= max(AGREE_ABS_M, AGREE_FRAC * b)


def window_stats(ctx: FrameContext, ui: int, vi: int) -> dict[str, Any]:
    """Step 3: the direct 5x5 window value with the in-mask restriction and edge handling."""
    half = DEPTH_WINDOW // 2
    n_nominal = DEPTH_WINDOW * DEPTH_WINDOW
    u0, u1 = max(0, ui - half), min(ctx.width, ui + half + 1)
    v0, v1 = max(0, vi - half), min(ctx.height, vi + half + 1)
    window = ctx.depth_m[v0:v1, u0:u1].astype(np.float64)
    in_mask = ctx.mask_u8[v0:v1, u0:u1] != 0
    valid = valid_depth_mask(window)
    inside = bool(ctx.mask_u8[vi, ui] != 0)
    n_in_mask = int(in_mask.sum())
    flags: list[str] = []
    restricted = False
    if inside and n_in_mask / n_nominal >= WINDOW_MIN_IN_MASK_FRAC:
        candidates = valid & in_mask
        restricted = True
    else:
        candidates = valid
        if inside:
            flags.append("window_unmasked")
    values = np.sort(window[candidates])
    n_valid = int(values.size)
    median: float | None = None
    spread: float | None = None
    if n_valid:
        median = float(np.median(values))
        spread = float(values[-1] - values[0])
        threshold = _edge_threshold(median)
        if spread > threshold:
            flags.append("depth_edge")
            near, far, gap = largest_gap_split(values)
            if (
                gap > threshold
                and far.size
                and median > float(near[-1])
                and _is_cluster(near.size, n_valid)
            ):
                median = float(np.median(near))
                flags.append("depth_edge_near_cluster")
    return {
        "inside_mask": inside,
        "window_n_total": n_nominal,
        "window_n_clipped": int(window.size),
        "window_n_in_mask": n_in_mask,
        "window_n_valid": n_valid,
        "window_restricted_to_mask": restricted,
        "window_median_m": median,
        "window_spread_m": spread,
        "direct_valid": n_valid / n_nominal >= WINDOW_MIN_VALID_FRAC,
        "flags": flags,
    }


def knn_stats(ctx: FrameContext, u: float, v: float) -> dict[str, Any] | None:
    """Step 4: the k-nearest-neighbour value over the eroded-mask tree; None without a tree."""
    if ctx.kd_tree is None or ctx.n_tree == 0:
        return None
    k = min(KNN_K, ctx.n_tree)
    dist, idx = ctx.kd_tree.query([float(u), float(v)], k=k)
    dist = np.atleast_1d(np.asarray(dist, dtype=np.float64))
    idx = np.atleast_1d(np.asarray(idx, dtype=np.int64))
    keep = idx < ctx.n_tree  # cKDTree pads with inf / index n when k > n (never with the clamp)
    dist, idx = dist[keep], idx[keep]
    depths = ctx.kd_depths[idx].astype(np.float64)
    points = ctx.kd_points_uv[idx].astype(np.float64)
    knn_depth = float(np.median(depths))
    flags: list[str] = []
    spread = float(depths.max() - depths.min())
    threshold = _edge_threshold(knn_depth)
    if spread > threshold:
        flags.append("knn_spread")
        order = np.argsort(depths)
        near, far, gap = largest_gap_split(depths[order])
        if gap > threshold and far.size:
            near_idx = order[: near.size]
            far_idx = order[near.size :]
            chosen = near_idx if dist[near_idx].mean() <= dist[far_idx].mean() else far_idx
            if _is_cluster(chosen.size, depths.size):  # else keep the median of all k
                knn_depth = float(np.median(depths[chosen]))
    nn_dist_px_max = float(dist.max())
    nn_dist_m_max = nn_dist_px_max * knn_depth / ctx.intrinsics.fx
    centroid = points.mean(axis=0)
    return {
        "knn_depth_m": knn_depth,
        "nn_depth_mean_m": float(depths.mean()),
        "k_requested": KNN_K,
        "k_used": int(idx.size),
        "nn_dist_px_max": nn_dist_px_max,
        "nn_dist_m_max": float(nn_dist_m_max),
        "nn_centroid_px": (float(centroid[0]), float(centroid[1])),
        "nn_depth_spread_m": spread,
        "flags": flags,
        "far": nn_dist_m_max > KNN_FAR_M,
        "too_far": nn_dist_m_max > KNN_MAX_DIST_M,
    }


def _dedupe(flags: list[str]) -> list[str]:
    seen: list[str] = []
    for flag in flags:
        if flag not in seen:
            seen.append(flag)
    return seen


def depth_for_pixel(
    u: float, v: float, ctx: FrameContext, *, target: str = "camel"
) -> DepthProvenance:
    """Steps 1-6 of contract C1 for one click; always returns a provenance record."""
    if target not in TARGETS:
        raise ValueError(f"unknown target {target!r}; expected one of {TARGETS}")
    ui, vi = pixel_index(u, v)
    if not (0 <= ui < ctx.width and 0 <= vi < ctx.height):
        return DepthProvenance.rejected(
            "pixel_out_of_image", target=target, inside_depth_bbox=False
        )
    inside_mask = bool(ctx.mask_u8[vi, ui] != 0)
    inside_bbox = point_in_bbox(ui, vi, ctx.depth_valid_bbox)
    ws = window_stats(ctx, ui, vi)
    ks = knn_stats(ctx, float(u), float(v))
    flags: list[str] = list(ws["flags"])
    if not inside_bbox:
        flags.append("outside_depth_fov")
    base: dict[str, Any] = {
        "target": target,
        "inside_mask": inside_mask,
        "inside_depth_bbox": inside_bbox,
        "window_n_total": ws["window_n_total"],
        "window_n_valid": ws["window_n_valid"],
        "window_n_in_mask": ws["window_n_in_mask"],
        "window_restricted_to_mask": ws["window_restricted_to_mask"],
        "window_median_m": ws["window_median_m"],
        "window_spread_m": ws["window_spread_m"],
    }
    if ks is not None:
        base.update(
            {
                "knn_depth_m": ks["knn_depth_m"],
                "nn_depth_mean_m": ks["nn_depth_mean_m"],
                "k_requested": ks["k_requested"],
                "k_used": ks["k_used"],
                "nn_dist_px_max": ks["nn_dist_px_max"],
                "nn_dist_m_max": ks["nn_dist_m_max"],
                "nn_centroid_px": ks["nn_centroid_px"],
                "nn_depth_spread_m": ks["nn_depth_spread_m"],
            }
        )
    direct_valid = bool(ws["direct_valid"])
    direct = ws["window_median_m"]

    # --- step 5: the direct value wins when the operator's intent allows it -----------------
    if target == "ground" and direct_valid:
        return DepthProvenance(
            source="direct_off_mask",
            depth_m=float(direct),
            direct_depth_m=float(direct),
            flags=_dedupe(flags),
            **base,
        )
    if target == "camel" and inside_mask and direct_valid:
        if ks is not None and not _agree(float(direct), float(ks["knn_depth_m"])):
            flags.append("knn_disagree")
        return DepthProvenance(
            source="window_median",
            depth_m=float(direct),
            direct_depth_m=float(direct),
            flags=_dedupe(flags),
            **base,
        )

    # --- KNN is the chosen source: the operator's rule for invalid / outside-mask points ---
    if target == "ground":
        flags.append("ground_target_unresolved")
    if ks is None:
        return DepthProvenance.rejected("no_valid_depth_in_mask", flags=_dedupe(flags), **base)
    if ctx.sparse:
        return DepthProvenance.rejected("mask_valid_too_sparse", flags=_dedupe(flags), **base)
    if ks["too_far"]:
        return DepthProvenance.rejected("knn_too_far", flags=_dedupe(flags), **base)
    if not inside_bbox:
        source = "knn_no_depth_band"
    elif inside_mask:
        source = "knn_fill"
    else:
        source = "knn_snapped_to_mask"
    if ctx.knn_source == "raw":
        source = "knn_raw_boundary"
        flags.append("knn_raw_boundary")
    flags.extend(ks["flags"])
    if ks["far"]:
        flags.append("knn_far")
    direct_depth: float | None = None
    if direct is not None and direct_valid:
        direct_depth = float(direct)
        if not _agree(direct_depth, float(ks["knn_depth_m"])):
            flags.append("off_mask_surface")
    return DepthProvenance(
        source=source,
        depth_m=float(ks["knn_depth_m"]),
        direct_depth_m=direct_depth,
        flags=_dedupe(flags),
        **base,
    )
