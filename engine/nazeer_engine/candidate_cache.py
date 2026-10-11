"""Candidate cache layout and housekeeping (C2.7).

Results live at ``<root>/candidates/<fingerprint>/<params_hash>/`` with an LRU purge above
2 GiB. Publishing is atomic and Windows-safe (B28): an existing destination is moved aside
before ``os.replace`` and removed afterwards."""

from __future__ import annotations

import hashlib
import os
import shutil
import time
from pathlib import Path
from typing import Any

from . import fsio, jsonsafe
from .constants import CACHE_MAX_BYTES
from .fsio import dir_size_bytes, replace_with_retries

RESULT_FILE = "candidates.json"
BUILDING_PREFIX = ".building_"
OLD_PREFIX_MARK = ".old_"


def params_hash(params: dict[str, Any]) -> str:
    return hashlib.sha256(jsonsafe.dumps_canonical(params).encode("utf-8")).hexdigest()[:16]


def candidates_root(root: Path | str) -> Path:
    return Path(root) / "candidates"


def result_dir(root: Path | str, fingerprint: str, ph: str) -> Path:
    return candidates_root(root) / fingerprint / ph


def building_dir(root: Path | str, fingerprint: str, job_id: str) -> Path:
    return candidates_root(root) / fingerprint / f"{BUILDING_PREFIX}{job_id}"


def result_exists(directory: Path | str) -> bool:
    return (Path(directory) / RESULT_FILE).is_file()


def complete_summary(directory: Path | str) -> dict[str, Any] | None:
    """The cache-hit summary of a result whose walk read the whole bag, else None: a walk the
    operator stopped early stays viewable at its URL but is never served as a cache hit."""
    path = Path(directory) / RESULT_FILE
    if not path.is_file():
        return None
    try:
        data = fsio.read_json(path)
    except Exception:  # a torn result is simply rebuilt
        return None
    walk = data.get("walk") or {}
    if not walk.get("walk_complete") or walk.get("stopped_early"):
        return None
    return {"n_candidates": data.get("n_candidates"), "partial": bool(data.get("partial"))}


def touch(directory: Path | str) -> None:
    try:
        os.utime(directory, None)
    except OSError:
        pass


def publish(tmp_dir: Path | str, final_dir: Path | str) -> None:
    """Move the finished build into place; an existing result is replaced atomically."""
    tmp, final = Path(tmp_dir), Path(final_dir)
    final.parent.mkdir(parents=True, exist_ok=True)
    old: Path | None = None
    if final.exists():
        old = final.with_name(f"{final.name}{OLD_PREFIX_MARK}{int(time.time() * 1000)}")
        replace_with_retries(final, old)
    replace_with_retries(tmp, final)
    if old is not None:
        shutil.rmtree(old, ignore_errors=True)


def list_result_dirs(root: Path | str) -> list[tuple[Path, float, int]]:
    """(dir, mtime, bytes) for every published result, oldest first."""
    base = candidates_root(root)
    out: list[tuple[Path, float, int]] = []
    if not base.is_dir():
        return out
    for fp_dir in base.iterdir():
        if not fp_dir.is_dir():
            continue
        for ph_dir in fp_dir.iterdir():
            if not ph_dir.is_dir() or ph_dir.name.startswith(BUILDING_PREFIX):
                continue
            if OLD_PREFIX_MARK in ph_dir.name:
                shutil.rmtree(ph_dir, ignore_errors=True)
                continue
            try:
                mtime = ph_dir.stat().st_mtime
            except OSError:
                continue
            out.append((ph_dir, mtime, dir_size_bytes(ph_dir)))
    out.sort(key=lambda t: t[1])
    return out


def purge_lru(
    root: Path | str, *, max_bytes: int = CACHE_MAX_BYTES, keep: Path | str | None = None
) -> dict[str, Any]:
    """Delete the least-recently-used results until the cache is within ``max_bytes``."""
    entries = list_result_dirs(root)
    total = sum(b for _, _, b in entries)
    removed: list[str] = []
    keep_path = Path(keep).resolve() if keep is not None else None
    for directory, _mtime, size in entries:
        if total <= max_bytes:
            break
        if keep_path is not None and directory.resolve() == keep_path:
            continue
        shutil.rmtree(directory, ignore_errors=True)
        parent = directory.parent
        try:
            if parent.is_dir() and not any(parent.iterdir()):
                parent.rmdir()
        except OSError:
            pass
        total -= size
        removed.append(str(directory))
    return {"removed": removed, "bytes_after": total, "count_after": len(entries) - len(removed)}


def cache_stats(root: Path | str) -> dict[str, int]:
    entries = list_result_dirs(root)
    return {"count": len(entries), "bytes": sum(b for _, _, b in entries)}


def purge_building_dirs(root: Path | str) -> int:
    base = candidates_root(root)
    n = 0
    if not base.is_dir():
        return 0
    for fp_dir in base.iterdir():
        if not fp_dir.is_dir():
            continue
        for d in fp_dir.iterdir():
            if d.is_dir() and (d.name.startswith(BUILDING_PREFIX) or OLD_PREFIX_MARK in d.name):
                shutil.rmtree(d, ignore_errors=True)
                n += 1
    return n
