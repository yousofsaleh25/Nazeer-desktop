from __future__ import annotations

import sys
import threading
from pathlib import Path

import numpy as np
import pytest

from nazeer_engine import bagreader as br
from nazeer_engine.constants import BAG_STALL_RETRIES
from nazeer_engine.errors import BagError, BagNotFound, BagReadStalled, JobCancelled, JobStopped
from tests.fake_rs import FakeRS, FakeScript, make_frameset


@pytest.fixture
def bag_file(tmp_path: Path) -> Path:
    path = tmp_path / "test.bag"
    path.write_bytes(b"\x00" * 4096)
    return path


def _inject(monkeypatch, fake: FakeRS) -> None:
    monkeypatch.setitem(sys.modules, "pyrealsense2", fake)


def _script(
    n: int,
    *,
    missing_at: dict[int, str] | None = None,
    duration_s: float | None = None,
    **kw,
) -> FakeScript:
    missing_at = missing_at or {}
    framesets = [make_frameset(i, missing=missing_at.get(i)) for i in range(n)]
    return FakeScript(framesets, duration_s=duration_s if duration_s else n / 30.0, **kw)


def test_walk_samples_before_align_converts_rgb_once_and_counts_pairs(monkeypatch, bag_file):
    fake = FakeRS(_script(12, missing_at={3: "depth", 7: "color"}))
    _inject(monkeypatch, fake)
    walk = br.walk_bag(bag_file, sample_every=5)
    pairs = list(walk)
    # 12 framesets, 2 incomplete -> 10 pairs (read indices 0..9); sampled 0 and 5
    assert [p.read_index for p in pairs] == [0, 5]
    assert fake.align_calls == 2 and walk.summary.n_pairs == 10
    assert walk.summary.n_incomplete == 2 and walk.summary.n_sampled == 2
    first = pairs[0]
    assert (
        first.bgr.flags["C_CONTIGUOUS"] and first.bgr[0, 0, 2] == 200 and first.bgr[0, 0, 0] == 50
    )
    assert first.depth_m.dtype == np.float32 and abs(float(first.depth_m[0, 0]) - 2.0) < 1e-6
    assert first.frame_number_color == 25979 and first.frame_number_depth == 25844
    assert first.bag_time_s == 0.0 and pairs[1].bag_time_s > 0.15
    assert first.intrinsics["cx"] == 650.38 and first.intrinsics["coeffs"][0] == -0.0536
    assert walk.summary.end_reason == "eof" and walk.summary.walk_complete
    assert fake.pipelines[-1].stopped and fake.pipelines[-1].started
    assert fake.open_calls[0][1] is False  # repeat_playback=False


def test_colour_format_is_checked_never_guessed(monkeypatch, bag_file):
    bgr_script = _script(6, color_format="format.bgr8")
    _inject(monkeypatch, FakeRS(bgr_script))
    first = next(iter(br.walk_bag(bag_file, sample_every=5)))
    # a bgr8 bag is already BGR: R stays in channel 2 only if the stored array was RGB
    assert first.bgr[0, 0, 0] == 200 and first.bgr[0, 0, 2] == 50
    assert not np.shares_memory(first.bgr, bgr_script.framesets[0].get_color_frame().get_data())
    _inject(monkeypatch, FakeRS(_script(6, color_format="format.yuyv")))
    with pytest.raises(BagError) as exc:
        list(br.walk_bag(bag_file, sample_every=5))
    assert exc.value.code == "bag_color_format_unsupported"
    with pytest.raises(BagError):
        br.inspect_bag(bag_file)
    assert br.colour_needs_reversal("format.rgb8") and not br.colour_needs_reversal("bgr8")


def test_eof_requires_position_near_end(monkeypatch, bag_file):
    # the file claims 60 frames (2 s) but only 10 arrive and the position stops at 0.4
    fake = FakeRS(_script(10, duration_s=2.0, final_fraction=0.4))
    _inject(monkeypatch, fake)
    walk = br.walk_bag(bag_file, sample_every=1)
    with pytest.raises(BagReadStalled) as info:
        list(walk)
    assert (
        info.value.details["read_index"] == 10 and info.value.details["retries"] > BAG_STALL_RETRIES
    )
    assert walk.summary.end_reason == "stalled" and not walk.summary.walk_complete
    assert fake.pipelines[-1].stopped


def test_eof_by_read_index_when_position_lags(monkeypatch, bag_file):
    script = _script(30, final_fraction=0.5)  # position reporting lags, but we read every frame
    fake = FakeRS(script)
    _inject(monkeypatch, fake)
    walk = br.walk_bag(bag_file, sample_every=10)
    pairs = list(walk)
    assert len(pairs) == 3 and walk.summary.end_reason == "eof"


def test_cancel_and_stop_events(monkeypatch, bag_file):
    fake = FakeRS(_script(20))
    _inject(monkeypatch, fake)
    cancel = threading.Event()
    walk = br.walk_bag(bag_file, sample_every=1, cancel=cancel)
    next(walk)
    cancel.set()
    with pytest.raises(JobCancelled):
        next(walk)
    assert walk.summary.end_reason == "cancelled" and fake.pipelines[-1].stopped
    fake2 = FakeRS(_script(20))
    _inject(monkeypatch, fake2)
    stop = threading.Event()
    walk2 = br.walk_bag(bag_file, sample_every=1, stop=stop)
    next(walk2)
    stop.set()
    with pytest.raises(JobStopped):
        next(walk2)
    assert walk2.summary.end_reason == "stopped" and fake2.pipelines[-1].stopped


def test_progress_callback_and_summary_timing(monkeypatch, bag_file):
    fake = FakeRS(_script(6))
    _inject(monkeypatch, fake)
    seen: list[tuple[int, float]] = []
    walk = br.walk_bag(bag_file, sample_every=3, on_progress=lambda i, f: seen.append((i, f)))
    list(walk)
    assert [i for i, _ in seen] == [0, 1, 2, 3, 4, 5]
    assert all(0.0 <= f <= 1.0 for _, f in seen) and seen[-1][1] == 1.0
    assert walk.summary.elapsed_s >= 0 and walk.summary.last_position_fraction == 1.0


def test_pipe_stopped_even_when_consumer_raises(monkeypatch, bag_file):
    fake = FakeRS(_script(6))
    _inject(monkeypatch, fake)
    walk = br.walk_bag(bag_file, sample_every=1)
    next(walk)
    walk.close()
    assert fake.pipelines[-1].stopped


def test_inspect_bag_fields(monkeypatch, bag_file):
    fake = FakeRS(FakeScript([], duration_s=771 / 30.0))
    _inject(monkeypatch, fake)
    info = br.inspect_bag(bag_file)
    assert info.n_frames_estimate == 771 and info.sample_every_effective == 5
    assert info.color == {"width": 1280, "height": 720, "fps": 30, "format": "format.rgb8"}
    assert info.depth["width"] == 848 and info.depth_units_m == 0.001
    assert info.intrinsics["fx"] == 642.9 and info.intrinsics["model"].endswith("brown_conrady")
    assert info.device_name == "Fake RealSense D455" and len(info.fingerprint) == 64
    assert info.size_bytes == 4096 and info.path_fallback is None
    assert fake.pipelines[-1].stopped and fake.pipelines[-1].started
    assert fake.script.framesets == [] and br.sample_every_for(4000) == 10


def test_inspect_missing_bag_raises(monkeypatch, tmp_path):
    _inject(monkeypatch, FakeRS(FakeScript([], duration_s=1.0)))
    with pytest.raises(BagNotFound):
        br.inspect_bag(tmp_path / "nope.bag")
    with pytest.raises(BagNotFound):
        list(br.walk_bag(tmp_path / "nope.bag", sample_every=5))


def test_non_ascii_path_falls_back_to_short_name(monkeypatch, tmp_path):
    folder = tmp_path / "اختبار"
    folder.mkdir()
    bag = folder / "x.bag"
    bag.write_bytes(b"\x00" * 100)
    fake = FakeRS(_script(3), fail_paths={str(bag)})
    _inject(monkeypatch, fake)
    monkeypatch.setattr(br, "_short_path_name", lambda p: "C:\\SHORT~1\\x.bag")
    info = br.inspect_bag(bag)
    assert info.path_fallback == "short_name"
    assert fake.open_calls[-1][0] == "C:\\SHORT~1\\x.bag"
    walk = br.walk_bag(bag, sample_every=1)
    list(walk)
    assert walk.summary.path_fallback == "short_name"


def test_non_ascii_path_without_short_name_is_a_typed_error(monkeypatch, tmp_path):
    folder = tmp_path / "اختبار"
    folder.mkdir()
    bag = folder / "x.bag"
    bag.write_bytes(b"\x00" * 100)
    fake = FakeRS(_script(3), fail_paths={str(bag)})
    _inject(monkeypatch, fake)
    monkeypatch.setattr(br, "_short_path_name", lambda p: None)
    with pytest.raises(BagError) as info:
        br.inspect_bag(bag)
    assert info.value.code == "bag_path_non_ascii_unsupported"


def test_ascii_open_failure_is_bag_error(monkeypatch, bag_file):
    fake = FakeRS(_script(3), fail_paths={str(bag_file)})
    _inject(monkeypatch, fake)
    with pytest.raises(BagError) as info:
        br.inspect_bag(bag_file)
    assert info.value.code == "bag_unreadable"
