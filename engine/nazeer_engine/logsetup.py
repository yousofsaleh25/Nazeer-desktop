"""JSON-lines logging to stderr and a rotating file under the data root.

Stdout is reserved for the readiness / fatal lines (B24, B25), so no handler here ever
writes to stdout. Files are opened as UTF-8 so Arabic session names never raise."""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path

_STANDARD_ATTRS = set(logging.LogRecord("x", 0, "x", 0, "", (), None).__dict__) | {
    "message",
    "asctime",
}


class JsonLineFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(data_root: Path | None, *, level: str = "INFO") -> logging.Logger:
    handlers: list[logging.Handler] = []
    stream = logging.StreamHandler(sys.stderr)
    stream.setFormatter(JsonLineFormatter())
    handlers.append(stream)
    if data_root is not None:
        log_dir = Path(data_root) / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            log_dir / "engine.log", maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
        )
        file_handler.setFormatter(JsonLineFormatter())
        handlers.append(file_handler)
    logging.basicConfig(level=level.upper(), handlers=handlers, force=True)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    return logging.getLogger("nazeer_engine")
