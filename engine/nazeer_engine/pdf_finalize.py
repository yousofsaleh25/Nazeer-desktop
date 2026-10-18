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

The comparison report (D12 F2.9, ``finalize_comparison_pdf``) is probed the same way with three
differences: the pixel probe is **ordered** (member k's overlay on a page after member k−1's,
and nowhere outside its own section), the text probe also checks each member's names and camel
id within that member's pages, and the attachments carry every member's evidence plus the
comparison model.
"""

from __future__ import annotations

import hashlib
import io
import re
import time
import unicodedata
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
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


def page_texts(reader: Any) -> tuple[list[str], list[str]]:
    """Each page's text layer, extracted once (raw; normalise per use), and the errors."""
    pieces: list[str] = []
    errors: list[str] = []
    for page_index, page in enumerate(reader.pages):
        try:
            pieces.append(page.extract_text() or "")
        except Exception as exc:
            pieces.append("")
            errors.append(f"page {page_index + 1}: {exc}")
    return pieces, errors


def _match_names(names: Sequence[str], haystack: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for name in names:
        runs = name_runs(name)
        if not runs:
            continue
        found = [{"text": run, "found": run in haystack} for run in runs]
        results.append({"name": name, "runs": found, "ok": all(r["found"] for r in found)})
    return results


def text_probe(reader: Any, names: list[str]) -> dict[str, Any]:
    pieces, errors = page_texts(reader)
    # normalised page by page (which drops all whitespace), then joined with a newline that no
    # run contains: a name never matches across a page boundary
    haystack = "\n".join(normalize_text(p) for p in pieces)
    results = _match_names(names, haystack)
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

    def still_carries(check: Any) -> bool:
        return not pixel["ok"] or bool(pixel_probe(check, overlay_rgb)["ok"])

    final_bytes, attach = _seal(reader, pdf_bytes, attachments, metadata, still_carries)

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


def _seal(
    reader: Any,
    pdf_bytes: bytes,
    attachments: dict[str, bytes],
    metadata: dict[str, str] | None,
    still_carries: Callable[[Any], bool],
) -> tuple[bytes, dict[str, Any]]:
    """Attach the evidence, write, read every attachment back by SHA-256 and check that the
    written file still carries the approved pixels; on any failure keep the printed PDF and
    say why (C3.7). Returns (bytes to store, the attachments verdict)."""
    from pypdf import PdfReader, PdfWriter

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
            expected = _sha(data)
            contents = stored.get(name) or []
            matches = any(_sha(c) == expected for c in contents)
            files[name] = {"sha256": expected, "bytes": len(data), "matches": matches}
            all_ok = all_ok and matches
        if not all_ok:
            attach["reason"] = "an attachment did not read back with the expected sha256"
        elif not still_carries(check):
            all_ok = False
            attach["reason"] = "the sealed PDF no longer carries the overlay pixels"
        else:
            final_bytes = candidate
        attach["ok"] = all_ok
        attach["files"] = files
    except Exception as exc:  # C3.7: keep the PDF, report why the attachments failed
        attach["ok"] = False
        attach["reason"] = f"{type(exc).__name__}: {exc}"
    return final_bytes, attach


# ----- the comparison report (D12 F2.9) ---------------------------------------------------------


@dataclass(frozen=True)
class MemberEvidence:
    """One comparison member as the seal sees it: its approved overlay, the files attached
    with it, and the texts that must appear within its own section."""

    position: int
    session_id: str
    overlay_png: bytes
    overlay_name: str
    session_json: bytes
    report_model_json: bytes
    report_model_name: str
    texts: tuple[str, ...]

    def prefix(self) -> str:
        return f"m{self.position:02d}_{self.session_id}_"


def _rgb_key(arr: np.ndarray) -> str:
    """SHA-256 of an image's RGB samples and shape: equal keys = |Δ| 0 (the tolerance is 0)."""
    digest = hashlib.sha256(f"{arr.shape[0]}x{arr.shape[1]}x{arr.shape[2]}:".encode())
    digest.update(np.ascontiguousarray(arr, dtype=np.uint8).tobytes())
    return digest.hexdigest()


def _image_xobjects(
    holder: Any, ancestors: tuple[str, ...] = (), seen: set[int] | None = None
) -> Iterator[tuple[str | list[str], Any]]:
    """(key, image XObject) for every image a page draws, through Form XObjects; the key is
    the one ``page.images[...]`` takes. Inline images are not listed (an overlay is never one)."""
    seen = set() if seen is None else seen
    resources = holder.get("/Resources")
    if resources is None:
        return
    resources = resources.get_object()
    xobjects = resources.get("/XObject")
    if xobjects is None:
        return
    xobjects = xobjects.get_object()
    for name in xobjects:
        xobj = xobjects[name].get_object()
        subtype = xobj.get("/Subtype")
        if subtype == "/Image":
            yield (name if not ancestors else [*ancestors, name]), xobj
        elif subtype == "/Form" and id(xobj) not in seen:
            seen.add(id(xobj))
            yield from _image_xobjects(xobj, (*ancestors, name), seen)


def _key_text(key: str | list[str]) -> str:
    return key if isinstance(key, str) else "/".join(k.lstrip("/") for k in key)


def _xobject_at(page: Any, key: str | list[str]) -> Any:
    """The image XObject ``key`` names on ``page`` (through its Form XObjects), undecoded."""
    holder = page
    for name in [key] if isinstance(key, str) else key:
        holder = holder["/Resources"].get_object()["/XObject"].get_object()[name].get_object()
    return holder


def _describe(value: Any, depth: int = 0) -> str:
    """A PDF value with its references resolved (a written file renumbers its objects: Chromium's
    ``[/ICCBased 7 0 R]`` must compare by the profile's bytes, not by the object number)."""
    from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject, StreamObject

    if depth > 8:
        return "…"
    if isinstance(value, IndirectObject):
        value = value.get_object()
    if isinstance(value, StreamObject):
        return "stream:" + _sha(value.get_data())
    if isinstance(value, ArrayObject):
        return "[" + ",".join(_describe(v, depth + 1) for v in value) + "]"
    if isinstance(value, DictionaryObject):
        return "{" + ",".join(f"{k}:{_describe(value[k], depth + 1)}" for k in sorted(value)) + "}"
    return str(value)


def _stream_fingerprint(xobj: Any) -> str:
    """The decoded samples of an image XObject (and of its soft mask) with its geometry: the
    same fingerprint before and after attaching = the same pixels, without a PIL decode."""
    digest = hashlib.sha256()
    for key in ("/Width", "/Height", "/BitsPerComponent", "/ColorSpace", "/Decode"):
        digest.update(f"{key}={_describe(xobj.get(key))};".encode())
    digest.update(xobj.get_data())
    smask = xobj.get("/SMask")
    if smask is not None:
        digest.update(b"smask:" + _stream_fingerprint(smask.get_object()).encode())
    return digest.hexdigest()


def ordered_pixel_probe(reader: Any, overlays: Sequence[np.ndarray]) -> dict[str, Any]:
    """D12 F2.9: member k's overlay (``overlays[k-1]``) must be drawn, unchanged, on exactly one
    page, after member k−1's (no thumbnail elsewhere, not split by a page break). Image sizes are
    read from the XObject dictionaries first; only images of an overlay's size are decoded, each
    once, and matched by the SHA-256 of their RGB samples."""
    expected = [(tuple(a.shape), _rgb_key(a)) for a in overlays]
    sizes = {(shape[1], shape[0]) for shape, _ in expected}
    images: list[dict[str, Any]] = []
    keys: dict[int, tuple[int, str | list[str]]] = {}  # images[] index -> (page index, key)
    decoded: dict[Any, str] = {}
    errors: list[str] = []
    for page_index, page in enumerate(reader.pages):
        try:
            found = list(_image_xobjects(page))
        except Exception as exc:  # a malformed page is a verdict, not a 500
            errors.append(f"page {page_index + 1}: {type(exc).__name__}: {exc}")
            continue
        for key, xobj in found:
            try:
                width, height = int(xobj["/Width"]), int(xobj["/Height"])
            except Exception as exc:
                errors.append(f"page {page_index + 1} {_key_text(key)}: {exc}")
                continue
            entry: dict[str, Any] = {
                "page": page_index + 1,
                "xobject": _key_text(key),
                "width": width,
                "height": height,
                "rgb_sha256": None,
            }
            if (width, height) in sizes:
                ref = xobj.indirect_reference
                ref_key = (ref.idnum, ref.generation) if ref is not None else None
                rgb_sha = decoded.get(ref_key) if ref_key is not None else None
                if rgb_sha is None:
                    try:
                        arr = np.asarray(page.images[key].image.convert("RGB"))
                    except Exception as exc:  # one broken image must not hide the others
                        errors.append(f"page {page_index + 1} {_key_text(key)}: {exc}")
                        continue
                    rgb_sha = _rgb_key(arr)
                    if ref_key is not None:
                        decoded[ref_key] = rgb_sha
                entry["rgb_sha256"] = rgb_sha
            keys[len(images)] = (page_index, key)
            images.append(entry)

    hits = [
        sorted({e["page"] for e in images if e["rgb_sha256"] == rgb_sha}) for _, rgb_sha in expected
    ]
    pages: list[int | None] = []
    previous = 0
    for member_hits in hits:
        after = [p for p in member_hits if p > previous]
        pages.append(after[0] if after else None)
        if after:
            previous = after[0]
    members: list[dict[str, Any]] = []
    matched: list[tuple[int, str | list[str]] | None] = []
    own = {rgb_sha for _, rgb_sha in expected}  # an image of another camel is not a drift
    for index, (shape, rgb_sha) in enumerate(expected):
        after_page = _previous(pages, index)
        strangers = [
            i
            for i, e in enumerate(images)
            if e["rgb_sha256"] is not None
            and e["rgb_sha256"] not in own
            and e["page"] > after_page
            and (e["width"], e["height"]) == (shape[1], shape[0])
        ]
        page = pages[index]
        entry = {
            "position": index + 1,
            "ok": False,
            "reason": "",
            "page": page,
            "pages": hits[index],
            "expected_shape": list(shape),
            "rgb_sha256": rgb_sha,
            "max_abs_diff": None,
        }
        match = None
        if page is not None:
            if len(hits[index]) > 1:  # a thumbnail elsewhere, or the image split by a page break
                reason = "overlay_out_of_place"
            else:
                reason = ""
                match = next(
                    i
                    for i, e in enumerate(images)
                    if e["page"] == page and e["rgb_sha256"] == rgb_sha
                )
                entry.update({"ok": True, "max_abs_diff": 0, "xobject": images[match]["xobject"]})
        elif hits[index]:
            reason = "overlay_out_of_place"  # drawn, but not after the previous camel's image
        elif strangers:
            reason = "overlay_drift"
            entry["max_abs_diff"] = _closest_diff(reader, strangers, keys, overlays[index])
            entry["drift_pages"] = sorted({images[i]["page"] for i in strangers})
        else:
            reason = "overlay_missing"
        entry["reason"] = reason
        members.append(entry)
        matched.append(None if match is None else keys[match])
    reasons = [m["reason"] for m in members if m["reason"]]
    return {
        "ok": not reasons,
        "reasons": list(dict.fromkeys(reasons)),
        "tolerance": PDF_PIXEL_MAX_ABS_DIFF,
        "members": members,
        "images": images,
        "n_decoded": len(decoded),
        "errors": errors,
        "_matched": matched,  # dropped from the public probe (page index and pypdf key)
    }


def _previous(pages: Sequence[int | None], index: int) -> int:
    earlier = [p for p in pages[:index] if p is not None]
    return earlier[-1] if earlier else 0


def _closest_diff(
    reader: Any,
    candidates: Sequence[int],
    keys: dict[int, tuple[int, str | list[str]]],
    overlay: np.ndarray,
    limit: int = 40,
) -> int | None:
    """Diagnostics for a drift: the smallest max |Δ| among the same-size images that are no
    camel's (re-decoded here: the happy path never keeps decoded pixels)."""
    best: int | None = None
    for index in candidates[:limit]:
        page_index, key = keys[index]
        try:
            arr = np.asarray(reader.pages[page_index].images[key].image.convert("RGB"))
        except Exception:
            continue
        if arr.shape != overlay.shape:
            continue
        diff = int(np.abs(arr.astype(np.int16) - overlay.astype(np.int16)).max())
        best = diff if best is None else min(best, diff)
    return best


def comparison_text_probe(
    pieces: Sequence[str],
    required: Sequence[str],
    member_texts: Sequence[Sequence[str]],
    sections: Sequence[tuple[int, int] | None],
) -> dict[str, Any]:
    """Every required text in the document, and each member's names and camel id within its
    own pages (``sections[k]`` = 1-based [first, last] pages, None when its overlay was not
    found — that member is then left to the pixel verdict)."""
    normalized = [normalize_text(p) for p in pieces]
    # pages joined with a newline, which no run contains: a name never matches across pages
    document = _match_names([n for n in required if n and n.strip()], "\n".join(normalized))
    members: list[dict[str, Any]] = []
    for index, texts in enumerate(member_texts):
        section = sections[index]
        if section is None:
            members.append(
                {"position": index + 1, "checked": False, "pages": None, "ok": False, "names": []}
            )
            continue
        first, last = section
        haystack = "\n".join(normalized[first - 1 : last])
        results = _match_names([t for t in texts if t and t.strip()], haystack)
        members.append(
            {
                "position": index + 1,
                "checked": True,
                "pages": [first, last],
                "ok": all(r["ok"] for r in results),
                "names": results,
            }
        )
    doc_ok = all(r["ok"] for r in document)
    return {
        "ok": doc_ok and all(m["ok"] for m in members if m["checked"]),
        "names": document,
        "n_missing": sum(1 for r in document if not r["ok"]),
        "members": members,
        "n_members_missing": sum(1 for m in members if m["checked"] and not m["ok"]),
        "text_chars": sum(len(p) for p in normalized),
    }


def finalize_comparison_pdf(
    pdf_bytes: bytes,
    *,
    members: Sequence[MemberEvidence],
    model_name: str,
    model_json: bytes,
    required: Sequence[str],
    require_text: bool = True,
    require_font: bool = True,
    metadata: dict[str, str] | None = None,
) -> tuple[bytes, dict[str, Any]]:
    """Probe and seal the printed comparison (D12 F2.9); returns (pdf, probe). Hard: the ordered
    pixel probe, and (by default) the text and font probes; soft: the attachments (C3.7)."""
    timings: dict[str, float] = {}
    started = clock = time.perf_counter()

    def lap(name: str) -> None:
        nonlocal clock
        now = time.perf_counter()
        timings[name] = round((now - clock) * 1000.0, 1)
        clock = now

    reader = _open(pdf_bytes)
    n_pages = len(reader.pages)
    lap("open")
    overlays = [_overlay_rgb(m.overlay_png) for m in members]
    pixel = ordered_pixel_probe(reader, overlays)
    matched = pixel.pop("_matched")
    del overlays
    lap("pixel")
    pieces, text_errors = page_texts(reader)
    pages = [m["page"] for m in pixel["members"]]
    sections: list[tuple[int, int] | None] = []
    for index, page in enumerate(pages):
        later = [p for p in pages[index + 1 :] if p is not None]
        sections.append(None if page is None else (page, (later[0] - 1) if later else n_pages))
    text = comparison_text_probe(pieces, required, [m.texts for m in members], sections)
    text["errors"] = text_errors
    lap("text")
    fonts = font_probe(reader)
    lap("fonts")

    attachments: dict[str, bytes] = {}
    for m in members:
        attachments[m.prefix() + m.overlay_name] = m.overlay_png
        attachments[m.prefix() + "session.json"] = m.session_json
        attachments[m.prefix() + m.report_model_name] = m.report_model_json
    attachments[model_name] = model_json
    before = {
        i: _stream_fingerprint(_xobject_at(reader.pages[ref[0]], ref[1]))
        for i, ref in enumerate(matched)
        if ref is not None
    }

    def still_carries(check: Any) -> bool:
        return all(
            _stream_fingerprint(_xobject_at(check.pages[ref[0]], ref[1])) == before[i]
            for i, ref in enumerate(matched)
            if ref is not None
        )

    final_bytes, attach = _seal(reader, pdf_bytes, attachments, metadata, still_carries)
    lap("attach")

    hard: list[str] = list(pixel["reasons"])
    soft: list[str] = []
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
                    "a Type3 font is present: some text was drawn with a synthesized bold or "
                    "italic face, whose text layer cannot be searched; print every operator "
                    "text in an embedded IBM Plex Sans Arabic weight"
                ),
            }
        )
    timings["total"] = round((time.perf_counter() - started) * 1000.0, 1)
    probe = {
        "kind": "comparison",
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
        "n_pages": n_pages,
        "n_members": len(members),
        "bytes_in": len(pdf_bytes),
        "sha256_in": _sha(pdf_bytes),
        "bytes_out": len(final_bytes),
        "sha256_out": _sha(final_bytes),
        "timings_ms": timings,
    }
    return final_bytes, probe
