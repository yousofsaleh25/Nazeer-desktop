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


def comparison_page(
    model: dict, overlays: dict[str, bytes], *, lang: str = "ar", block: int = 6
) -> str:
    """A stand-in for the app's comparison print page (D12 F2.3, F2.11; the real one is Stage 5):
    the cover, the comparison table in blocks of ``block`` camel columns, one section per camel
    starting on a new page (heading and its approved overlay together, the frame lines, its
    measurements, the snapped and counts lines, its sources), the wells, the disclaimers. Every
    text comes from the comparison model; the overlay bytes are embedded unchanged."""
    e = html.escape
    font_b64 = base64.b64encode(assets.font_path().read_bytes()).decode("ascii")
    static = model["static"]

    def t(label: dict | None) -> str:
        return "" if not label else e(str(label.get(lang) or ""))

    def op(text: str) -> str:  # operator text: its own direction
        return f'<bdi dir="auto">{e(text)}</bdi>'

    cover = model["cover"]
    members = model["members"]
    cover_rows = "".join(
        f"<tr><th>{t(static['cover_rows'][key])}</th><td>{op(cover.get(key) or '')}</td></tr>"
        for key in ("title", "event", "judge", "council")
    )
    camel_rows = "".join(
        f"<tr><td>{m['position']}</td><td>{op(m['camel_id'])}</td><td>{e(m['session_id'])}</td>"
        f"<td>{t(m['texts']['source'])}</td></tr>"
        for m in members
    )
    tables = []
    for start in range(0, len(members), block):
        chunk = list(range(start, min(start + block, len(members))))
        head = "".join(f"<th>{t(members[i]['texts']['column'])}</th>" for i in chunk)
        body = []
        for row in model["rows"]:
            cells = []
            for i in chunk:
                cell = row["cells"][i]
                if cell is None:
                    cells.append(f"<td>{t(static['missing'])}</td>")
                    continue
                value = t(static["rejected"]) if cell["rejected"] else t(cell["value_text"])
                extra = " ".join(
                    t(cell[key]) for key in ("uncertainty_text", "depth_note") if cell.get(key)
                )
                cells.append(f"<td>{value}<br><small>{extra}</small></td>")
            occurrence = f" {t(row['occurrence_text'])}" if row.get("occurrence_text") else ""
            body.append(
                f"<tr><td>{op(row['name_text'][lang] or row['name'])}{occurrence}</td>"
                f"<td>{t(row['kind_label'])}</td>{''.join(cells)}</tr>"
            )
        tables.append(
            f"<table class='cmp'><thead><tr><th>{t(static['columns']['measurement'])}</th>"
            f"<th>{t(static['columns']['kind'])}</th>{head}</tr></thead>"
            f"<tbody>{''.join(body)}</tbody></table>"
        )
    sections = []
    for m in members:
        png_b64 = base64.b64encode(overlays[m["session_id"]]).decode("ascii")
        rows = "".join(
            f"<tr><td>{op(r['name'])}</td><td>{t(r['kind_label'])}</td>"
            f"<td>{t(static['rejected']) if r['rejected'] else t(r['value_text'])}</td></tr>"
            for r in m["rows"]
        )
        prov = "".join(f"<div>{t(v)}</div>" for v in m["texts"]["provenance"].values())
        sections.append(
            f"<section class='member'><div class='keep'><h2>{t(m['texts']['heading'])}</h2>"
            f"<img data-role='overlay' src='data:image/png;base64,{png_b64}'></div>"
            f"<div>{t(m['frame']['texts']['z_ref'])}</div>"
            f"<div>{t(m['frame']['texts']['ground'])}</div>"
            f"<table class='rows'>{rows}</table>"
            f"<div>{t(m['summary']['snapped_text'])}</div>"
            f"<div>{t(m['summary']['counts_text'])}</div>{prov}</section>"
        )
    wells = "".join(
        f"<div class='well'><div>{e(w[lang])}</div><div>{op(w['name'])}</div></div>"
        for w in model["signature_wells"]
    )
    disclaimers = "".join(f"<p>{t(d)}</p>" for d in static["disclaimers"])
    direction = "rtl" if lang == "ar" else "ltr"
    return f"""<!doctype html><html lang="{lang}" dir="{direction}"><head><meta charset="utf-8">
<style>
@font-face {{ font-family: Plex; src: url(data:font/ttf;base64,{font_b64}) format('truetype'); }}
@page {{ size: A4; margin: 12mm; }}
* {{ font-weight: 400; }}
body {{ font-family: Plex; font-size: 9pt; print-color-adjust: exact;
  -webkit-print-color-adjust: exact; }}
h1, h2 {{ font-weight: 400; }}
table {{ width: 100%; border-collapse: collapse; }}
table.cmp {{ table-layout: fixed; overflow-wrap: anywhere; break-before: page; }}
td, th {{ border: 1px solid #999; padding: 2px; }}
tr {{ break-inside: avoid; }}
section.member {{ break-before: page; }}
.keep {{ break-inside: avoid; }}
img {{ width: 100%; }}
.well {{ break-inside: avoid; border: 1px solid #000; height: 25mm; margin: 4mm 0; }}
</style></head><body>
<h1>{t(cover["title_text"])}</h1><table>{cover_rows}</table>
<h2>{t(static["headings"]["members"])}</h2><table>{camel_rows}</table>
{"".join(tables)}{"".join(sections)}
<section class="member"><h2>{t(static["headings"]["signatures"])}</h2>{wells}{disclaimers}</section>
</body></html>"""


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
