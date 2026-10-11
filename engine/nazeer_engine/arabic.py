"""Arabic text for the overlay PNG (ADR-D7 §1, B17, B36).

matplotlib 3.11 lays text out with libraqm (HarfBuzz shaping + FriBidi reordering), so
the overlay passes **logical-order Unicode** and lets matplotlib shape it with the pinned
IBM Plex Sans Arabic TTF (verified visually 2026-10-11: pre-shaped visual-order text is
reversed a second time). Mixed labels are built as a left-to-right paragraph (a leading
LRM) with every Arabic part wrapped in a first-strong isolate (FSI ... PDI), which renders
"<Arabic name>:  1.554 m ± 1.1 cm" exactly like the operator-approved v3 labels.

For a matplotlib without libraqm the old path is kept as a fallback: ``arabic_reshaper``
configured from the TTF (``config_for_true_type_font`` + ``ENABLE_ALL_LIGATURES``) and
``python-bidi``. A missing font (or, on the fallback path, missing libraries) raises
``ArabicStackMissing`` (HTTP 500 at finalize); nothing is installed at runtime and there is
never an Arial fallback.
"""

from __future__ import annotations

import re
import threading
from typing import Any

from . import assets
from .constants import FONT_SHA256_PINNED
from .errors import ArabicStackMissing
from .fsio import sha256_file

# Built from code points: no invisible control character appears in this file.
_ARABIC_RANGES: tuple[tuple[int, int], ...] = (
    (0x0600, 0x06FF),
    (0x0750, 0x077F),
    (0x08A0, 0x08FF),
    (0xFB50, 0xFDFF),
    (0xFE70, 0xFEFF),
)
ARABIC_RE = re.compile("[" + "".join(f"{chr(a)}-{chr(b)}" for a, b in _ARABIC_RANGES) + "]")
LRM = chr(0x200E)  # left-to-right mark
FSI = chr(0x2068)  # first strong isolate
PDI = chr(0x2069)  # pop directional isolate

_LOCK = threading.Lock()
_STATE: dict[str, Any] = {}


def reset_stack() -> None:
    """Forget the cached stack (tests)."""
    with _LOCK:
        _STATE.clear()


def native_layout() -> bool:
    """True when matplotlib shapes and reorders text itself (libraqm)."""
    try:
        from matplotlib import ft2font

        return hasattr(ft2font.FT2Font, "_layout")
    except Exception:
        return False


def ensure_arabic_stack() -> dict[str, Any]:
    with _LOCK:
        if "font_path" in _STATE:
            return _STATE
        path = assets.font_path()  # raises ArabicStackMissing when the TTF is absent
        native = native_layout()
        state: dict[str, Any] = {
            "font_path": path,
            "font_sha256": sha256_file(path),
            "native": native,
        }
        if not native:
            try:
                import arabic_reshaper
                from bidi.algorithm import get_display
            except ImportError as exc:
                raise ArabicStackMissing(
                    f"Arabic shaping libraries are not installed: {exc}",
                    details={"missing": str(exc)},
                ) from exc
            try:
                config = arabic_reshaper.config_for_true_type_font(
                    str(path), arabic_reshaper.ENABLE_ALL_LIGATURES
                )
                state["reshaper"] = arabic_reshaper.ArabicReshaper(configuration=config)
            except Exception as exc:  # fontTools missing or the font unreadable
                raise ArabicStackMissing(
                    f"cannot configure the Arabic reshaper from {path.name}: {exc}",
                    details={"font": str(path)},
                ) from exc
            state["get_display"] = get_display
        _STATE.update(state)
        return _STATE


def has_arabic(text: str | None) -> bool:
    return bool(text) and ARABIC_RE.search(text or "") is not None


def _fallback_visual(text: str) -> str:
    state = ensure_arabic_stack()
    return state["get_display"](state["reshaper"].reshape(text))


def display_text(text: str | None) -> str:
    """A standalone paragraph (its own base direction): pure Arabic sentences, footers."""
    if not text or not has_arabic(text):
        return text or ""
    if ensure_arabic_stack()["native"]:
        return text
    return _fallback_visual(text)


def isolate(text: str | None) -> str:
    """An Arabic fragment inside a larger left-to-right label."""
    if not text or not has_arabic(text):
        return text or ""
    if ensure_arabic_stack()["native"]:
        return f"{FSI}{text}{PDI}"
    return _fallback_visual(text)


def ltr(text: str) -> str:
    """Force a left-to-right paragraph (the label layout the operator approved)."""
    if ensure_arabic_stack()["native"]:
        return f"{LRM}{text}"
    return text


def font_properties() -> Any:
    state = ensure_arabic_stack()
    props = state.get("font_properties")
    if props is None:
        from matplotlib.font_manager import FontProperties

        props = FontProperties(fname=str(state["font_path"]))
        state["font_properties"] = props
    return props


def stack_status() -> dict[str, Any]:
    try:
        state = ensure_arabic_stack()
    except ArabicStackMissing as exc:
        return {
            "ok": False,
            "reason": exc.message,
            "font_sha256": None,
            "font_pinned": False,
            "native_layout": None,
        }
    return {
        "ok": True,
        "reason": "",
        "font_sha256": state["font_sha256"],
        # the text probe's shaping assumptions were measured with this exact TTF (B33)
        "font_pinned": state["font_sha256"] == FONT_SHA256_PINNED,
        "native_layout": state["native"],
    }
