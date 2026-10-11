"""``<root>/recent.json`` — the operator's recently opened bags (C3.1, step 1 of the flow)."""

from __future__ import annotations

import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import fsio
from .constants import RECENT_BAGS_KEEP
from .errors import CorruptFileError


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


class RecentBags:
    def __init__(self, path: Path | str, *, keep: int = RECENT_BAGS_KEEP) -> None:
        self.path = Path(path)
        self.keep = keep
        self._lock = threading.Lock()

    def _read(self) -> list[dict[str, Any]]:
        if not self.path.is_file():
            return []
        try:
            data = fsio.read_json(self.path)
        except CorruptFileError:
            return []  # a torn recent list is not worth failing over; it is rewritten
        items = data.get("items", []) if isinstance(data, dict) else []
        return [i for i in items if isinstance(i, dict) and isinstance(i.get("path"), str)]

    def _write(self, items: list[dict[str, Any]]) -> None:
        fsio.write_json(self.path, {"items": items[: self.keep]})

    @staticmethod
    def _decorate(item: dict[str, Any]) -> dict[str, Any]:
        path = Path(item["path"])
        exists = path.is_file()
        out = dict(item)
        out["name"] = item.get("name") or path.name
        out["exists"] = exists
        out["size_bytes"] = path.stat().st_size if exists else None
        return out

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return [self._decorate(i) for i in self._read()]

    def add(self, path: Path | str, *, fingerprint: str | None = None) -> list[dict[str, Any]]:
        p = str(Path(path))
        with self._lock:
            items = [i for i in self._read() if i["path"].lower() != p.lower()]
            entry: dict[str, Any] = {"path": p, "name": Path(p).name, "last_opened_at": _now()}
            if fingerprint:
                entry["fingerprint"] = fingerprint
            items.insert(0, entry)
            self._write(items)
            return [self._decorate(i) for i in items[: self.keep]]

    def remove(self, path: Path | str) -> list[dict[str, Any]]:
        p = str(Path(path)).lower()
        with self._lock:
            items = [i for i in self._read() if i["path"].lower() != p]
            self._write(items)
            return [self._decorate(i) for i in items]
