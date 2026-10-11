from __future__ import annotations

from pathlib import Path

import numpy as np

from nazeer_engine import frames as fr
from tests.synthetic import make_synthetic_frame


def _bundle() -> fr.FrameBundle:
    f = make_synthetic_frame(seed=3)
    intr = dict(f.intrinsics)
    intr.update({"depth_units_m": 0.001, "depth_valid_bbox": [36, 20, 1279, 719]})
    return fr.FrameBundle(
        bgr=f.bgr, depth_m=f.depth_m, mask=f.mask, intrinsics=intr, stats={"z_var": 0.001}
    )


def test_save_and_load_round_trip_under_arabic_dir(arabic_dir: Path):
    bundle = _bundle()
    sizes = fr.save_bundle(arabic_dir, bundle)
    assert set(sizes) == set(fr.FRAME_FILES) and all(v > 0 for v in sizes.values())
    back = fr.load_bundle(arabic_dir)
    assert np.array_equal(back.bgr, bundle.bgr)
    assert np.array_equal(back.depth_m, bundle.depth_m) and back.depth_m.dtype == np.float32
    assert np.array_equal(back.mask, bundle.mask) and back.mask.dtype == np.uint8
    assert back.intrinsics == bundle.intrinsics and back.stats == {"z_var": 0.001}
    assert back.shape == (720, 1280)


def test_thumb_size_and_sha256s(tmp_path: Path):
    bundle = _bundle()
    thumb = fr.make_thumb(bundle.bgr)
    assert thumb.shape == (180, 320, 3)
    fr.save_bundle(tmp_path, bundle)
    hashes = fr.bundle_sha256s(tmp_path)
    assert set(hashes) == set(fr.FRAME_FILES) and all(len(h) == 64 for h in hashes.values())


def test_copy_bundle_preserves_hashes(tmp_path: Path):
    src = tmp_path / "src"
    dst = tmp_path / "اختبار" / "dst"
    fr.save_bundle(src, _bundle())
    sizes = fr.copy_bundle(src, dst)
    assert set(sizes) == set(fr.FRAME_FILES)
    assert fr.bundle_sha256s(src) == fr.bundle_sha256s(dst)


def test_save_without_thumb_and_mask_normalisation(tmp_path: Path):
    bundle = _bundle()
    bundle.mask = (bundle.mask != 0).astype(np.uint8)  # 0/1 mask is normalised to 0/255
    sizes = fr.save_bundle(tmp_path, bundle, thumb=False)
    assert "thumb.jpg" not in sizes
    assert set(np.unique(fr.load_bundle(tmp_path).mask)) <= {0, 255}
