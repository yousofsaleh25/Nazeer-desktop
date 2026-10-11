from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
ENGINE_DIR = TESTS_DIR.parent
PROJECT_DIR = ENGINE_DIR.parent
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from tests.synthetic import INTRINSICS, make_synthetic_frame  # noqa: E402

REAL_MARKERS = ("realbag", "realmodel", "realpdf")


def pytest_collection_modifyitems(config, items) -> None:
    """Real-resource tests are opt-in: select them with ``-m realbag`` (etc.) or set
    ``NAZEER_REAL=1``; the default suite needs no bag, model or browser."""
    markexpr = getattr(config.option, "markexpr", "") or ""
    if os.environ.get("NAZEER_REAL") == "1":
        return
    for item in items:
        for name in REAL_MARKERS:
            if item.get_closest_marker(name) is not None and name not in markexpr:
                item.add_marker(pytest.mark.skip(reason=f"{name}: opt in with -m {name}"))


GOLDEN_BAG = PROJECT_DIR / "data" / ".bag" / "20260414_175757-006.bag"
SMALL_BAG = PROJECT_DIR / "data" / ".bag" / "20260414_180708-004.bag"
MODEL_PATH = ENGINE_DIR / "models" / "best.pt"


@pytest.fixture
def intrinsics_dict() -> dict:
    return dict(INTRINSICS)


@pytest.fixture
def synthetic_frame():
    return make_synthetic_frame(seed=0)


@pytest.fixture
def data_root(tmp_path: Path) -> Path:
    root = tmp_path / "root"
    root.mkdir()
    return root


@pytest.fixture
def arabic_dir(tmp_path: Path) -> Path:
    directory = tmp_path / "اختبار"
    directory.mkdir()
    return directory


def _skip_unless(path: Path, marker: str) -> None:
    if not path.exists():
        pytest.skip(f"{marker}: {path} not present")


@pytest.fixture
def golden_bag() -> Path:
    _skip_unless(GOLDEN_BAG, "realbag")
    return GOLDEN_BAG


@pytest.fixture
def small_bag() -> Path:
    _skip_unless(SMALL_BAG, "realbag")
    return SMALL_BAG


@pytest.fixture
def real_model_path() -> Path:
    _skip_unless(MODEL_PATH, "realmodel")
    return MODEL_PATH


@pytest.fixture(autouse=True)
def _dev_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NAZEER_ENGINE_DEV", "1")
    monkeypatch.setenv("YOLO_OFFLINE", "1")
    monkeypatch.setenv("YOLO_VERBOSE", "False")
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    os.environ.setdefault("MPLCONFIGDIR", str(ENGINE_DIR / ".mplconfig"))
