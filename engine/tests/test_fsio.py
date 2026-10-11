from __future__ import annotations

import os
import time
from pathlib import Path

import numpy as np
import pytest

from nazeer_engine import fsio
from nazeer_engine.errors import AtomicWriteError, CorruptFileError


def test_image_round_trip_under_arabic_path(arabic_dir: Path):
    image = np.zeros((20, 30, 3), dtype=np.uint8)
    image[:, :, 2] = 200
    path = arabic_dir / "صورة.png"
    fsio.write_image(path, image)
    back = fsio.read_image(path)
    assert back.shape == image.shape and np.array_equal(back, image)
    thumb = arabic_dir / "thumb.jpg"
    fsio.write_image(thumb, image, jpeg_quality=85)
    assert fsio.read_image(thumb).shape == image.shape


def test_npy_round_trip_under_arabic_path(arabic_dir: Path):
    depth = np.random.default_rng(0).random((8, 9), dtype=np.float32)
    path = arabic_dir / "عمق.npy"
    fsio.write_npy(path, depth)
    assert np.array_equal(fsio.read_npy(path), depth)


def test_atomic_write_leaves_no_temp_and_replaces_content(tmp_path: Path):
    target = tmp_path / "session.json"
    fsio.write_json(target, {"a": 1}, prefix=".session_")
    fsio.write_json(target, {"a": 2}, prefix=".session_")
    assert fsio.read_json(target) == {"a": 2}
    assert [p.name for p in tmp_path.iterdir()] == ["session.json"]


def test_atomic_write_retries_on_permission_error(tmp_path: Path, monkeypatch):
    target = tmp_path / "f.bin"
    target.write_bytes(b"old")
    real_replace = os.replace
    calls = {"n": 0}

    def flaky(src, dst):
        calls["n"] += 1
        if calls["n"] <= 2:
            raise PermissionError(5, "held")
        return real_replace(src, dst)

    monkeypatch.setattr(os, "replace", flaky)
    monkeypatch.setattr(time, "sleep", lambda _s: None)
    fsio.atomic_write_bytes(target, b"new")
    assert target.read_bytes() == b"new" and calls["n"] == 3


def test_atomic_write_gives_up_after_ladder_and_keeps_original(tmp_path: Path, monkeypatch):
    target = tmp_path / "f.bin"
    target.write_bytes(b"old")

    def always(src, dst):
        raise PermissionError(32, "sharing violation")

    monkeypatch.setattr(os, "replace", always)
    monkeypatch.setattr(time, "sleep", lambda _s: None)
    with pytest.raises(AtomicWriteError) as info:
        fsio.atomic_write_bytes(target, b"new")
    assert info.value.details["attempts"] == 4
    assert target.read_bytes() == b"old"
    assert [p.name for p in tmp_path.iterdir()] == ["f.bin"]


def test_read_json_corrupt_file_raises_typed_error(tmp_path: Path):
    path = tmp_path / "torn.json"
    path.write_bytes(b'{"a": 1, "b": ')
    with pytest.raises(CorruptFileError):
        fsio.read_json(path)
    path.write_bytes(b'{"a": NaN}')
    with pytest.raises(CorruptFileError):
        fsio.read_json(path)


def test_purge_stale_temps_only_old_and_only_prefixed(tmp_path: Path):
    old = tmp_path / ".session_abc.json"
    old.write_bytes(b"x")
    fresh = tmp_path / ".session_new.json"
    fresh.write_bytes(b"x")
    keep = tmp_path / "session.json"
    keep.write_bytes(b"x")
    stale_time = time.time() - 7200
    os.utime(old, (stale_time, stale_time))
    removed = fsio.purge_stale_temps(tmp_path, age_s=3600)
    assert removed == 1 and not old.exists() and fresh.exists() and keep.exists()


def test_bag_fingerprint_changes_with_head_tail_size_and_mtime(tmp_path: Path):
    path = tmp_path / "a.bag"
    data = bytearray(np.random.default_rng(1).integers(0, 256, 3 * 1024 * 1024, dtype=np.uint8))
    path.write_bytes(data)
    fp0 = fsio.bag_fingerprint(path)
    assert len(fp0) == 64 and fp0 == fsio.bag_fingerprint(path)
    data[-1] ^= 0xFF
    path.write_bytes(data)
    fp_tail = fsio.bag_fingerprint(path)
    assert fp_tail != fp0
    data[0] ^= 0xFF
    path.write_bytes(data)
    assert fsio.bag_fingerprint(path) != fp_tail
    stamp = time.time() - 100
    os.utime(path, (stamp, stamp))
    fp_mtime = fsio.bag_fingerprint(path)
    path.write_bytes(data + b"\x00")
    assert fsio.bag_fingerprint(path) != fp_mtime


def test_read_throughput_probe_reports_bytes_and_rate(tmp_path: Path):
    path = tmp_path / "blob.bin"
    path.write_bytes(b"\x01" * (2 * 1024 * 1024))
    mb_s, nbytes, seconds = fsio.read_throughput_probe(path, nbytes=1024 * 1024)
    assert nbytes == 1024 * 1024 and mb_s > 0 and seconds > 0


def test_sha256_helpers_agree(tmp_path: Path):
    path = tmp_path / "x.bin"
    path.write_bytes(b"abc")
    assert fsio.sha256_file(path) == fsio.sha256_bytes(b"abc")
    assert fsio.sha256_bytes(b"abc").startswith("ba7816bf")
