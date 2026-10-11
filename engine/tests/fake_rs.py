"""A scripted stand-in for ``pyrealsense2`` playback (the subset the engine uses)."""

from __future__ import annotations

from datetime import timedelta

import numpy as np


class _Stream:
    color = "color"
    depth = "depth"


class _CameraInfo:
    name = "name"


class _Intrinsics:
    def __init__(self) -> None:
        self.fx, self.fy = 642.9, 641.93
        self.ppx, self.ppy = 650.38, 366.27
        self.width, self.height = 1280, 720
        self.model = "distortion.inverse_brown_conrady"
        self.coeffs = [-0.0536, 0.0636, -0.0011, 0.001, -0.0204]


class _VideoProfile:
    def __init__(self, kind: str, fps: int = 30, color_format: str = "format.rgb8") -> None:
        self._kind = kind
        self._fps = fps
        self._color_format = color_format

    def as_video_stream_profile(self) -> _VideoProfile:
        return self

    def get_intrinsics(self) -> _Intrinsics:
        return _Intrinsics()

    def width(self) -> int:
        return 1280 if self._kind == "color" else 848

    def height(self) -> int:
        return 720 if self._kind == "color" else 480

    def fps(self) -> int:
        return self._fps

    def format(self) -> str:
        return self._color_format if self._kind == "color" else "format.z16"


class _Frame:
    def __init__(self, data: np.ndarray, number: int, ts_ms: float, units: float = 0.001):
        self._data = data
        self._number = number
        self._ts = ts_ms
        self._units = units

    def get_data(self) -> np.ndarray:
        return self._data

    def get_frame_number(self) -> int:
        return self._number

    def get_timestamp(self) -> float:
        return self._ts

    def get_units(self) -> float:
        return self._units

    def __bool__(self) -> bool:
        return True


class _Frameset:
    def __init__(self, color: _Frame | None, depth: _Frame | None) -> None:
        self._color = color
        self._depth = depth

    def get_color_frame(self) -> _Frame | None:
        return self._color

    def get_depth_frame(self) -> _Frame | None:
        return self._depth


class _Playback:
    def __init__(self, script: FakeScript) -> None:
        self._script = script
        self.real_time: bool | None = None

    def set_real_time(self, value: bool) -> None:
        self.real_time = value

    def get_duration(self) -> timedelta:
        return timedelta(seconds=self._script.duration_s)

    def get_position(self) -> int:
        return int(self._script.position_fraction * self._script.duration_s * 1e9)


class _Sensor:
    def get_depth_scale(self) -> float:
        return 0.001


class _Device:
    def __init__(self, script: FakeScript) -> None:
        self._playback = _Playback(script)

    def as_playback(self) -> _Playback:
        return self._playback

    def get_info(self, _key: str) -> str:
        return "Fake RealSense D455"

    def first_depth_sensor(self) -> _Sensor:
        return _Sensor()


class _Profile:
    def __init__(self, script: FakeScript) -> None:
        self._device = _Device(script)
        self._script = script

    def get_device(self) -> _Device:
        return self._device

    def get_stream(self, kind: str) -> _VideoProfile:
        return _VideoProfile(kind, fps=self._script.fps, color_format=self._script.color_format)


class _Config:
    def __init__(self, module: FakeRS) -> None:
        self._module = module
        self.file: str | None = None
        self.streams: list[str] = []

    def enable_device_from_file(self, path: str, repeat_playback: bool = True) -> None:
        self._module.open_calls.append((path, repeat_playback))
        if self._module.fail_paths and path in self._module.fail_paths:
            raise RuntimeError(f"cannot open {path}")
        self.file = path

    def enable_stream(self, kind: str) -> None:
        self.streams.append(kind)


class _Pipeline:
    def __init__(self, module: FakeRS) -> None:
        self._module = module
        self.started = False
        self.stopped = False

    def start(self, cfg: _Config) -> _Profile:
        self.started = True
        self._module.pipelines.append(self)
        self._module.script.position_fraction = 0.0
        self._module.script.cursor = 0
        return _Profile(self._module.script)

    def try_wait_for_frames(self, timeout_ms: int = 5000) -> tuple[bool, _Frameset | None]:
        script = self._module.script
        self._module.wait_calls += 1
        if script.cursor >= len(script.framesets):
            return False, None
        fs = script.framesets[script.cursor]
        script.cursor += 1
        script.position_fraction = script.fraction_at(script.cursor)
        return True, fs

    def stop(self) -> None:
        self.stopped = True


class _Align:
    def __init__(self, module: FakeRS, kind: str) -> None:
        self._module = module
        self.kind = kind

    def process(self, frames: _Frameset) -> _Frameset:
        self._module.align_calls += 1
        return frames


class FakeScript:
    def __init__(
        self,
        framesets: list[_Frameset],
        *,
        duration_s: float,
        fps: int = 30,
        final_fraction: float = 1.0,
        color_format: str = "format.rgb8",
    ) -> None:
        self.framesets = framesets
        self.duration_s = duration_s
        self.fps = fps
        self.final_fraction = final_fraction
        self.color_format = color_format
        self.cursor = 0
        self.position_fraction = 0.0

    def fraction_at(self, cursor: int) -> float:
        if not self.framesets:
            return 0.0
        return self.final_fraction * cursor / len(self.framesets)


class FakeRS:
    """Module-like object; inject via ``monkeypatch.setitem(sys.modules, "pyrealsense2", fake)``."""

    stream = _Stream
    camera_info = _CameraInfo

    def __init__(self, script: FakeScript, *, fail_paths: set[str] | None = None) -> None:
        self.script = script
        self.fail_paths = fail_paths or set()
        self.open_calls: list[tuple[str, bool]] = []
        self.pipelines: list[_Pipeline] = []
        self.align_calls = 0
        self.wait_calls = 0

    def config(self) -> _Config:
        return _Config(self)

    def pipeline(self) -> _Pipeline:
        return _Pipeline(self)

    def align(self, kind: str) -> _Align:
        return _Align(self, kind)


def make_frameset(
    index: int,
    *,
    height: int = 24,
    width: int = 32,
    red: int = 200,
    missing: str | None = None,
    depth_value: int = 2000,
    ts0_ms: float = 1_776_178_680_000.0,
) -> _Frameset:
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    rgb[..., 0] = red  # R channel (the bag stores rgb8)
    rgb[..., 1] = 100
    rgb[..., 2] = 50
    depth = np.full((height, width), depth_value, dtype=np.uint16)
    ts = ts0_ms + index * (1000.0 / 30.0)
    color = _Frame(rgb, number=25979 + index, ts_ms=ts)
    depth_frame = _Frame(depth, number=25844 + index, ts_ms=ts)
    if missing == "color":
        color = None
    if missing == "depth":
        depth_frame = None
    return _Frameset(color, depth_frame)
