"""Mask-driven statistics: the Z_ref block, the near-plane ground row, the depth-FOV
bbox, mask completeness and the aspect bucket (inference contract, C2.3-C2.5).

``compute_mask_depth_stats`` and ``build_ground_band_mask`` are vendored verbatim from
the parent ``measure.py`` (``z_var = np.var`` with ddof 0 is the operator's depth MSE;
``z_mad`` is the mean absolute deviation about the mean). ``erode_mask`` is the one
erosion used by both the Z_ref block and the KNN tree (same pixel set, by construction).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from .constants import (
    ASPECT_END_MAX,
    ASPECT_SIDE_MIN,
    COMPLETENESS_MARGIN_PX,
    DEPTH_MAX_M,
    DEPTH_MIN_M,
    DEPTH_VALID_MIN_FRAC,
    FRAME_MARGIN_PX,
    GROUND_BADGE_PX,
    GROUND_BAND_PX,
    GROUND_TOL_FRAC,
    KNN_RING_EXCLUDE_PX,
)

BBox = tuple[int, int, int, int]


def valid_depth_mask(
    depth_m: np.ndarray, *, z_min: float = DEPTH_MIN_M, z_max: float = DEPTH_MAX_M
) -> np.ndarray:
    """Boolean mask of pixels with finite depth inside the band (C1.1)."""
    return np.isfinite(depth_m) & (depth_m >= z_min) & (depth_m <= z_max)


def erode_mask(mask_u8: np.ndarray, px: int = KNN_RING_EXCLUDE_PX) -> np.ndarray:
    """Erode the mask by ``px`` pixels (a (2px+1)² rectangular kernel, one iteration)."""
    binary = (mask_u8 != 0).astype(np.uint8) * 255
    if px <= 0:
        return binary
    import cv2

    kernel = np.ones((2 * px + 1, 2 * px + 1), dtype=np.uint8)
    return cv2.erode(binary, kernel, iterations=1)


def compute_mask_depth_stats(
    depth_m: np.ndarray,
    mask_u8: np.ndarray,
    *,
    z_min: float = DEPTH_MIN_M,
    z_max: float = DEPTH_MAX_M,
) -> dict[str, Any]:
    """Depth-dispersion statistics over the mask (parent-identical).

    Inlier: ``mask != 0`` and finite depth within [z_min, z_max]. On rejection every numeric
    field is ``None`` and ``rejection_reason`` is ``mask_empty`` or ``no_valid_depth_in_mask``.
    """
    none_keys = {
        "z_mean": None,
        "z_median": None,
        "z_mad": None,
        "z_var": None,
        "z_std": None,
        "z_min": None,
        "z_max": None,
        "z_range": None,
    }
    band = [float(z_min), float(z_max)]
    mask_bool = mask_u8 != 0
    n_total = int(mask_bool.sum())
    if n_total == 0:
        return {
            "n_total": 0,
            "n_valid": 0,
            **none_keys,
            "rejection_reason": "mask_empty",
            "z_valid_band": band,
        }
    valid_mask = mask_bool & (depth_m >= z_min) & (depth_m <= z_max) & np.isfinite(depth_m)
    n_valid = int(valid_mask.sum())
    if n_valid == 0:
        return {
            "n_total": n_total,
            "n_valid": 0,
            **none_keys,
            "rejection_reason": "no_valid_depth_in_mask",
            "z_valid_band": band,
        }
    values = depth_m[valid_mask].astype(np.float64)
    z_mean = float(values.mean())
    z_median = float(np.median(values))
    z_mad = float(np.mean(np.abs(values - z_mean)))
    z_var = float(np.var(values))
    z_std = float(math.sqrt(z_var))
    z_lo = float(values.min())
    z_hi = float(values.max())
    return {
        "n_total": n_total,
        "n_valid": n_valid,
        "z_mean": z_mean,
        "z_median": z_median,
        "z_mad": z_mad,
        "z_var": z_var,
        "z_std": z_std,
        "z_min": z_lo,
        "z_max": z_hi,
        "z_range": z_hi - z_lo,
        "rejection_reason": "ok",
        "z_valid_band": band,
    }


def build_ground_band_mask(
    mask_u8: np.ndarray,
    *,
    band_height_px: int = 80,
    margin_px: int = 4,
) -> np.ndarray:
    """Parent cross-check helper (not used by the engine's ground line): a 0/255 band of
    ``band_height_px`` rows starting ``margin_px`` below the mask, clipped to its x-extent.
    All zeros when the mask is empty or there is no room below it."""
    h, w = mask_u8.shape[:2]
    out = np.zeros((h, w), dtype=np.uint8)
    nz = np.argwhere(mask_u8 != 0)
    if nz.size == 0:
        return out
    y_max = int(nz[:, 0].max())
    x_min = int(nz[:, 1].min())
    x_max = int(nz[:, 1].max())
    band_top = y_max + max(0, int(margin_px))
    band_bot = band_top + max(0, int(band_height_px))
    if band_top >= h:
        return out
    band_top = max(0, band_top)
    band_bot = min(h, band_bot)
    x_min = max(0, x_min)
    x_max = min(w, x_max + 1)
    out[band_top:band_bot, x_min:x_max] = 255
    return out


# ----- mask geometry -----------------------------------------------------------------------


def mask_bbox(mask_u8: np.ndarray) -> BBox | None:
    """Inclusive (x0, y0, x1, y1) of the non-zero pixels, or None for an empty mask."""
    rows = np.flatnonzero((mask_u8 != 0).any(axis=1))
    cols = np.flatnonzero((mask_u8 != 0).any(axis=0))
    if rows.size == 0 or cols.size == 0:
        return None
    return int(cols[0]), int(rows[0]), int(cols[-1]), int(rows[-1])


def mask_area_frac(mask_u8: np.ndarray) -> float:
    return float((mask_u8 != 0).sum()) / float(mask_u8.size)


def bbox_aspect(bbox_xyxy: tuple[float, float, float, float] | list[float] | None) -> float:
    """Width / height of an xyxy box; 0.0 when degenerate."""
    if bbox_xyxy is None or len(bbox_xyxy) < 4:
        return 0.0
    w = float(bbox_xyxy[2]) - float(bbox_xyxy[0])
    h = float(bbox_xyxy[3]) - float(bbox_xyxy[1])
    if h <= 1.0:
        return 0.0
    return w / h


def bucket_from_aspect(aspect_wh: float) -> str:
    """SIDE (> 1.6) / END (< 1.3, positive) / QUARTER otherwise (a badge, never a rejection)."""
    if aspect_wh > ASPECT_SIDE_MIN:
        return "SIDE"
    if 0.0 < aspect_wh < ASPECT_END_MAX:
        return "END"
    return "QUARTER"


def bbox_iou(a: BBox | None, b: BBox | None) -> float | None:
    if a is None or b is None:
        return None
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix1 - ix0 + 1) * max(0, iy1 - iy0 + 1)
    area_a = (a[2] - a[0] + 1) * (a[3] - a[1] + 1)
    area_b = (b[2] - b[0] + 1) * (b[3] - b[1] + 1)
    union = area_a + area_b - inter
    return float(inter) / float(union) if union > 0 else None


# ----- depth FOV and completeness ----------------------------------------------------------


def depth_valid_bbox(
    depth_m: np.ndarray, *, min_frac: float = DEPTH_VALID_MIN_FRAC
) -> list[int] | None:
    """[x0, y0, x1, y1] (inclusive) of the rows/columns whose raw-depth (> 0) coverage is at
    least ``min_frac`` (B4). None when no column or row qualifies."""
    valid = np.isfinite(depth_m) & (depth_m > 0)
    col_frac = valid.mean(axis=0)
    row_frac = valid.mean(axis=1)
    cols = np.flatnonzero(col_frac >= min_frac)
    rows = np.flatnonzero(row_frac >= min_frac)
    if cols.size == 0 or rows.size == 0:
        return None
    return [int(cols[0]), int(rows[0]), int(cols[-1]), int(rows[-1])]


def point_in_bbox(u: float, v: float, bbox: list[int] | BBox | None) -> bool:
    if bbox is None:
        return False
    return bbox[0] <= u <= bbox[2] and bbox[1] <= v <= bbox[3]


def frame_clearance(mask_u8: np.ndarray, *, margin_px: int = FRAME_MARGIN_PX) -> dict[str, Any]:
    """C2.4 hard gate: the camel is not cut off by the image border. ``clear`` iff every mask
    pixel keeps at least ``margin_px`` pixels from the border (1 = must not touch it, the
    parent's ``_mask_is_complete``; 0 disables). ``violations`` is per side, in pixels."""
    h, w = mask_u8.shape[:2]
    mb = mask_bbox(mask_u8)
    if mb is None:
        return {"clear": False, "violations": {}, "mask_bbox": None, "margin_px": margin_px}
    violations = {
        "left": max(0, margin_px - mb[0]),
        "top": max(0, margin_px - mb[1]),
        "right": max(0, mb[2] - (w - 1 - margin_px)),
        "bottom": max(0, mb[3] - (h - 1 - margin_px)),
    }
    return {
        "clear": all(v == 0 for v in violations.values()),
        "violations": violations,
        "mask_bbox": list(mb),
        "margin_px": margin_px,
    }


def mask_completeness(
    mask_u8: np.ndarray,
    depth_bbox: list[int] | BBox | None,
    *,
    margin_px: int = COMPLETENESS_MARGIN_PX,
) -> dict[str, Any]:
    """C2.4 depth-FOV measure: complete iff the mask bbox lies inside the depth-valid bbox
    shrunk by the margin. ``violations`` holds the pixels by which each side intrudes into the
    margin. A soft flag by default (see ``FRAME_MARGIN_PX`` in constants)."""
    mb = mask_bbox(mask_u8)
    if mb is None:
        return {
            "complete": False,
            "reason": "mask_empty",
            "violations": {},
            "mask_bbox": None,
            "depth_valid_bbox": list(depth_bbox) if depth_bbox is not None else None,
            "margin_px": margin_px,
        }
    if depth_bbox is None:
        return {
            "complete": False,
            "reason": "no_depth_coverage",
            "violations": {},
            "mask_bbox": list(mb),
            "depth_valid_bbox": None,
            "margin_px": margin_px,
        }
    x0, y0, x1, y1 = depth_bbox
    inner = (x0 + margin_px, y0 + margin_px, x1 - margin_px, y1 - margin_px)
    violations = {
        "left": max(0, inner[0] - mb[0]),
        "top": max(0, inner[1] - mb[1]),
        "right": max(0, mb[2] - inner[2]),
        "bottom": max(0, mb[3] - inner[3]),
    }
    complete = all(v == 0 for v in violations.values())
    return {
        "complete": complete,
        "reason": "" if complete else "mask_incomplete",
        "violations": violations,
        "mask_bbox": list(mb),
        "depth_valid_bbox": list(depth_bbox),
        "margin_px": margin_px,
    }


# ----- Z_ref block and ground rows ---------------------------------------------------------


def z_ref_block(
    depth_m: np.ndarray,
    mask_u8: np.ndarray,
    *,
    erosion_px: int = KNN_RING_EXCLUDE_PX,
    z_min: float = DEPTH_MIN_M,
    z_max: float = DEPTH_MAX_M,
    mask_eroded_u8: np.ndarray | None = None,
) -> dict[str, Any]:
    """The frozen per-session Z_ref block: **median** valid depth over the 2-px-eroded mask.

    Falls back to the raw mask (``erosion_fallback: true``) when the eroded mask has no valid
    depth. ``z_mad_mean_abs_dev_m`` is the parent ``z_mad`` (the 2D-uncertainty input);
    ``z_mad_robust_m`` (median absolute deviation about the median) is informational.
    """
    eroded = mask_eroded_u8 if mask_eroded_u8 is not None else erode_mask(mask_u8, erosion_px)
    n_mask_raw = int((mask_u8 != 0).sum())
    used = eroded
    fallback = False
    stats = compute_mask_depth_stats(depth_m, eroded, z_min=z_min, z_max=z_max)
    if stats["rejection_reason"] != "ok":
        used = mask_u8
        fallback = True
        stats = compute_mask_depth_stats(depth_m, mask_u8, z_min=z_min, z_max=z_max)
    robust_mad: float | None = None
    rel_disp: float | None = None
    if stats["rejection_reason"] == "ok":
        values = depth_m[(used != 0) & valid_depth_mask(depth_m, z_min=z_min, z_max=z_max)]
        values = values.astype(np.float64)
        robust_mad = float(np.median(np.abs(values - np.median(values))))
        if stats["z_median"] and stats["z_median"] > 0:
            rel_disp = float(stats["z_mad"] / stats["z_median"])
    n_total = int(stats["n_total"])
    n_valid = int(stats["n_valid"])
    return {
        "statistic": "median",
        "z_ref_m": stats["z_median"],
        "z_mean_m": stats["z_mean"],
        "z_median_m": stats["z_median"],
        "z_mad_mean_abs_dev_m": stats["z_mad"],
        "z_mad_robust_m": robust_mad,
        "z_var": stats["z_var"],
        "z_std": stats["z_std"],
        "z_min_m": stats["z_min"],
        "z_max_m": stats["z_max"],
        "rel_disp": rel_disp,
        "n_total": n_total,
        "n_valid": n_valid,
        "valid_fraction": (n_valid / n_total) if n_total else 0.0,
        "band": [float(z_min), float(z_max)],
        "erosion_px": int(erosion_px),
        "n_mask_raw": n_mask_raw,
        "erosion_fallback": fallback,
        "rejection_reason": stats["rejection_reason"],
    }


def ground_rows(
    mask_u8: np.ndarray,
    depth_m: np.ndarray,
    z_ref_m: float | None,
    *,
    band_px: int = GROUND_BAND_PX,
    tol_frac: float = GROUND_TOL_FRAC,
    badge_px: int = GROUND_BADGE_PX,
    z_min: float = DEPTH_MIN_M,
    z_max: float = DEPTH_MAX_M,
) -> dict[str, Any]:
    """Raw lowest mask row and the near-plane lowest row (inference contract "Ground line").

    A column is "near-plane" when the median valid depth of its bottom ``band_px`` mask
    pixels is within ``tol_frac`` of ``z_ref_m``; the near-plane row is the lowest bottom row
    among those columns (a far-side leg can put the raw row ~37 px / 10 cm too low).
    """
    mask_bool = mask_u8 != 0
    empty = {
        "raw_row": None,
        "near_plane_row": None,
        "drawn_row": None,
        "n_columns": 0,
        "n_columns_near": 0,
        "differs_px": None,
        "badge": "ground_row_unresolved",
        "x_min": None,
        "x_max": None,
        "z_ref_m": z_ref_m,
        "tol_frac": tol_frac,
        "band_px": band_px,
        "badge_px": badge_px,
    }
    if not mask_bool.any():
        return empty
    valid = valid_depth_mask(depth_m, z_min=z_min, z_max=z_max)
    cols = np.flatnonzero(mask_bool.any(axis=0))
    rows_any = np.flatnonzero(mask_bool.any(axis=1))
    raw_row = int(rows_any[-1])
    near_rows: list[int] = []
    if z_ref_m is not None and math.isfinite(z_ref_m) and z_ref_m > 0:
        tol = tol_frac * z_ref_m
        for c in cols:
            column = mask_bool[:, c]
            col_rows = np.flatnonzero(column)
            r_c = int(col_rows[-1])
            top = max(0, r_c - band_px + 1)
            sel = column[top : r_c + 1] & valid[top : r_c + 1, c]
            if not sel.any():
                continue
            med = float(np.median(depth_m[top : r_c + 1, c][sel]))
            if abs(med - z_ref_m) <= tol:
                near_rows.append(r_c)
    near_plane_row = max(near_rows) if near_rows else None
    differs = (raw_row - near_plane_row) if near_plane_row is not None else None
    if near_plane_row is None:
        badge: str | None = "ground_row_unresolved"
    elif differs is not None and differs > badge_px:
        badge = "far_side_row_differs"
    else:
        badge = None
    return {
        "raw_row": raw_row,
        "near_plane_row": near_plane_row,
        "drawn_row": near_plane_row if near_plane_row is not None else raw_row,
        "n_columns": int(cols.size),
        "n_columns_near": len(near_rows),
        "differs_px": differs,
        "badge": badge,
        "x_min": int(cols[0]),
        "x_max": int(cols[-1]),
        "z_ref_m": z_ref_m,
        "tol_frac": tol_frac,
        "band_px": band_px,
        "badge_px": badge_px,
    }
