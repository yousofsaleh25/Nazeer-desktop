"""File responses with strong ETags and conditional 304s (the canvas fetches the 1.5-3.7 MB
frame assets once per session; JSON files are never cached).

Files are read whole and sent from memory: the ETag is computed from exactly the bytes that
are sent, and no file handle stays open while a slow client reads — on Windows an open
handle would make an autosave's ``os.replace`` or a delete's trash rename fail. Ranges are
not offered (B35); every file is small (PDF uploads are capped at 64 MiB)."""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from pathlib import Path

from starlette.requests import Request
from starlette.responses import Response

from ..errors import NotFound

MEDIA_TYPES: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".json": "application/json",
    ".npy": "application/octet-stream",
    ".pdf": "application/pdf",
}
IMMUTABLE_CACHE = "private, max-age=86400"
NO_STORE = "no-store"
_ETAG_CACHE_SIZE = 512
_etags: OrderedDict[tuple[str, int, int], str] = OrderedDict()
_etags_lock = threading.Lock()


def _cached_etag(key: tuple[str, int, int]) -> str | None:
    with _etags_lock:
        etag = _etags.get(key)
        if etag is not None:
            _etags.move_to_end(key)
        return etag


def _remember_etag(key: tuple[str, int, int], etag: str) -> None:
    with _etags_lock:
        _etags[key] = etag
        _etags.move_to_end(key)
        while len(_etags) > _ETAG_CACHE_SIZE:
            _etags.popitem(last=False)


def _stat_key(path: Path) -> tuple[str, int, int]:
    st = path.stat()
    return (str(path), st.st_mtime_ns, st.st_size)


def _matches(request: Request, etag: str) -> bool:
    header = request.headers.get("if-none-match")
    return bool(header) and etag in [tag.strip() for tag in header.split(",")]


def file_response(
    request: Request,
    path: Path,
    *,
    cache: str | None = None,
    download_name: str | None = None,
    inline: bool = True,
) -> Response:
    suffix = path.suffix.lower()
    media_type = MEDIA_TYPES.get(suffix, "application/octet-stream")
    cache_control = cache or (NO_STORE if suffix == ".json" else IMMUTABLE_CACHE)
    try:
        key = _stat_key(path)
        known = _cached_etag(key)
        if known is not None and _matches(request, known):
            return Response(
                status_code=304, headers={"ETag": known, "Cache-Control": cache_control}
            )
        data = path.read_bytes()
        after = _stat_key(path)
    except FileNotFoundError as exc:  # replaced or deleted between the check and the read
        raise NotFound(
            "asset not found", code="asset_not_found", details={"name": path.name}
        ) from exc
    etag = f'"{hashlib.sha256(data).hexdigest()}"'
    if after == key:  # only cache an ETag for the exact file version that was read
        _remember_etag(key, etag)
    headers = {"ETag": etag, "Cache-Control": cache_control, "Accept-Ranges": "none"}
    if _matches(request, etag):
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": cache_control})
    if download_name:
        disposition = "inline" if inline else "attachment"
        headers["Content-Disposition"] = f'{disposition}; filename="{download_name}"'
    return Response(content=data, media_type=media_type, headers=headers)
