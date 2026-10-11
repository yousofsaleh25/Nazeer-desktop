"""The typed, finite-only depth provenance record of contract C1.6.

Produced by ``depthlookup.depth_for_pixel`` for every clicked point, stored verbatim in
``session.json`` (schema 2.1) next to the point it describes, and rendered on the overlay
and in the PDF ("Depth basis" column). A rejection is ``depth_m = None`` + a non-empty
``reason`` from ``HARD_REJECTIONS``; a fallback keeps its value and carries ``flags``.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Any

from .constants import KNN_K

SOURCES: tuple[str, ...] = (
    "window_median",  # inside the mask, the pixel's own 5x5 window median
    "knn_snapped_to_mask",  # outside the mask: median of the k nearest eroded-mask pixels
    "knn_fill",  # inside the mask but the window was invalid/sparse (depth hole)
    "knn_no_depth_band",  # outside the aligned depth FOV
    "knn_raw_boundary",  # KNN had to use the raw mask (eroded mask had no valid depth)
    "direct_off_mask",  # Shift-click ground/background point keeping its own depth
)
HARD_REJECTIONS: tuple[str, ...] = (
    "pixel_out_of_image",
    "no_valid_depth_in_mask",
    "mask_valid_too_sparse",
    "knn_too_far",
)
SOFT_FLAGS: tuple[str, ...] = (
    "knn_far",
    "knn_spread",
    "depth_edge",
    "depth_edge_near_cluster",
    "off_mask_surface",
    "knn_disagree",
    "window_unmasked",
    "knn_raw_boundary",
    "ground_target_unresolved",
    "outside_depth_fov",
)
TARGETS: tuple[str, ...] = ("camel", "ground")
LOW_CONFIDENCE_FLAGS: frozenset[str] = frozenset(
    {"knn_far", "off_mask_surface", "depth_edge", "ground_target_unresolved", "knn_spread"}
)


@dataclass
class DepthProvenance:
    source: str | None = None
    depth_m: float | None = None
    target: str = "camel"
    inside_mask: bool = False
    inside_depth_bbox: bool = True
    window_n_total: int = 0
    window_n_valid: int = 0
    window_n_in_mask: int = 0
    window_restricted_to_mask: bool = False
    window_median_m: float | None = None
    window_spread_m: float | None = None
    knn_depth_m: float | None = None
    nn_depth_mean_m: float | None = None
    k_requested: int = KNN_K
    k_used: int = 0
    nn_dist_px_max: float | None = None
    nn_dist_m_max: float | None = None
    nn_centroid_px: tuple[float, float] | None = None
    nn_depth_spread_m: float | None = None
    direct_depth_m: float | None = None
    flags: list[str] = field(default_factory=list)
    reason: str = ""

    @property
    def ok(self) -> bool:
        return self.depth_m is not None and self.reason == ""

    @property
    def is_knn(self) -> bool:
        return self.source is not None and self.source.startswith("knn_")

    @property
    def low_confidence(self) -> bool:
        return any(flag in LOW_CONFIDENCE_FLAGS for flag in self.flags)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for f in fields(self):
            value = getattr(self, f.name)
            if isinstance(value, tuple):
                value = list(value)
            elif isinstance(value, list):
                value = list(value)
            out[f.name] = value
        return out

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> DepthProvenance:
        kwargs: dict[str, Any] = {}
        for f in fields(cls):
            if f.name in d:
                kwargs[f.name] = d[f.name]
        centroid = kwargs.get("nn_centroid_px")
        if centroid is not None:
            kwargs["nn_centroid_px"] = (float(centroid[0]), float(centroid[1]))
        kwargs["flags"] = [str(x) for x in kwargs.get("flags", [])]
        return cls(**kwargs)

    @classmethod
    def rejected(cls, reason: str, **values: Any) -> DepthProvenance:
        if reason not in HARD_REJECTIONS:
            raise ValueError(f"unknown hard rejection: {reason}")
        return cls(source=None, depth_m=None, reason=reason, **values)
