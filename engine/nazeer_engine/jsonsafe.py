"""One finite-only JSON normaliser for everything the engine writes or serves.

Rule (inference contract, "Serialisation"): every number is passed through one
normaliser (``float`` / ``int`` / ``bool``, NaN / Inf -> ``null``, no numpy scalars) and
every document is dumped with ``allow_nan=False`` as the tripwire. Bare ``NaN`` tokens
break ``JSON.parse`` in the renderer.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from enum import Enum
from pathlib import PurePath
from typing import Any

import numpy as np
from starlette.responses import JSONResponse


def to_finite(obj: Any) -> Any:
    """Recursively convert ``obj`` into plain JSON types with only finite numbers."""
    if obj is None or isinstance(obj, (bool, str)):
        return obj
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        value = float(obj)
        return value if math.isfinite(value) else None
    if isinstance(obj, np.ndarray):
        return to_finite(obj.tolist())
    if isinstance(obj, dict):
        return {str(key): to_finite(value) for key, value in obj.items()}
    if isinstance(obj, (list, tuple, set, frozenset)):
        return [to_finite(item) for item in obj]
    if isinstance(obj, PurePath):
        return str(obj)
    if isinstance(obj, Enum):
        return to_finite(obj.value)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if hasattr(obj, "to_dict") and callable(obj.to_dict):
        return to_finite(obj.to_dict())
    if is_dataclass(obj) and not isinstance(obj, type):
        return to_finite(asdict(obj))
    raise TypeError(f"not JSON-safe: {type(obj).__name__}")


def dumps(obj: Any, *, indent: int | None = 2, sort_keys: bool = False) -> str:
    """Pretty JSON for files; raw UTF-8 (Arabic stays readable); NaN/Inf can never leak."""
    return json.dumps(
        to_finite(obj), ensure_ascii=False, allow_nan=False, indent=indent, sort_keys=sort_keys
    )


def dumps_canonical(obj: Any) -> str:
    """Deterministic compact JSON used for hashes (sorted keys, no whitespace)."""
    return json.dumps(
        to_finite(obj), ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
    )


def _reject_constant(name: str) -> Any:
    raise ValueError(f"non-finite JSON token not allowed: {name}")


def loads_strict(text: str | bytes) -> Any:
    """``json.loads`` that refuses the bare ``NaN`` / ``Infinity`` tokens."""
    if isinstance(text, bytes):
        text = text.decode("utf-8")
    return json.loads(text, parse_constant=_reject_constant)


class FiniteJSONResponse(JSONResponse):
    """Response class used by every route: normalised payload, ``allow_nan=False``."""

    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return json.dumps(
            to_finite(content), ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
