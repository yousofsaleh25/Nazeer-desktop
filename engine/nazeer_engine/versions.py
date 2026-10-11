"""Library-version stamp (engineering rule): every session, report model and manifest
records the versions of the libraries that produced it. Versions come from pip metadata
(``pyrealsense2`` has no ``__version__``), so this never imports torch or cv2."""

from __future__ import annotations

import platform
from importlib import metadata
from pathlib import Path
from typing import Any

from .constants import ENGINE_VERSION

PIP_NAMES: tuple[str, ...] = (
    "numpy",
    "opencv-python",
    "scipy",
    "ultralytics",
    "pyrealsense2",
    "torch",
    "matplotlib",
    "pillow",
    "arabic-reshaper",
    "python-bidi",
    "pypdf",
    "fastapi",
    "starlette",
    "uvicorn",
    "pydantic",
)

APP_KEYS: tuple[str, ...] = ("app_version", "electron", "chromium")


def _dist_version(name: str) -> str:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return "NOT INSTALLED"


def library_versions(
    *,
    model_file: str | None = None,
    model_sha256: str | None = None,
    data_root: Path | str | None = None,
    app: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "python": platform.python_version(),
        "platform": f"{platform.system()} {platform.release()}",
        "engine_version": ENGINE_VERSION,
    }
    for name in PIP_NAMES:
        out[name.replace("-", "_")] = _dist_version(name)
    out["model_file"] = model_file
    out["model_sha256"] = model_sha256
    out["data_root"] = str(data_root) if data_root is not None else None
    for key in APP_KEYS:
        out[key] = (app or {}).get(key)
    return out
