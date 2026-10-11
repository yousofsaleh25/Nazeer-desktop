"""YOLO11n-seg wrapper implementing the model card's inference contract (§3):

BGR input (true colours), letterbox 640, ``conf=0.5``, highest-confidence detection only,
``retina_masks=True`` (a mask of the wrong shape is a contract breach, never resized —
B21), sha256 checked before loading, one lock around ``predict`` (B24/B26 hygiene).
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from .constants import (
    MODEL_SHA256_PINNED,
    WARMUP_FRAME_SHAPE,
    YOLO_CONF,
    YOLO_IMGSZ,
    YOLO_IOU,
    YOLO_MASK_THRESHOLD,
    YOLO_MAX_DET,
)
from .errors import EngineError, ModelContractError, ModelHashMismatch
from .fsio import sha256_file

os.environ.setdefault("YOLO_VERBOSE", "False")
os.environ.setdefault("YOLO_OFFLINE", "1")


@dataclass
class Detection:
    ok: bool
    mask: np.ndarray | None = None  # HxW uint8 0/255, aligned to the input frame
    bbox_xyxy: list[float] | None = None
    conf: float | None = None
    n_detections: int = 0
    reason: str = ""  # "" or "no_detection"

    def summary(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "conf": self.conf,
            "bbox_xyxy": self.bbox_xyxy,
            "n_detections": self.n_detections,
            "reason": self.reason,
        }


class SegmenterLike(Protocol):
    sha256: str
    weights_name: str
    is_stub: bool

    def predict(self, bgr: np.ndarray) -> Detection: ...


def _to_numpy(value: Any) -> np.ndarray:
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        value = value.numpy()
    return np.asarray(value)


def _load_yolo(path: Path, device: str) -> Any:
    """Lazy ultralytics import with the offline / stdout hygiene applied first."""
    import cv2

    cv2.setNumThreads(2)
    # not guarded: a half-failed torch import must surface here (exit 3, model_load_failed)
    # instead of resurfacing later as an unrelated AttributeError inside ultralytics
    import torch

    torch.set_num_threads(max(1, (os.cpu_count() or 2) - 2))
    from ultralytics import YOLO

    try:
        from ultralytics.utils import LOGGER

        for handler in list(LOGGER.handlers):
            if isinstance(handler, logging.StreamHandler) and handler.stream is sys.stdout:
                handler.setStream(sys.stderr)
    except Exception:
        pass
    return YOLO(str(path), task="segment")


class CamelSegmenter:
    """The one pinned checkpoint, hash-checked at load (inference contract "Integrity")."""

    is_stub = False

    def __init__(
        self,
        weights_path: Path | str,
        *,
        expected_sha256: str | None = MODEL_SHA256_PINNED,
        device: str = "cpu",
        loader: Callable[[Path, str], Any] | None = None,
    ) -> None:
        path = Path(weights_path)
        if not path.is_file():
            raise EngineError(
                f"model file missing: {path}", code="model_missing", details={"path": str(path)}
            )
        self.weights_path = path
        self.weights_name = path.name
        self.sha256 = sha256_file(path)
        if expected_sha256 is not None and self.sha256 != expected_sha256:
            raise ModelHashMismatch(
                f"model sha256 mismatch for {path.name}",
                details={"expected": expected_sha256, "actual": self.sha256, "path": str(path)},
            )
        self.device = device
        self._lock = threading.Lock()
        self._model = (loader or _load_yolo)(path, device)
        self.warmup_ms: float | None = None

    def warm_up(self, shape: tuple[int, int] = WARMUP_FRAME_SHAPE) -> float:
        frame = np.zeros((int(shape[0]), int(shape[1]), 3), dtype=np.uint8)
        t0 = time.perf_counter()
        self.predict(frame)
        self.warmup_ms = (time.perf_counter() - t0) * 1000.0
        return self.warmup_ms

    def predict(self, bgr: np.ndarray) -> Detection:
        if bgr.ndim != 3 or bgr.shape[2] != 3 or bgr.dtype != np.uint8:
            raise ValueError("predict expects an HxWx3 uint8 BGR frame")
        with self._lock:
            results = self._model.predict(
                bgr,
                imgsz=YOLO_IMGSZ,
                conf=YOLO_CONF,
                iou=YOLO_IOU,
                max_det=YOLO_MAX_DET,
                retina_masks=True,
                half=False,
                device=self.device,
                verbose=False,
            )
        return detection_from_result(results[0] if results else None, bgr.shape[:2])


def detection_from_result(result: Any, frame_shape: tuple[int, int]) -> Detection:
    """Highest-confidence detection of an ultralytics result; never an empty mask."""
    boxes = getattr(result, "boxes", None) if result is not None else None
    masks = getattr(result, "masks", None) if result is not None else None
    if boxes is None or masks is None or len(boxes) == 0:
        return Detection(ok=False, reason="no_detection", n_detections=0)
    confs = _to_numpy(boxes.conf).astype(np.float64).reshape(-1)
    best = int(np.argmax(confs))
    raw = _to_numpy(masks.data[best])
    if tuple(raw.shape) != tuple(frame_shape):
        raise ModelContractError(
            "retina mask shape differs from the frame (retina_masks contract violated)",
            details={"mask_shape": list(raw.shape), "frame_shape": list(frame_shape)},
        )
    mask = (raw > YOLO_MASK_THRESHOLD).astype(np.uint8) * 255
    bbox = [float(x) for x in _to_numpy(boxes.xyxy[best]).reshape(-1)[:4]]
    return Detection(
        ok=True,
        mask=mask,
        bbox_xyxy=bbox,
        conf=float(confs[best]),
        n_detections=int(len(confs)),
        reason="",
    )


def detection_from_mask(mask: np.ndarray, conf: float = 0.9) -> Detection:
    """Build a Detection from a mask (tests and stubs)."""
    mask_u8 = (np.asarray(mask) != 0).astype(np.uint8) * 255
    ys, xs = np.nonzero(mask_u8)
    if xs.size == 0:
        return Detection(ok=False, reason="no_detection", n_detections=0)
    bbox = [float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1)]
    return Detection(ok=True, mask=mask_u8, bbox_xyxy=bbox, conf=float(conf), n_detections=1)


class StubSegmenter:
    """Test double: a constant Detection, a callable ``fn(bgr) -> Detection``, or nothing."""

    is_stub = True
    sha256 = "stub"
    weights_name = "stub"

    def __init__(
        self, fn_or_detection: Callable[[np.ndarray], Detection] | Detection | None = None
    ):
        self._fn = fn_or_detection
        self.calls = 0
        self.warmup_ms: float | None = 0.0

    def warm_up(self, shape: tuple[int, int] = WARMUP_FRAME_SHAPE) -> float:
        self.warmup_ms = 0.0
        return 0.0

    def predict(self, bgr: np.ndarray) -> Detection:
        self.calls += 1
        if self._fn is None:
            return Detection(ok=False, reason="no_detection", n_detections=0)
        if isinstance(self._fn, Detection):
            return self._fn
        return self._fn(bgr)
