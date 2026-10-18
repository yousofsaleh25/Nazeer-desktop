"""Hand-built PDFs for the probe tests (no reportlab, no Chromium).

Each page embeds RGB image XObjects (FlateDecode, 8 bpc, DeviceRGB) exactly like a
Chromium-printed overlay, Latin text in Helvetica, and a dummy font resource whose
BaseFont carries the IBM Plex Sans Arabic subset name so the font probe has something to
find. Arabic text extraction is exercised by the ``realpdf`` tests, not here."""

from __future__ import annotations

import zlib
from dataclasses import dataclass, field

import numpy as np


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


@dataclass
class Page:
    """One page: images drawn top to bottom, then text lines. The same array object on two
    pages becomes one shared image XObject (as Chromium writes a repeated image)."""

    images: list[np.ndarray] = field(default_factory=list)
    texts: list[str] = field(default_factory=list)
    image_box: tuple[float, float, float, float] | None = None


def build_document(
    pages: list[Page],
    *,
    plex_basefont: str | None = "ABCDEF+IBMPlexSansArabic-Regular",
    page_size: tuple[float, float] = (595.0, 842.0),
) -> bytes:
    """Return the PDF bytes of ``pages``."""
    width, height = page_size
    objects: list[bytes] = []

    def add(obj: bytes) -> int:
        objects.append(obj)
        return len(objects)

    font_helv = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    font_plex = None
    if plex_basefont:
        font_plex = add(
            f"<< /Type /Font /Subtype /TrueType /BaseFont /{plex_basefont} "
            f"/FirstChar 32 /LastChar 32 /Widths [500] /Encoding /WinAnsiEncoding >>".encode()
        )
    image_objects: dict[int, int] = {}

    def image_object(image: np.ndarray) -> int:
        if id(image) in image_objects:
            return image_objects[id(image)]
        arr = np.ascontiguousarray(image, dtype=np.uint8)
        h, w = arr.shape[:2]
        raw = zlib.compress(arr.tobytes(), 6)
        index = add(
            (
                f"<< /Type /XObject /Subtype /Image /Width {w} /Height {h} "
                f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode "
                f"/Length {len(raw)} >>\nstream\n"
            ).encode()
            + raw
            + b"\nendstream"
        )
        image_objects[id(image)] = index
        return index

    page_indices: list[int] = []
    n_pages = len(pages)
    # objects are numbered in order of creation; the pages' /Parent is filled in at the end
    pending: list[tuple[int, bytes]] = []
    for page in pages:
        refs = [image_object(img) for img in page.images]
        content_parts: list[str] = []
        top = height - 100
        for n, img in enumerate(page.images):
            h, w = img.shape[:2]
            if page.image_box is not None and n == 0:
                x0, y0, draw_w, draw_h = page.image_box
            else:
                scale = min((width - 40) / w, (height - 160) / h / max(1, len(page.images)))
                draw_w, draw_h = w * scale, h * scale
                x0, y0 = 20.0, top - draw_h
                top = y0 - 10
            content_parts.append(
                f"q {draw_w:.3f} 0 0 {draw_h:.3f} {x0:.3f} {y0:.3f} cm /Im{n} Do Q"
            )
        y = height - 40
        for text in page.texts:
            content_parts.append(f"BT /F1 12 Tf 30 {y:.1f} Td ({_escape(text)}) Tj ET")
            y -= 16
        content = "\n".join(content_parts).encode("latin-1", "replace")
        content_obj = add(
            f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"\nendstream"
        )
        resources = f"/Font << /F1 {font_helv} 0 R"
        if font_plex is not None:
            resources += f" /F2 {font_plex} 0 R"
        resources += " >>"
        if refs:
            resources += (
                " /XObject << " + " ".join(f"/Im{n} {r} 0 R" for n, r in enumerate(refs)) + " >>"
            )
        page_index = add(b"")  # placeholder, filled once the Pages number is known
        pending.append(
            (
                page_index,
                (
                    f"<< /Type /Page /Parent {{pages}} 0 R /MediaBox [0 0 {width} {height}] "
                    f"/Resources << {resources} >> /Contents {content_obj} 0 R >>"
                ).encode(),
            )
        )
        page_indices.append(page_index)
    pages_index = add(b"")
    kids = " ".join(f"{i} 0 R" for i in page_indices)
    objects[pages_index - 1] = f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode()
    for index, body in pending:
        objects[index - 1] = body.replace(b"{pages}", str(pages_index).encode())
    catalog = add(f"<< /Type /Catalog /Pages {pages_index} 0 R >>".encode())

    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets: list[int] = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n"
    ).encode()
    return bytes(out)


def build_pdf(
    *,
    image_rgb: np.ndarray | None,
    texts: tuple[str, ...] | list[str] = (),
    plex_basefont: str | None = "ABCDEF+IBMPlexSansArabic-Regular",
    page_size: tuple[float, float] = (595.0, 842.0),
    image_box: tuple[float, float, float, float] | None = None,
) -> bytes:
    """A one-page PDF. ``image_rgb`` is H×W×3 uint8 (or None for a page without image)."""
    page = Page(
        images=[] if image_rgb is None else [image_rgb], texts=list(texts), image_box=image_box
    )
    return build_document([page], plex_basefont=plex_basefont, page_size=page_size)
