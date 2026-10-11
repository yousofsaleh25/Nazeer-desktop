"""Asset and model locations, resolved through one helper (PyInstaller-safe)."""

from __future__ import annotations

import sys
from pathlib import Path

from .constants import FONT_FILE, MODEL_FILE_DEFAULT
from .errors import ArabicStackMissing


def asset_dir() -> Path:
    frozen_base = getattr(sys, "_MEIPASS", None)
    if frozen_base:
        return Path(frozen_base) / "nazeer_engine" / "assets"
    return Path(__file__).resolve().parent / "assets"


def font_path() -> Path:
    path = asset_dir() / "fonts" / FONT_FILE
    if not path.is_file():
        raise ArabicStackMissing(f"Arabic font missing: {path}", details={"path": str(path)})
    return path


def font_sha256() -> str:
    from .fsio import sha256_file

    return sha256_file(font_path())


def logo_path() -> Path | None:
    path = asset_dir() / "logo.png"
    return path if path.is_file() else None


def models_dir() -> Path:
    frozen_base = getattr(sys, "_MEIPASS", None)
    if frozen_base:
        return Path(frozen_base) / "models"
    return Path(__file__).resolve().parents[1] / "models"


def default_model_path() -> Path:
    return models_dir() / MODEL_FILE_DEFAULT
