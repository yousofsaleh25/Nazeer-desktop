"""File I/O that is safe on Windows with non-ASCII paths and crash-safe (C2.9, C3.4).

Rules implemented here:

* image I/O goes through ``cv2.imencode`` / ``cv2.imdecode`` plus ``Path.read_bytes`` /
  ``Path.write_bytes`` (``cv2.imwrite`` / ``cv2.imread`` fail silently on non-ASCII
  Windows paths; Arabic folder names are realistic);
* ``.npy`` files are written through file objects for the same reason;
* every write is atomic: ``mkstemp`` in the target directory -> write -> flush -> ``fsync``
  -> ``os.replace`` with the C3.4 retry ladder on ``PermissionError`` (anti-virus and
  OneDrive hold files briefly); the final failure raises ``AtomicWriteError``;
* ``read_json`` turns a torn or unparsable file into ``CorruptFileError``.
"""

from __future__ import annotations

import hashlib
import io
import os
import tempfile
import time
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from . import jsonsafe
from .constants import AUTOSAVE_RETRY_DELAYS_S, SLOW_MEDIA_PROBE_BYTES, TEMP_PURGE_AGE_S
from .errors import AtomicWriteError, CorruptFileError

_MIB = 1024 * 1024
TEMP_PREFIXES: tuple[str, ...] = (".session_", ".tmp_", ".building_")


# --- bytes ---------------------------------------------------------------------------------


def read_bytes(path: Path | str) -> bytes:
    return Path(path).read_bytes()


def atomic_write_bytes(
    path: Path | str,
    data: bytes,
    *,
    prefix: str = ".tmp_",
    retry_delays: Sequence[float] = AUTOSAVE_RETRY_DELAYS_S,
) -> None:
    """mkstemp -> write -> flush -> fsync -> os.replace (retried on PermissionError)."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=prefix, suffix=target.suffix, dir=str(target.parent))
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        replace_with_retries(tmp, target, retry_delays=retry_delays)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def replace_with_retries(
    src: Path, dst: Path, *, retry_delays: Sequence[float] = AUTOSAVE_RETRY_DELAYS_S
) -> None:
    """``os.replace`` with the C3.4 ladder; raises ``AtomicWriteError`` after the last try."""
    attempts = len(retry_delays) + 1
    for attempt in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError as exc:
            if attempt == attempts - 1:
                raise AtomicWriteError(
                    f"could not replace {dst.name} after {attempts} attempts: {exc}",
                    details={
                        "path": str(dst),
                        "winerror": getattr(exc, "winerror", None),
                        "attempts": attempts,
                    },
                ) from exc
            time.sleep(retry_delays[attempt])


# --- JSON ----------------------------------------------------------------------------------


def write_json(path: Path | str, obj: Any, *, prefix: str = ".tmp_") -> bytes:
    """Atomic UTF-8 JSON write (``allow_nan=False``); returns the bytes written."""
    data = (jsonsafe.dumps(obj) + "\n").encode("utf-8")
    atomic_write_bytes(path, data, prefix=prefix)
    return data


def read_json(path: Path | str) -> Any:
    """Strict JSON read; a torn/unparsable file raises ``CorruptFileError``."""
    try:
        raw = read_bytes(path)
    except FileNotFoundError:
        raise
    try:
        return jsonsafe.loads_strict(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise CorruptFileError(
            f"corrupt JSON file {Path(path).name}: {exc}", details={"path": str(path)}
        ) from exc


# --- images and arrays ---------------------------------------------------------------------


def encode_image(image: np.ndarray, ext: str = ".png", *, jpeg_quality: int | None = None) -> bytes:
    import cv2

    params: list[int] = []
    if ext.lower() in (".jpg", ".jpeg") and jpeg_quality is not None:
        params = [int(cv2.IMWRITE_JPEG_QUALITY), int(jpeg_quality)]
    ok, buf = cv2.imencode(ext, image, params)
    if not ok:
        raise ValueError(f"cv2.imencode failed for {ext}")
    return buf.tobytes()


def decode_image(data: bytes, *, flags: int | None = None) -> np.ndarray:
    import cv2

    arr = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED if flags is None else flags)
    if image is None:
        raise CorruptFileError("cv2.imdecode returned None")
    return image


def write_image(path: Path | str, image: np.ndarray, *, jpeg_quality: int | None = None) -> int:
    data = encode_image(image, Path(path).suffix or ".png", jpeg_quality=jpeg_quality)
    atomic_write_bytes(path, data)
    return len(data)


def read_image(path: Path | str, *, flags: int | None = None) -> np.ndarray:
    return decode_image(read_bytes(path), flags=flags)


def write_npy(path: Path | str, array: np.ndarray) -> int:
    buf = io.BytesIO()
    np.save(buf, np.ascontiguousarray(array), allow_pickle=False)
    data = buf.getvalue()
    atomic_write_bytes(path, data)
    return len(data)


def read_npy(path: Path | str) -> np.ndarray:
    with io.BytesIO(read_bytes(path)) as buf:
        return np.load(buf, allow_pickle=False)


# --- hashing and fingerprints --------------------------------------------------------------


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path | str, *, chunk: int = _MIB) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def bag_fingerprint(path: Path | str) -> str:
    """sha256(size LE8 || mtime_ns LE8 || first 1 MiB || last 1 MiB) — C2.7 cache key."""
    p = Path(path)
    st = p.stat()
    digest = hashlib.sha256()
    digest.update(int(st.st_size).to_bytes(8, "little", signed=False))
    digest.update(int(st.st_mtime_ns).to_bytes(8, "little", signed=False))
    with open(p, "rb") as fh:
        digest.update(fh.read(_MIB))
        tail_start = max(0, st.st_size - _MIB)
        fh.seek(tail_start)
        digest.update(fh.read(_MIB))
    return digest.hexdigest()


def read_throughput_probe(
    path: Path | str, *, nbytes: int = SLOW_MEDIA_PROBE_BYTES, chunk: int = 8 * _MIB
) -> tuple[float, int, float]:
    """Sequentially read up to ``nbytes``; returns (MB/s, bytes_read, seconds). C2.8."""
    total = 0
    t0 = time.perf_counter()
    with open(path, "rb") as fh:
        while total < nbytes:
            block = fh.read(min(chunk, nbytes - total))
            if not block:
                break
            total += len(block)
    seconds = max(time.perf_counter() - t0, 1e-9)
    return total / 1e6 / seconds, total, seconds


# --- housekeeping --------------------------------------------------------------------------


def purge_stale_temps(
    root: Path | str,
    *,
    prefixes: Iterable[str] = TEMP_PREFIXES,
    age_s: float = TEMP_PURGE_AGE_S,
    now: float | None = None,
) -> int:
    """Delete leftover temp files/dirs older than ``age_s`` under ``root``; returns the count."""
    root_path = Path(root)
    if not root_path.is_dir():
        return 0
    current = time.time() if now is None else now
    prefixes = tuple(prefixes)
    removed = 0
    for entry in sorted(root_path.rglob("*"), key=lambda e: len(e.parts), reverse=True):
        if not entry.name.startswith(prefixes):
            continue
        try:
            age = current - entry.stat().st_mtime
        except OSError:
            continue
        if age < age_s:
            continue
        try:
            if entry.is_dir():
                import shutil

                shutil.rmtree(entry, ignore_errors=True)
            else:
                entry.unlink()
            removed += 1
        except OSError:
            continue
    return removed


def dir_size_bytes(path: Path | str) -> int:
    total = 0
    for entry in Path(path).rglob("*"):
        try:
            if entry.is_file():
                total += entry.stat().st_size
        except OSError:
            continue
    return total
