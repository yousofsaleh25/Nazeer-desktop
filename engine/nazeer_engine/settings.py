"""Engine settings, data-root validation (C3.1) and the offline environment (B26)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from pathlib import Path

from .constants import DEFAULT_CORS_ORIGINS
from .errors import EngineError

FORBIDDEN_SEGMENTS = frozenset({"desktop", "documents", "onedrive"})
ONEDRIVE_ENV_VARS = ("OneDrive", "OneDriveConsumer", "OneDriveCommercial")
LAYOUT_DIRS = ("sessions", "candidates", "trash", "logs", "backups")
DEV_ENV_VAR = "NAZEER_ENGINE_DEV"


class DataRootError(EngineError):
    code = "data_root_invalid"
    status = 500


@dataclass(frozen=True)
class Settings:
    data_root: Path
    model_path: Path
    host: str = "127.0.0.1"
    port: int = 0
    token: str | None = None
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    allow_null_origin: bool = False
    log_level: str = "INFO"
    warmup: bool = True
    allow_any_data_root: bool = False
    stub_model: bool = False
    extra: dict[str, str] = field(default_factory=dict)

    def with_(self, **changes: object) -> Settings:
        return replace(self, **changes)


def dev_env_enabled() -> bool:
    return os.environ.get(DEV_ENV_VAR) == "1"


def _under(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def validate_data_root(raw: Path | str, *, allow_any: bool = False) -> Path:
    """Absolute, created if missing, writable, never Desktop/Documents/OneDrive (C3.1)."""
    path = Path(raw)
    if not path.is_absolute():
        raise DataRootError(f"data root must be absolute: {raw}", details={"path": str(raw)})
    resolved = path.resolve()
    if not allow_any:
        bad = [part for part in resolved.parts if part.lower() in FORBIDDEN_SEGMENTS]
        if bad:
            raise DataRootError(
                f"data root under a forbidden folder ({bad[0]}): {resolved}",
                details={"path": str(resolved), "segment": bad[0]},
            )
        for var in ONEDRIVE_ENV_VARS:
            value = os.environ.get(var)
            if value and _under(resolved, Path(value).resolve()):
                raise DataRootError(
                    f"data root lies under %{var}%: {resolved}",
                    details={"path": str(resolved), "env": var},
                )
    try:
        resolved.mkdir(parents=True, exist_ok=True)
        probe = resolved / f".write_probe_{os.getpid()}"
        probe.write_bytes(b"ok")
        probe.unlink()
    except OSError as exc:
        raise DataRootError(
            f"data root is not writable: {resolved} ({exc})", details={"path": str(resolved)}
        ) from exc
    return resolved


def ensure_layout(root: Path) -> dict[str, str]:
    """Create the C3.1 layout; returns the absolute paths."""
    paths: dict[str, str] = {}
    for name in LAYOUT_DIRS:
        directory = root / name
        directory.mkdir(parents=True, exist_ok=True)
        paths[name] = str(directory)
    recent = root / "recent.json"
    if not recent.exists():
        recent.write_text('{"items": []}\n', encoding="utf-8")
    paths["recent"] = str(recent)
    paths["history_db"] = str(root / "history.sqlite")
    return paths


def apply_offline_env(root: Path | None = None) -> dict[str, str]:
    """Environment that keeps ultralytics / matplotlib / FastAPI telemetry offline (B26).

    Must run before any of those libraries is imported; idempotent (setdefault)."""
    values = {
        "YOLO_OFFLINE": "1",
        "YOLO_VERBOSE": "False",
        "OTEL_SDK_DISABLED": "true",
        "FASTAPI_OTEL_AUTO_CONFIGURE": "false",
    }
    if root is not None:
        values["YOLO_CONFIG_DIR"] = str(Path(root) / "ultralytics")
        values["MPLCONFIGDIR"] = str(Path(root) / "mpl")
        Path(values["YOLO_CONFIG_DIR"]).mkdir(parents=True, exist_ok=True)
        Path(values["MPLCONFIGDIR"]).mkdir(parents=True, exist_ok=True)
    for key, value in values.items():
        os.environ.setdefault(key, value)
    return {key: os.environ[key] for key in values}
