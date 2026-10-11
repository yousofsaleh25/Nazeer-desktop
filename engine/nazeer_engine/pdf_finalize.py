"""PDF post-processing after the app prints the report (ADR-D7, C3.7, B6, B18, B33).

The app prints the React page with Electron's ``printToPDF`` and uploads the bytes; the
engine then probes and seals it:

* **pixel probe (hard)** — some image XObject on some page decodes to exactly the
  approved overlay PNG (same shape, max |Δ| ≤ ``PDF_PIXEL_MAX_ABS_DIFF``). A same-shape
  image that differs is ``overlay_drift``; no same-shape image is ``overlay_missing``.
* **text probe (soft unless required)** — every operator-given name appears in the text
  layer, matched per maximal same-script run after NFKC (Arabic presentation forms →
  letters), harakat / tatweel / bidi-control stripping and whitespace removal (Chromium
  reorders mixed-script runs, so whole-string matching would refuse good PDFs).
* **font probe (soft unless required)** — an ``IBMPlexSansArabic`` subset is embedded.
* **attachments** — the overlay PNG, ``session.json`` and ``report_model.json`` are
  attached with pypdf and read back with matching sha256; a failure keeps the PDF with
  ``attachments_ok: false`` and a reason (C3.7).
"""

from __future__ import annotations

import hashlib
import io
import re
import unicodedata
from typing import Any

import numpy as np

from .constants import ENGINE_VERSION, PDF_PIXEL_MAX_ABS_DIFF
from .errors import Unprocessable

PLEX_FONT_TOKEN = "IBMPlexSansArabic"
# Character classes are built from code points so that no invisible bidi-control
# character ever appears in this source file.
_STRIP_RANGES: tuple[tuple[int, int], ...] = (
    (0x064B, 0x065F),  # harakat
    (0x0670, 0x0670),  # superscript alef
    (0x0640, 0x0640),  # tatweel
    (0x200B, 0x200F),  # zero-width space .. right-to-left mark
    (0x202A, 0x202E),  # bidi embeddings / overrides
    (0x2066, 0x2069),  # bidi isolates
)
_ARABIC_RANGES: tuple[tuple[int, int], ...] = (
    (0x0600, 0x06FF),
    (0x0750, 0x077F),
    (0x08A0, 0x08FF),
    (0xFB50, 0xFDFF),
    (0xFE70, 0xFEFF),
)


def _char_class(ranges: tuple[tuple[int, int], ...], extra: str = "") -> re.Pattern[str]:
    parts = [f"\\u{a:04x}" if a == b else f"\\u{a:04x}-\\u{b:04x}" for a, b in ranges]
    return re.compile("[" + "".join(parts) + extra + "]")


_STRIP_RE = _char_class(_STRIP_RANGES, r"\s")
_ARABIC_CHAR_RE = _char_class(_ARABIC_RANGES)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_text(text: str) -> str:
    """NFKC + strip harakat, tatweel, bidi controls and all whitespace."""
    return _STRIP_RE.sub("", unicodedata.normalize("NFKC", text or ""))


def name_runs(name: str) -> list[str]:
    """Maximal runs of Arabic letters or of other letters/digits, normalised.

    Punctuation and symbols separate runs and are dropped: their position relative to
    neighbouring runs is decided by the bidi algorithm (Chromium writes "جمل-7" into the
    text layer as "7-جمل"), so only the letter/digit runs are stable evidence."""
    runs: list[str] = []
    current = ""
    current_kind: str | None = None
    for ch in unicodedata.normalize("NFKC", name or ""):
        if ch.isspace():
            kind = None
        elif _STRIP_RE.match(ch):
            continue  # harakat, tatweel, bidi controls are transparent inside a word
        elif _ARABIC_CHAR_RE.match(ch):
            kind = "arabic"
        elif ch.isalnum():
            kind = "other"
        else:
            kind = None
        if kind != current_kind and current:
            runs.append(current)
            current = ""
        current_kind = kind
        if kind is not None:
            current += ch
    if current:
        runs.append(current)
    out = [normalize_text(r) for r in runs]
    return [r for r in out if r]


def _open(pdf_bytes: bytes) -> Any:
    from pypdf import PdfReader

    if not pdf_bytes or not pdf_bytes.lstrip()[:5].startswith(b"%PDF-"):
        raise Unprocessable("the upload is not a PDF", code="not_a_pdf")
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        n_pages = len(reader.pages)
    except Exception as exc:  # pypdf raises a family of errors for broken files
        raise Unprocessable(f"the PDF cannot be parsed: {exc}", code="not_a_pdf") from exc
    if n_pages < 1:
        raise Unprocessable("the PDF has no pages", code="not_a_pdf")
    return reader


def _overlay_rgb(overlay_png: bytes) -> np.ndarray:
    from PIL import Image

    with Image.open(io.BytesIO(overlay_png)) as im:
        return np.asarray(im.convert("RGB"))


def pixel_probe(reader: Any, overlay_rgb: np.ndarray) -> dict[str, Any]:
    target_shape = tuple(overlay_rgb.shape)
    candidates: list[dict[str, Any]] = []
    errors: list[str] = []
    match: dict[str, Any] | None = None
    for page_index, page in enumerate(reader.pages):
        try:
            names = list(page.images.keys())
        except Exception as exc:
            errors.append(f"page {page_index + 1}: {exc}")
            continue
        for name in names:
            try:
                image = page.images[name].image
                arr = np.asarray(image.convert("RGB"))
            except Exception as exc:  # one broken image must not hide the others
                errors.append(f"page {page_index + 1} {name}: {exc}")
                continue
            entry: dict[str, Any] = {
                "page": page_index + 1,
                "xobject": str(name),
                "shape": list(arr.shape),
                "same_shape": tuple(arr.shape) == target_shape,
            }
            if entry["same_shape"]:
                diff = int(np.abs(arr.astype(np.int16) - overlay_rgb.astype(np.int16)).max())
                entry["max_abs_diff"] = diff
                entry["pixel_equal"] = diff <= PDF_PIXEL_MAX_ABS_DIFF
                if entry["pixel_equal"] and match is None:
                    match = entry
            candidates.append(entry)
    same_shape = [c for c in candidates if c["same_shape"]]
    if match is not None:
        reason = ""
    elif same_shape:
        reason = "overlay_drift"
    else:
        reason = "overlay_missing"
    return {
        "ok": match is not None,
        "reason": reason,
        "expected_shape": list(target_shape),
        "tolerance": PDF_PIXEL_MAX_ABS_DIFF,
        "match": match,
        "candidates": candidates,
        "min_abs_diff": min((c["max_abs_diff"] for c in same_shape), default=None),
        "errors": errors,
    }


def text_probe(reader: Any, names: list[str]) -> dict[str, Any]:
    pieces: list[str] = []
    errors: list[str] = []
    for page_index, page in enumerate(reader.pages):
        try:
            pieces.append(page.extract_text() or "")
        except Exception as exc:
            errors.append(f"page {page_index + 1}: {exc}")
    haystack = normalize_text("\n".join(pieces))
    results: list[dict[str, Any]] = []
    for name in names:
        runs = name_runs(name)
        if not runs:
            continue
        found = [{"text": run, "found": run in haystack} for run in runs]
        results.append({"name": name, "runs": found, "ok": all(r["found"] for r in found)})
    return {
        "ok": all(r["ok"] for r in results),
        "names": results,
        "n_missing": sum(1 for r in results if not r["ok"]),
        "text_chars": len(haystack),
        "errors": errors,
    }


def _font_names(resources: Any, seen: set[int], out: list[str], subtypes: set[str]) -> None:
    if resources is None:
        return
    try:
        resources = resources.get_object()
    except Exception:
        return
    if id(resources) in seen:
        return
    seen.add(id(resources))
    fonts = resources.get("/Font")
    if fonts is not None:
        for ref in fonts.get_object().values():
            font = ref.get_object()
            subtypes.add(str(font.get("/Subtype")))
            base = font.get("/BaseFont")
            out.append(
                str(base) if base is not None else f"<{font.get('/Subtype')} without BaseFont>"
            )
            for desc in font.get("/DescendantFonts") or []:
                base2 = desc.get_object().get("/BaseFont")
                if base2 is not None:
                    out.append(str(base2))
    xobjects = resources.get("/XObject")
    if xobjects is not None:
        for ref in xobjects.get_object().values():
            xobj = ref.get_object()
            if xobj.get("/Subtype") == "/Form":
                _font_names(xobj.get("/Resources"), seen, out, subtypes)


def font_probe(reader: Any) -> dict[str, Any]:
    names: list[str] = []
    subtypes: set[str] = set()
    seen: set[int] = set()
    errors: list[str] = []
    for page_index, page in enumerate(reader.pages):
        try:
            _font_names(page.get("/Resources"), seen, names, subtypes)
        except Exception as exc:  # a malformed resource dictionary is a verdict, not a 500
            errors.append(f"page {page_index + 1}: {type(exc).__name__}: {exc}")
    unique = sorted(set(names))
    return {
        "ok": any(PLEX_FONT_TOKEN in n for n in unique),
        "fonts": unique,
        "required_token": PLEX_FONT_TOKEN,
        # Chromium/Skia draws synthesized bold/italic glyphs as Type3 paths (visual-order text)
        "type3_present": "/Type3" in subtypes,
        "errors": errors,
    }


def finalize_pdf(
    pdf_bytes: bytes,
    *,
    overlay_png: bytes,
    overlay_name: str,
    session_json: bytes,
    report_model_json: bytes,
    names: list[str],
    require_text: bool = False,
    require_font: bool = False,
    metadata: dict[str, str] | None = None,
) -> tuple[bytes, dict[str, Any]]:
    """Probe the printed PDF, attach the evidence, verify it; returns (pdf, probe)."""
    from pypdf import PdfReader, PdfWriter

    reader = _open(pdf_bytes)
    overlay_rgb = _overlay_rgb(overlay_png)
    pixel = pixel_probe(reader, overlay_rgb)
    text = text_probe(reader, [n for n in names if n and n.strip()])
    fonts = font_probe(reader)

    attachments: dict[str, bytes] = {
        overlay_name: overlay_png,
        "session.json": session_json,
        "report_model.json": report_model_json,
    }
    attach: dict[str, Any] = {"ok": False, "reason": "", "files": {}}
    final_bytes = pdf_bytes
    try:
        writer = PdfWriter(clone_from=reader)
        for name, data in attachments.items():
            writer.add_attachment(name, data)
        info = {"/Producer": f"Nazeer Engine {ENGINE_VERSION}"}
        for key, value in (metadata or {}).items():
            info[key if key.startswith("/") else f"/{key}"] = str(value)
        writer.add_metadata(info)
        buffer = io.BytesIO()
        writer.write(buffer)
        candidate = buffer.getvalue()
        check = PdfReader(io.BytesIO(candidate))
        stored = check.attachments
        files: dict[str, Any] = {}
        all_ok = True
        for name, data in attachments.items():
            contents = stored.get(name) or []
            matches = [_sha(c) == _sha(data) for c in contents]
            files[name] = {"sha256": _sha(data), "bytes": len(data), "matches": any(matches)}
            all_ok = all_ok and any(matches)
        if all_ok:
            final_pixel = pixel_probe(check, overlay_rgb)
            if pixel["ok"] and not final_pixel["ok"]:
                all_ok = False
                attach["reason"] = "the sealed PDF no longer carries the overlay pixels"
            else:
                final_bytes = candidate
        else:
            attach["reason"] = "an attachment did not read back with the expected sha256"
        attach["ok"] = all_ok
        attach["files"] = files
    except Exception as exc:  # C3.7: keep the PDF, report why the attachments failed
        attach["ok"] = False
        attach["reason"] = f"{type(exc).__name__}: {exc}"

    hard: list[str] = []
    soft: list[str] = []
    if not pixel["ok"]:
        hard.append(pixel["reason"])
    if not text["ok"]:
        (hard if require_text else soft).append("text_probe_failed")
    if not fonts["ok"]:
        (hard if require_font else soft).append("font_probe_failed")
    if not attach["ok"]:
        soft.append("attachments_failed")
    hints: list[dict[str, str]] = []
    if not text["ok"] and fonts["type3_present"]:
        hints.append(
            {
                "code": "synthesized_face",
                "message": (
                    "a Type3 font is present: Chromium drew some text with a synthesized "
                    "(fake) bold or italic face, whose text layer comes out in visual order "
                    "and cannot be searched; embed every IBM Plex Sans Arabic weight and style "
                    "the print page uses (or print those names in the regular weight)"
                ),
            }
        )
    probe = {
        "verdict": "PASS" if not hard else "DRIFT",
        "hard_failures": hard,
        "soft_failures": soft,
        "hints": hints,
        "pixel": pixel,
        "text": text,
        "fonts": fonts,
        "attachments": attach,
        "attachments_ok": attach["ok"],
        "require_text": require_text,
        "require_font": require_font,
        "n_pages": len(reader.pages),
        "bytes_in": len(pdf_bytes),
        "sha256_in": _sha(pdf_bytes),
        "bytes_out": len(final_bytes),
        "sha256_out": _sha(final_bytes),
    }
    return final_bytes, probe
