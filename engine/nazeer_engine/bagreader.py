"""RealSense ``.bag`` reading (contract C2.1, decisions B13/B14, bag reader facts).

* ``inspect_bag`` opens the file, reads the stream profiles / intrinsics / duration and
  stops;
* ``walk_bag`` yields one ``FramePair`` per *sampled* aligned colour+depth pair. The read
  index counts every pair that has both streams (pairs missing a stream are skipped
  without incrementing) and the sampling test runs **before** ``align.process`` (the
  parent aligned every frame and wasted 4 of 5). ``rgb8`` is converted to BGR exactly
  once. End-of-bag is decided by position (B14), never by ``current_status()``.

``pyrealsense2`` is imported lazily inside the functions so tests can inject a fake module.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from .constants import (
    BAG_EOF_MIN_POSITION_FRAC,
    BAG_FRAME_TIMEOUT_MS,
    BAG_STALL_RETRIES,
    FPS_NOMINAL,
    SAMPLE_EVERY_DEFAULT,
    SAMPLE_TARGET_FRAMES,
)
from .errors import BagError, BagNotFound, BagReadStalled, JobCancelled, JobStopped
from .fsio import bag_fingerprint

ProgressCallback = Callable[[int, float], None]


@dataclass
class BagInfo:
    path: str
    name: str
    size_bytes: int
    mtime_ns: int
    fingerprint: str
    duration_s: float
    device_name: str
    color: dict[str, Any]
    depth: dict[str, Any]
    depth_units_m: float
    intrinsics: dict[str, Any]
    n_frames_estimate: int
    sample_every_effective: int
    path_fallback: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class FramePair:
    read_index: int
    frame_number_color: int
    frame_number_depth: int
    color_timestamp_ms: float
    bag_time_s: float
    bgr: np.ndarray
    depth_m: np.ndarray
    intrinsics: dict[str, Any]
    depth_units_m: float


@dataclass
class WalkSummary:
    n_pairs: int = 0
    n_sampled: int = 0
    n_incomplete: int = 0
    end_reason: str = ""  # eof | stalled | cancelled | stopped | error
    last_position_fraction: float = 0.0
    elapsed_s: float = 0.0
    walk_complete: bool = False
    fps: int = FPS_NOMINAL
    n_frames_estimate: int = 0
    duration_s: float = 0.0
    sample_every: int = SAMPLE_EVERY_DEFAULT
    path_fallback: str | None = None
    retries: int = 0
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


def sample_every_for(n_frames_estimate: int) -> int:
    """C2.1: ``max(5, n_frames // 400)`` so long bags stay around 400 sampled frames."""
    return max(SAMPLE_EVERY_DEFAULT, int(n_frames_estimate) // SAMPLE_TARGET_FRAMES)


def _rs() -> Any:
    import pyrealsense2 as rs

    return rs


def _short_path_name(path: str) -> str | None:
    """Windows 8.3 short name for a non-ASCII path, or None when unavailable."""
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        GetShortPathNameW = kernel32.GetShortPathNameW
        GetShortPathNameW.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
        GetShortPathNameW.restype = wintypes.DWORD
        needed = GetShortPathNameW(path, None, 0)
        if needed == 0:
            return None
        buffer = ctypes.create_unicode_buffer(needed)
        if GetShortPathNameW(path, buffer, needed) == 0:
            return None
        short = buffer.value
        return short if short and short != path else None
    except Exception:
        return None


def _is_ascii(text: str) -> bool:
    try:
        text.encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def _start_pipeline(rs: Any, path: Path) -> tuple[Any, Any, str | None]:
    """Start playback; retry with the 8.3 short name on non-ASCII paths that librealsense
    cannot open (it uses narrow file APIs). Returns (pipeline, profile, path_fallback)."""
    candidates: list[tuple[str, str | None]] = [(str(path), None)]
    if not _is_ascii(str(path)):
        short = _short_path_name(str(path))
        if short:
            candidates.append((short, "short_name"))
    last_exc: Exception | None = None
    for candidate, fallback in candidates:
        cfg = rs.config()
        try:
            cfg.enable_device_from_file(candidate, repeat_playback=False)
            cfg.enable_stream(rs.stream.color)
            cfg.enable_stream(rs.stream.depth)
            pipe = rs.pipeline()
            profile = pipe.start(cfg)
            return pipe, profile, fallback
        except (RuntimeError, OSError) as exc:
            last_exc = exc
            continue
    if not _is_ascii(str(path)):
        raise BagError(
            "librealsense cannot open this non-ASCII path and no 8.3 short name exists "
            "(move or rename the bag folder to ASCII)",
            code="bag_path_non_ascii_unsupported",
            details={"path": str(path), "error": str(last_exc)},
        )
    raise BagError(
        f"cannot open bag: {last_exc}", details={"path": str(path), "error": str(last_exc)}
    )


def colour_needs_reversal(fmt: str) -> bool:
    """True for ``rgb8`` (reverse once to BGR), False for ``bgr8``; any other colour format
    is refused — the inference contract wants true-colour BGR, never a guess."""
    name = str(fmt).rsplit(".", 1)[-1].lower()
    if name == "rgb8":
        return True
    if name == "bgr8":
        return False
    raise BagError(
        f"unsupported colour stream format {fmt!r} (the engine reads rgb8 or bgr8)",
        code="bag_color_format_unsupported",
        details={"format": str(fmt)},
    )


def _intrinsics_dict(video_profile: Any) -> dict[str, Any]:
    intr = video_profile.get_intrinsics()
    return {
        "fx": float(intr.fx),
        "fy": float(intr.fy),
        "cx": float(intr.ppx),
        "cy": float(intr.ppy),
        "width": int(intr.width),
        "height": int(intr.height),
        "model": str(intr.model),
        "coeffs": [float(c) for c in intr.coeffs],
    }


def _stream_dict(video_profile: Any) -> dict[str, Any]:
    return {
        "width": int(video_profile.width()),
        "height": int(video_profile.height()),
        "fps": int(video_profile.fps()),
        "format": str(video_profile.format()),
    }


def _read_profiles(rs: Any, profile: Any) -> dict[str, Any]:
    dev = profile.get_device()
    playback = dev.as_playback()
    playback.set_real_time(False)
    color_profile = profile.get_stream(rs.stream.color).as_video_stream_profile()
    depth_profile = profile.get_stream(rs.stream.depth).as_video_stream_profile()
    duration_s = float(playback.get_duration().total_seconds())
    try:
        device_name = str(dev.get_info(rs.camera_info.name))
    except Exception:
        device_name = "unknown"
    try:
        depth_units = float(dev.first_depth_sensor().get_depth_scale())
    except Exception:
        depth_units = 0.001
    return {
        "playback": playback,
        "color": _stream_dict(color_profile),
        "depth": _stream_dict(depth_profile),
        "intrinsics": _intrinsics_dict(color_profile),
        "duration_s": duration_s,
        "device_name": device_name,
        "depth_units_m": depth_units,
    }


def inspect_bag(path: Path | str) -> BagInfo:
    p = Path(path)
    if not p.is_file():
        raise BagNotFound(f"bag not found: {p}", details={"path": str(p)})
    rs = _rs()
    pipe, profile, fallback = _start_pipeline(rs, p)
    try:
        info = _read_profiles(rs, profile)
    finally:
        try:
            pipe.stop()
        except Exception:
            pass
    colour_needs_reversal(info["color"]["format"])  # refuse unusable colour formats up front
    st = p.stat()
    fps = int(info["color"]["fps"]) or FPS_NOMINAL
    n_est = int(round(info["duration_s"] * fps))
    return BagInfo(
        path=str(p),
        name=p.name,
        size_bytes=int(st.st_size),
        mtime_ns=int(st.st_mtime_ns),
        fingerprint=bag_fingerprint(p),
        duration_s=info["duration_s"],
        device_name=info["device_name"],
        color=info["color"],
        depth=info["depth"],
        depth_units_m=info["depth_units_m"],
        intrinsics=info["intrinsics"],
        n_frames_estimate=n_est,
        sample_every_effective=sample_every_for(n_est),
        path_fallback=fallback,
    )


class BagWalk:
    """Iterator over sampled ``FramePair`` objects; ``summary`` is filled as it runs."""

    def __init__(
        self,
        path: Path | str,
        *,
        sample_every: int,
        cancel: threading.Event | None = None,
        stop: threading.Event | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> None:
        self.path = Path(path)
        self.sample_every = max(1, int(sample_every))
        self.cancel = cancel
        self.stop = stop
        self.on_progress = on_progress
        self.summary = WalkSummary(sample_every=self.sample_every)
        self._gen: Iterator[FramePair] = self._run()

    def __iter__(self) -> BagWalk:
        return self

    def __next__(self) -> FramePair:
        return next(self._gen)

    def close(self) -> None:
        self._gen.close()

    def _run(self) -> Iterator[FramePair]:
        if not self.path.is_file():
            raise BagNotFound(f"bag not found: {self.path}", details={"path": str(self.path)})
        rs = _rs()
        summary = self.summary
        t0 = time.perf_counter()
        pipe, profile, fallback = _start_pipeline(rs, self.path)
        summary.path_fallback = fallback
        try:
            info = _read_profiles(rs, profile)
            reverse = colour_needs_reversal(info["color"]["format"])
            playback = info["playback"]
            fps = int(info["color"]["fps"]) or FPS_NOMINAL
            summary.fps = fps
            summary.duration_s = info["duration_s"]
            summary.n_frames_estimate = int(round(info["duration_s"] * fps))
            duration_ns = max(info["duration_s"] * 1e9, 1.0)
            intrinsics = info["intrinsics"]
            depth_units_default = float(info["depth_units_m"])
            align = rs.align(rs.stream.color)
            read_index = 0
            first_ts_ms: float | None = None
            retries = 0
            while True:
                if self.cancel is not None and self.cancel.is_set():
                    summary.end_reason = "cancelled"
                    raise JobCancelled()
                if self.stop is not None and self.stop.is_set():
                    summary.end_reason = "stopped"
                    raise JobStopped()
                ok, frames = pipe.try_wait_for_frames(timeout_ms=BAG_FRAME_TIMEOUT_MS)
                if not ok:
                    at_end = summary.last_position_fraction >= BAG_EOF_MIN_POSITION_FRAC or (
                        summary.n_frames_estimate > 0
                        and read_index >= summary.n_frames_estimate - fps
                    )
                    if at_end:
                        summary.end_reason = "eof"
                        summary.walk_complete = True
                        break
                    retries += 1
                    summary.retries = retries
                    if retries > BAG_STALL_RETRIES:
                        summary.end_reason = "stalled"
                        raise BagReadStalled(
                            "bag playback stalled before the end of the file",
                            details={
                                "read_index": read_index,
                                "last_position_fraction": summary.last_position_fraction,
                                "retries": retries,
                            },
                        )
                    continue
                retries = 0
                cf = frames.get_color_frame()
                df = frames.get_depth_frame()
                if not cf or not df:
                    summary.n_incomplete += 1
                    continue
                index = read_index
                read_index += 1
                summary.n_pairs = read_index
                try:
                    fraction = float(playback.get_position()) / duration_ns
                except Exception:
                    fraction = summary.last_position_fraction
                summary.last_position_fraction = min(1.0, max(0.0, fraction))
                if self.on_progress is not None:
                    self.on_progress(index, summary.last_position_fraction)
                if index % self.sample_every:
                    continue
                aligned = align.process(frames)
                acf = aligned.get_color_frame()
                adf = aligned.get_depth_frame()
                if not acf or not adf:
                    summary.n_incomplete += 1
                    continue
                colour = np.asanyarray(acf.get_data())
                # rgb8 -> BGR exactly once; always a copy: the frame buffer is recycled
                bgr = np.ascontiguousarray(colour[..., ::-1]) if reverse else colour.copy()
                try:
                    units = float(adf.get_units())
                except Exception:
                    units = depth_units_default
                depth_m = np.asanyarray(adf.get_data()).astype(np.float32) * np.float32(units)
                ts_ms = float(acf.get_timestamp())
                if first_ts_ms is None:
                    first_ts_ms = ts_ms
                summary.n_sampled += 1
                yield FramePair(
                    read_index=index,
                    frame_number_color=int(acf.get_frame_number()),
                    frame_number_depth=int(adf.get_frame_number()),
                    color_timestamp_ms=ts_ms,
                    bag_time_s=(ts_ms - first_ts_ms) / 1000.0,
                    bgr=bgr,
                    depth_m=depth_m,
                    intrinsics=dict(intrinsics),
                    depth_units_m=units,
                )
        except (JobCancelled, JobStopped):
            raise
        except BagReadStalled:
            raise
        except Exception:
            if not summary.end_reason:
                summary.end_reason = "error"
            raise
        finally:
            summary.elapsed_s = time.perf_counter() - t0
            try:
                pipe.stop()
            except Exception:
                pass


def walk_bag(
    path: Path | str,
    *,
    sample_every: int,
    cancel: threading.Event | None = None,
    stop: threading.Event | None = None,
    on_progress: ProgressCallback | None = None,
) -> BagWalk:
    return BagWalk(
        path, sample_every=sample_every, cancel=cancel, stop=stop, on_progress=on_progress
    )
