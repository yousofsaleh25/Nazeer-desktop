"""Headless Microsoft Edge as the stand-in for Electron's ``printToPDF`` (same Chromium
printer, same Skia PDF backend). Used only by the opt-in ``realpdf`` / ``realbag`` tests."""

from __future__ import annotations

import base64
import html
import os
import shutil
import subprocess
from pathlib import Path

from nazeer_engine import assets

EDGE_CANDIDATES = (
    Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"))
    / "Microsoft/Edge/Application/msedge.exe",
    Path(os.environ.get("PROGRAMFILES", r"C:\Program Files"))
    / "Microsoft/Edge/Application/msedge.exe",
)


def find_edge() -> Path | None:
    for candidate in EDGE_CANDIDATES:
        if candidate.is_file():
            return candidate
    found = shutil.which("msedge")
    return Path(found) if found else None


def report_page(
    png: bytes, rows: list[tuple[str, str]], *, title: str, heading_weight: str = "normal"
) -> str:
    """A minimal print page shaped like the app's: Plex @font-face, A4, the overlay PNG bytes
    embedded unchanged, a measurement table. Only the Regular face is embedded, so headings
    stay in the regular weight: a bold heading would be a synthesized face (see the
    ``synthesized_face`` probe hint)."""
    font_b64 = base64.b64encode(assets.font_path().read_bytes()).decode("ascii")
    png_b64 = base64.b64encode(png).decode("ascii")
    body = "".join(
        f"<tr><td>{html.escape(name)}</td><td>{html.escape(value)}</td></tr>"
        for name, value in rows
    )
    return f"""<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>
@font-face {{ font-family: Plex; src: url(data:font/ttf;base64,{font_b64}) format('truetype'); }}
@page {{ size: A4; margin: 12mm; }}
body {{ font-family: Plex; print-color-adjust: exact; -webkit-print-color-adjust: exact; }}
h1 {{ font-weight: {heading_weight}; }}
img {{ width: 100%; }}
</style></head><body>
<h1>{html.escape(title)}</h1>
<img src="data:image/png;base64,{png_b64}">
<table>{body}</table></body></html>"""


def print_to_pdf(page_html: str, workdir: Path, *, timeout: float = 180) -> bytes | None:
    """Print ``page_html`` with headless Edge; None when Edge is absent or printed nothing."""
    edge = find_edge()
    if edge is None:
        return None
    workdir.mkdir(parents=True, exist_ok=True)
    page = workdir / "page.html"
    page.write_text(page_html, encoding="utf-8")
    out = workdir / "printed.pdf"
    subprocess.run(
        [
            str(edge),
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            f"--user-data-dir={workdir / 'profile'}",
            "--no-pdf-header-footer",
            "--virtual-time-budget=5000",
            f"--print-to-pdf={out}",
            page.as_uri(),
        ],
        check=False,
        capture_output=True,
        timeout=timeout,
    )
    return out.read_bytes() if out.is_file() else None
