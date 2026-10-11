from __future__ import annotations

import os
from pathlib import Path

import pytest

from nazeer_engine import settings as s
from nazeer_engine.versions import library_versions


def test_validate_data_root_requires_absolute(tmp_path: Path):
    with pytest.raises(s.DataRootError):
        s.validate_data_root("relative/dir")


def test_validate_data_root_refuses_forbidden_segments(tmp_path: Path):
    for name in ("Desktop", "documents", "OneDrive"):
        with pytest.raises(s.DataRootError) as info:
            s.validate_data_root(tmp_path / name / "root")
        assert info.value.details["segment"].lower() == name.lower()
    # a folder merely containing the word is fine (no substring false positives)
    ok = s.validate_data_root(tmp_path / "DocumentsArchive" / "root")
    assert ok.is_dir()


def test_validate_data_root_refuses_onedrive_env(tmp_path: Path, monkeypatch):
    cloud = tmp_path / "cloud"
    cloud.mkdir()
    monkeypatch.setenv("OneDrive", str(cloud))
    with pytest.raises(s.DataRootError):
        s.validate_data_root(cloud / "root")
    assert s.validate_data_root(cloud / "root", allow_any=True).is_dir()


def test_validate_data_root_creates_and_probes_writability(tmp_path: Path):
    root = s.validate_data_root(tmp_path / "new" / "root")
    assert root.is_dir() and not any(root.iterdir())


def test_ensure_layout_creates_dirs_and_recent_json(data_root: Path):
    paths = s.ensure_layout(data_root)
    for name in s.LAYOUT_DIRS:
        assert (data_root / name).is_dir() and paths[name] == str(data_root / name)
    assert (data_root / "recent.json").read_text(encoding="utf-8").startswith('{"items"')


def test_apply_offline_env_sets_defaults_without_overriding(data_root: Path, monkeypatch):
    monkeypatch.setenv("YOLO_OFFLINE", "already")
    monkeypatch.delenv("MPLCONFIGDIR", raising=False)
    values = s.apply_offline_env(data_root)
    assert values["YOLO_OFFLINE"] == "already"
    assert Path(values["MPLCONFIGDIR"]).is_dir() and Path(values["YOLO_CONFIG_DIR"]).is_dir()
    assert os.environ["OTEL_SDK_DISABLED"] == "true"


def test_library_versions_has_every_stamped_key(data_root: Path):
    versions = library_versions(
        model_file="best.pt", model_sha256="abc", data_root=data_root, app={"electron": "35"}
    )
    for key in (
        "python",
        "platform",
        "engine_version",
        "numpy",
        "opencv_python",
        "scipy",
        "ultralytics",
        "pyrealsense2",
        "torch",
        "matplotlib",
        "arabic_reshaper",
        "python_bidi",
        "pypdf",
        "model_sha256",
        "data_root",
        "app_version",
        "electron",
        "chromium",
    ):
        assert key in versions
    assert versions["pyrealsense2"] != "NOT INSTALLED"
    assert versions["electron"] == "35" and versions["chromium"] is None
