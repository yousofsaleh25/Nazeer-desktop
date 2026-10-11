"""One frame's assets on disk (candidate dirs and session dirs share the layout, C2.7/C3.2):
``rgb.png`` (BGR, true colours), ``depth.npy`` (float32 metres, aligned to colour),
``mask.png`` (uint8 0/255), ``intrinsics.json`` (+ distortion, depth units, depth FOV
bbox), ``stats.json``, ``thumb.jpg`` (320x180). All I/O goes through ``fsio``."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from . import fsio
from .constants import THUMB_JPEG_QUALITY, THUMB_SIZE

FRAME_FILES: tuple[str, ...] = (
    "rgb.png",
    "depth.npy",
    "mask.png",
    "intrinsics.json",
    "stats.json",
    "thumb.jpg",
)


@dataclass
class FrameBundle:
    bgr: np.ndarray
    depth_m: np.ndarray
    mask: np.ndarray
    intrinsics: dict[str, Any]
    stats: dict[str, Any] = field(default_factory=dict)

    @property
    def shape(self) -> tuple[int, int]:
        return int(self.depth_m.shape[0]), int(self.depth_m.shape[1])


def make_thumb(bgr: np.ndarray, size: tuple[int, int] = THUMB_SIZE) -> np.ndarray:
    import cv2

    return cv2.resize(bgr, (int(size[0]), int(size[1])), interpolation=cv2.INTER_AREA)


def save_bundle(
    directory: Path | str, bundle: FrameBundle, *, thumb: bool = True
) -> dict[str, int]:
    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True)
    sizes: dict[str, int] = {}
    sizes["rgb.png"] = fsio.write_image(d / "rgb.png", np.ascontiguousarray(bundle.bgr))
    sizes["depth.npy"] = fsio.write_npy(d / "depth.npy", bundle.depth_m.astype(np.float32))
    mask = (np.asarray(bundle.mask) != 0).astype(np.uint8) * 255
    sizes["mask.png"] = fsio.write_image(d / "mask.png", mask)
    sizes["intrinsics.json"] = len(fsio.write_json(d / "intrinsics.json", bundle.intrinsics))
    sizes["stats.json"] = len(fsio.write_json(d / "stats.json", bundle.stats))
    if thumb:
        sizes["thumb.jpg"] = fsio.write_image(
            d / "thumb.jpg", make_thumb(bundle.bgr), jpeg_quality=THUMB_JPEG_QUALITY
        )
    return sizes


def load_bundle(directory: Path | str) -> FrameBundle:
    d = Path(directory)
    bgr = fsio.read_image(d / "rgb.png")
    depth_m = fsio.read_npy(d / "depth.npy").astype(np.float32)
    mask = fsio.read_image(d / "mask.png")
    if mask.ndim == 3:
        mask = mask[:, :, 0]
    mask = (mask != 0).astype(np.uint8) * 255
    intrinsics = fsio.read_json(d / "intrinsics.json")
    stats = fsio.read_json(d / "stats.json") if (d / "stats.json").exists() else {}
    return FrameBundle(bgr=bgr, depth_m=depth_m, mask=mask, intrinsics=intrinsics, stats=stats)


def bundle_sha256s(directory: Path | str) -> dict[str, str]:
    d = Path(directory)
    return {name: fsio.sha256_file(d / name) for name in FRAME_FILES if (d / name).exists()}


def copy_bundle(src: Path | str, dst: Path | str) -> dict[str, int]:
    s, d = Path(src), Path(dst)
    d.mkdir(parents=True, exist_ok=True)
    sizes: dict[str, int] = {}
    for name in FRAME_FILES:
        if (s / name).exists():
            data = fsio.read_bytes(s / name)
            fsio.atomic_write_bytes(d / name, data)
            sizes[name] = len(data)
    return sizes
