from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from nazeer_engine import segmenter as seg
from nazeer_engine.constants import MODEL_SHA256_PINNED
from nazeer_engine.errors import EngineError, ModelContractError, ModelHashMismatch
from nazeer_engine.fsio import read_image


class _Tensor:
    def __init__(self, arr: np.ndarray) -> None:
        self._arr = arr

    def cpu(self) -> _Tensor:
        return self

    def numpy(self) -> np.ndarray:
        return self._arr

    def __getitem__(self, i):
        return _Tensor(self._arr[i])

    def __len__(self) -> int:
        return len(self._arr)


class _Boxes:
    def __init__(self, confs, xyxy) -> None:
        self.conf = _Tensor(np.asarray(confs, dtype=np.float32))
        self.xyxy = _Tensor(np.asarray(xyxy, dtype=np.float32))

    def __len__(self) -> int:
        return len(self.conf)


class _Masks:
    def __init__(self, data) -> None:
        self.data = _Tensor(np.asarray(data))


class _Result:
    def __init__(self, boxes, masks) -> None:
        self.boxes = boxes
        self.masks = masks


class _FakeModel:
    def __init__(self, result) -> None:
        self.result = result
        self.calls: list[dict] = []

    def predict(self, bgr, **kwargs):
        self.calls.append(kwargs)
        return [self.result]


def _two_detections(h: int = 8, w: int = 10, mask_shape=None):
    shape = mask_shape or (h, w)
    m0 = np.zeros(shape, dtype=np.float32)
    m1 = np.zeros(shape, dtype=np.float32)
    m1[2:6, 3:8] = 1.0
    return _Result(_Boxes([0.6, 0.95], [[0, 0, 4, 4], [3, 2, 8, 6]]), _Masks([m0, m1]))


def test_hash_mismatch_and_missing_file(tmp_path: Path):
    weights = tmp_path / "w.pt"
    weights.write_bytes(b"not a model")
    with pytest.raises(ModelHashMismatch) as info:
        seg.CamelSegmenter(weights, loader=lambda p, d: _FakeModel(None))
    assert info.value.details["expected"] == MODEL_SHA256_PINNED
    with pytest.raises(EngineError) as missing:
        seg.CamelSegmenter(tmp_path / "none.pt", loader=lambda p, d: _FakeModel(None))
    assert missing.value.code == "model_missing"


def test_predict_contract_kwargs_and_highest_confidence(tmp_path: Path):
    weights = tmp_path / "w.pt"
    weights.write_bytes(b"weights")
    model = _FakeModel(_two_detections())
    s = seg.CamelSegmenter(weights, expected_sha256=None, loader=lambda p, d: model)
    assert s.weights_name == "w.pt" and len(s.sha256) == 64 and not s.is_stub
    bgr = np.zeros((8, 10, 3), dtype=np.uint8)
    det = s.predict(bgr)
    kwargs = model.calls[-1]
    assert kwargs["retina_masks"] is True and kwargs["conf"] == 0.5 and kwargs["imgsz"] == 640
    assert kwargs["device"] == "cpu" and kwargs["half"] is False and kwargs["verbose"] is False
    assert det.ok and det.conf == pytest.approx(0.95) and det.n_detections == 2
    assert det.bbox_xyxy == [3.0, 2.0, 8.0, 6.0]
    assert det.mask.shape == (8, 10) and det.mask.dtype == np.uint8
    assert set(np.unique(det.mask)) == {0, 255} and int((det.mask != 0).sum()) == 20
    assert s.warm_up((8, 10)) >= 0.0 and s.warmup_ms is not None


def test_no_detection_never_returns_an_empty_mask(tmp_path: Path):
    weights = tmp_path / "w.pt"
    weights.write_bytes(b"weights")
    empty = _Result(_Boxes([], np.zeros((0, 4))), _Masks(np.zeros((0, 8, 10))))
    s = seg.CamelSegmenter(weights, expected_sha256=None, loader=lambda p, d: _FakeModel(empty))
    det = s.predict(np.zeros((8, 10, 3), dtype=np.uint8))
    assert not det.ok and det.reason == "no_detection" and det.mask is None
    none_result = _Result(None, None)
    assert not seg.detection_from_result(none_result, (8, 10)).ok
    assert not seg.detection_from_result(None, (8, 10)).ok


def test_mask_shape_mismatch_is_a_contract_error(tmp_path: Path):
    weights = tmp_path / "w.pt"
    weights.write_bytes(b"weights")
    wrong = _two_detections(mask_shape=(4, 5))
    s = seg.CamelSegmenter(weights, expected_sha256=None, loader=lambda p, d: _FakeModel(wrong))
    with pytest.raises(ModelContractError) as info:
        s.predict(np.zeros((8, 10, 3), dtype=np.uint8))
    assert info.value.details["mask_shape"] == [4, 5]


def test_predict_rejects_non_bgr_input(tmp_path: Path):
    weights = tmp_path / "w.pt"
    weights.write_bytes(b"weights")
    s = seg.CamelSegmenter(weights, expected_sha256=None, loader=lambda p, d: _FakeModel(None))
    with pytest.raises(ValueError):
        s.predict(np.zeros((8, 10), dtype=np.uint8))


def test_stub_segmenter_and_detection_from_mask():
    mask = np.zeros((8, 10), dtype=np.uint8)
    mask[1:4, 2:7] = 255
    det = seg.detection_from_mask(mask, conf=0.8)
    assert det.ok and det.bbox_xyxy == [2.0, 1.0, 7.0, 4.0] and det.conf == 0.8
    stub = seg.StubSegmenter(det)
    assert stub.is_stub and stub.sha256 == "stub" and stub.predict(np.zeros((8, 10, 3))) is det
    assert stub.calls == 1 and stub.warm_up() == 0.0
    assert not seg.StubSegmenter().predict(np.zeros((8, 10, 3))).ok
    fn_stub = seg.StubSegmenter(lambda bgr: seg.detection_from_mask(np.zeros(bgr.shape[:2])))
    assert not fn_stub.predict(np.zeros((8, 10, 3))).ok
    assert det.summary()["n_detections"] == 1


@pytest.mark.realmodel
def test_real_model_reproduces_golden_frame(real_model_path: Path):
    golden = Path(r"E:\camel_beauty\reference\notebooks\data\rgbd_20260514_145407\rgb.png")
    if not golden.exists():
        pytest.skip("golden PNG not present")
    s = seg.CamelSegmenter(real_model_path)
    assert s.sha256 == MODEL_SHA256_PINNED
    assert s.warm_up() < 3000.0
    stored = read_image(golden)
    bgr = np.ascontiguousarray(stored[..., ::-1])  # the file is stored with swapped channels
    det = s.predict(bgr)
    assert det.ok and det.mask.shape == bgr.shape[:2]
    assert abs(det.conf - 0.959) <= 0.01
    n_px = int((det.mask != 0).sum())
    assert abs(n_px - 269033) <= 0.01 * 269033
    rows = np.flatnonzero((det.mask != 0).any(axis=1))
    assert abs(int(rows[0]) - 9) <= 2 and abs(int(rows[-1]) - 715) <= 2
