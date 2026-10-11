"""Synthetic D455-like frames with known geometry for the default (bag-free) test suite."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

HEIGHT, WIDTH = 720, 1280
INTRINSICS = {
    "fx": 642.9,
    "fy": 641.93,
    "cx": 650.38,
    "cy": 366.27,
    "width": WIDTH,
    "height": HEIGHT,
    "model": "inverse_brown_conrady",
    "coeffs": [-0.0536, 0.0636, -0.0011, 0.001, -0.0204],
}


@dataclass
class SyntheticFrame:
    depth_m: np.ndarray
    mask: np.ndarray
    bgr: np.ndarray
    intrinsics: dict = field(default_factory=lambda: dict(INTRINSICS))
    body_depth_m: float = 2.0
    ring_depth_m: float = 2.35
    body_rows: tuple[int, int] = (200, 560)
    body_cols: tuple[int, int] = (300, 980)
    leg_cols: tuple[tuple[int, int], ...] = ((320, 370), (520, 570), (720, 770), (910, 960))
    leg_bottom_row: int = 640
    ground_depth_range: tuple[float, float] = (2.3, 3.2)
    fov_left_cols: int = 36
    fov_top_rows: int = 20
    far_wall_m: float = 6.5

    @property
    def inside_point(self) -> tuple[float, float]:
        return (640.0, 380.0)

    @property
    def ground_point_below_leg(self) -> tuple[float, float]:
        return (345.0, 680.0)

    def ground_depth_at_row(self, row: int) -> float:
        lo, hi = self.ground_depth_range
        span = (HEIGHT - 1) - (self.leg_bottom_row + 1)
        t = (row - (self.leg_bottom_row + 1)) / max(span, 1)
        return lo + (hi - lo) * t


def make_synthetic_frame(
    seed: int = 0,
    *,
    body_depth_m: float = 2.0,
    hole_frac: float = 0.08,
    noise_m: float = 0.01,
    with_ring: bool = True,
    with_fov_border: bool = True,
) -> SyntheticFrame:
    rng = np.random.default_rng(seed)
    frame = SyntheticFrame(
        depth_m=np.full((HEIGHT, WIDTH), 6.5, dtype=np.float32),
        mask=np.zeros((HEIGHT, WIDTH), dtype=np.uint8),
        bgr=np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8),
        body_depth_m=body_depth_m,
    )
    r0, r1 = frame.body_rows
    c0, c1 = frame.body_cols
    frame.mask[r0:r1, c0:c1] = 255
    for lc0, lc1 in frame.leg_cols:
        frame.mask[r1 : frame.leg_bottom_row + 1, lc0:lc1] = 255
    body = frame.mask != 0
    # ground plane below the legs: depth rises with the row (farther away lower in the image)
    rows = np.arange(HEIGHT, dtype=np.float32)[:, None]
    ground = np.broadcast_to(
        np.array([frame.ground_depth_at_row(int(r)) for r in range(HEIGHT)], dtype=np.float32)[
            :, None
        ],
        (HEIGHT, WIDTH),
    )
    ground_region = rows[:, 0] > frame.leg_bottom_row
    frame.depth_m[ground_region, :] = ground[ground_region, :]
    # camel body at a constant depth with small noise
    noise = rng.normal(0.0, noise_m, size=(HEIGHT, WIDTH)).astype(np.float32)
    frame.depth_m[body] = body_depth_m + noise[body]
    # misaligned boundary ring: the 2 px just outside the mask carry background depth
    if with_ring:
        import cv2

        dilated = cv2.dilate(frame.mask, np.ones((5, 5), np.uint8)) != 0
        ring = dilated & ~body
        frame.depth_m[ring] = frame.ring_depth_m
    # depth holes inside the body
    holes = (rng.random((HEIGHT, WIDTH)) < hole_frac) & body
    frame.depth_m[holes] = 0.0
    # aligned-depth FOV border (no depth at all)
    if with_fov_border:
        frame.depth_m[:, : frame.fov_left_cols] = 0.0
        frame.depth_m[: frame.fov_top_rows, :] = 0.0
    # a plausible picture: brown camel on sand
    frame.bgr[:, :] = (120, 170, 210)
    frame.bgr[body] = (60, 90, 140)
    return frame
