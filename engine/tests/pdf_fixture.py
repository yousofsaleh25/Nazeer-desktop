"""Hand-built one-page PDFs for the probe tests (no reportlab, no Chromium).

The page embeds one RGB image XObject (FlateDecode, 8 bpc, DeviceRGB) exactly like a
Chromium-printed overlay, Latin text in Helvetica, and a dummy font resource whose
BaseFont carries the IBM Plex Sans Arabic subset name so the font probe has something to
find. Arabic text extraction is exercised by the ``realpdf`` tests, not here."""

from __future__ import annotations

import zlib

import numpy as np


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf(
    *,
    image_rgb: np.ndarray | None,
    texts: tuple[str, ...] | list[str] = (),
    plex_basefont: str | None = "ABCDEF+IBMPlexSansArabic-Regular",
    page_size: tuple[float, float] = (595.0, 842.0),
    image_box: tuple[float, float, float, float] | None = None,
) -> bytes:
    """Return PDF bytes. ``image_rgb`` is H×W×3 uint8 (or None for a page without image)."""
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
    image_obj = None
    if image_rgb is not None:
        arr = np.ascontiguousarray(image_rgb, dtype=np.uint8)
        h, w = arr.shape[:2]
        raw = zlib.compress(arr.tobytes(), 9)
        image_obj = add(
            (
                f"<< /Type /XObject /Subtype /Image /Width {w} /Height {h} "
                f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode "
                f"/Length {len(raw)} >>\nstream\n"
            ).encode()
            + raw
            + b"\nendstream"
        )
    content_parts: list[str] = []
    if image_obj is not None:
        if image_box is None:
            h, w = image_rgb.shape[:2]  # type: ignore[union-attr]
            scale = min((width - 40) / w, (height - 160) / h)
            draw_w, draw_h = w * scale, h * scale
            x0, y0 = 20.0, height - 100 - draw_h
        else:
            x0, y0, draw_w, draw_h = image_box
        content_parts.append(f"q {draw_w:.3f} 0 0 {draw_h:.3f} {x0:.3f} {y0:.3f} cm /Im1 Do Q")
    y = height - 40
    for text in texts:
        content_parts.append(f"BT /F1 12 Tf 30 {y:.1f} Td ({_escape(text)}) Tj ET")
        y -= 16
    content = "\n".join(content_parts).encode("latin-1", "replace")
    content_obj = add(f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"\nendstream")
    resources = f"/Font << /F1 {font_helv} 0 R"
    if font_plex is not None:
        resources += f" /F2 {font_plex} 0 R"
    resources += " >>"
    if image_obj is not None:
        resources += f" /XObject << /Im1 {image_obj} 0 R >>"
    page_obj_index = len(objects) + 1
    pages_obj_index = page_obj_index + 1
    add(
        (
            f"<< /Type /Page /Parent {pages_obj_index} 0 R /MediaBox [0 0 {width} {height}] "
            f"/Resources << {resources} >> /Contents {content_obj} 0 R >>"
        ).encode()
    )
    add(f"<< /Type /Pages /Kids [{page_obj_index} 0 R] /Count 1 >>".encode())
    catalog = add(f"<< /Type /Catalog /Pages {pages_obj_index} 0 R >>".encode())

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
