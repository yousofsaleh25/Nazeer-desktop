# D7 — Judging report is a PDF produced by Electron printToPDF; the engine is the single rendering authority for the overlay image and the evidence artefacts

Status: proposed 2026-10-10 — pending the half-day spike (Decision step 7). The operator
decided "PDF, not HTML"; the route was chosen by a three-advocate judge panel (read-only
research, 2026-10-10) and has not yet been confirmed by the operator.

## Context

Nazeer Desktop (Electron + Vite + React + TypeScript + Tailwind CSS app; local Python 3.11
FastAPI engine) must produce the judging report as a PDF. The report is bilingual AR/EN in
IBM Plex Sans Arabic, must be generated offline on a Windows camera laptop, and must preserve
the parent project's single-rendering-authority rule: the measurement overlay the judge
reviews must be the image embedded in the signed document (SHA-256 probe; parent README
§3.4; `overlay_renderer.py:1-13`). Measurement types are 2D distance, 3D distance, 2D curve,
3D curve (new) and angles; the measurement math is vendored from
`E:\camel_beauty\src\camel_beauty\four_view\measure.py`.

Verified facts that constrain the choice:

- The parent's only PDF code (`four_view_report.py:227-333`, reportlab) registers no
  TrueType font (no `registerFont`/`TTFont`/`pdfmetrics` anywhere under `src/`) and prints
  Arabic in Helvetica; reportlab is not installed in any venv on this machine.
- The only operator-approved report is the Chromium-rendered HTML template
  (`notebook_report_template.html`, 3,055,394 bytes, `lang="ar" dir="rtl"`, four
  `@font-face` Plex weights, `@media print` rules, `print-color-adjust: exact`, no `@page`
  rule); today's PDF path is "Open in browser → Print → Save as PDF" (`p4_report.py:2148`).
- Chromium's PDF backend embeds all fonts as glyph subsets (Skia pdftheory) and embeds
  images losslessly by default (`SkPDFDocument.h` `fEncodingQuality = 101`;
  `printing/common/metafile_utils.cc` `MakePdfDocument` never changes it).
- Electron `printToPDF` defaults are Letter, `printBackground=false`,
  `preferCSSPageSize=false` (content scaled to fit), 1 cm margins; no visibility requirement
  is documented.
- `overlay_renderer._ensure_locale_stack` runs `pip install` at runtime (lines 41-43) and
  `find_arabic_font_path` walks the parent repo root (`measure.py:605`) — both break offline
  and must be rewritten on vendoring.
- The template's load script sets `data-lang` from `localStorage || 'ar'` and the CSS hides
  the other language entirely (lines 101-102, 1456-1467).
- No PDF route can keep PNG file bytes inside the PDF container; the parent's byte-identity
  probe (D8 discipline) must be restated for PDF on every route.

## Options considered

Scoring axes (weights): arabic_rtl ×3, wysiwyg ×3, offline_packaging ×2, maintainability ×2,
effort ×1, licence_risk ×1 (max 60).

- **A.** The Electron app renders a React + Tailwind print template in a hidden
  `BrowserWindow` and calls `webContents.printToPDF`; the engine supplies `session.json` +
  `report_model.json` and renders the overlay PNG (vendored matplotlib + arabic_reshaper +
  python-bidi + IBM Plex TTF). **50/60.**
- **B.** The engine builds the PDF with reportlab (TTF registered) + arabic_reshaper +
  python-bidi; the app is a thin viewer. 44/60. Best packaging and maintainability; weakest
  Arabic typography (presentation forms, per-string bidi; reportlab calls its native RTL
  experimental); discards the approved template design.
- **C.** The engine renders the HTML template and converts it with Playwright headless
  Chromium, then pypdf post-processing. 44/60. Same fidelity as A; adds a second Chromium of
  a few hundred MB with no PyInstaller hook, subprocess constraints and version coupling;
  the CDP-hybrid variant exposes a local debugging port.

## Decision

Adopt Route A with grafts from B and C:

1. The engine is the single rendering authority for the overlay: `POST /sessions/{id}/finalize`
   renders `overlay.png` once (deterministic figsize/dpi, IBM Plex TTF from an engine asset
   dir, reshaper configured from the TTF, no runtime pip), writes `session.json` +
   `report_model.json` atomically and returns the overlay SHA-256. Finalize fails loudly if
   the font or locale stack is missing.
2. The app shows the engine PNG (hash re-computed with WebCrypto and compared; mismatch is a
   hard error) for approval, embeds the same bytes in `print.html` (Vite entry, React +
   Tailwind, `@page { size: A4; margin: 12mm }`, Plex woff2 `@font-face`, `print:`
   utilities), awaits `document.fonts.ready` and `img.decode()`, then calls
   `printToPDF({pageSize:'A4', printBackground:true, preferCSSPageSize:true, margins:0})`.
   Language, rubric variant and names are explicit inputs; nothing is read from
   `localStorage`.
3. The app POSTs the PDF bytes to `POST /sessions/{id}/report/finalize`; the engine (pypdf)
   attaches `overlay.png` and `session.json` byte-identical inside the PDF, stamps metadata
   and `library_versions`, runs the D8-for-PDF probe (attachment sha256 == disk PNG; decoded
   page image == PNG pixels; Arabic names present in the text layer; IBMPlexSansArabic
   subset present), writes `report.manifest.json`, and refuses to return the PDF on DRIFT.
4. The generated PDF is the final review surface shown in-app (bundled pdf.js); the live
   editing canvas is never an approval surface.
5. Measurement math vendored with `curve_length_3d` added (sum of `distance_3d` over
   backprojected control points; per-point depth provenance per D8) and
   `CurveMeasurement.measurement_type = "curve_3d"`; adversarial tests that `curve_2d` has
   no depth term and `curve_3d` changes with depth.
6. Packaging: electron-builder NSIS; PyInstaller one-dir engine (fonts, logos, `best.pt`
   hash-checked, local wheelhouse) as `extraResources`; `--export <session_dir>` headless
   re-export mode; offline smoke on a clean Windows account with Wi-Fi off before claiming
   integration-tested.
7. A half-day spike precedes implementation: print the parent template from a hidden
   Electron window and inspect fonts, text order and image pixels; its result is appended to
   this record.

## Consequences

Positive: HarfBuzz-grade Arabic shaping and bidi with embedded Plex subsets; zero new
runtime binaries (Chromium already shipped); the Tailwind requirement is met natively; the
approved template design is carried forward; evidence artefacts (overlay, session, manifest,
probes) stay Python-owned and pytest-covered; one renderer, one PNG, one hash, two consumers,
one verifier.

Negative / accepted: the PDF cannot be produced without the Electron binary (mitigated by
the `--export` CLI mode); one Playwright-Electron e2e is needed and Playwright's Electron
support is experimental; PDF bytes change with Electron/Chromium upgrades (tests assert
content, not bytes); two languages share one report, mitigated by a schema-versioned
`report_model.json` validated on both sides; python-bidi (LGPL), IBM Plex (OFL-1.1) and
Ultralytics (AGPL, D6) need one counsel pass; no PDF/A or PDF/UA promise.

## Open operator questions

- Signatures: wet ink on the printed page (parent practice, assumed here) or in-app capture
  rasterised into the PDF before export?
- One PDF per language, or a single bilingual PDF — and which is the legally signed one?
- Rubric variant per session (Mjaheem / Maghateer); scores entered in-app (then in
  `report_model.json`) or on paper?
- Does the council require PDF/A, PDF/UA, or accept embedded files?
- Must PDFs ever be regenerated without the Electron app (batch, disputes, CI)? If yes beyond
  `--export`, Route C's engine-side converter becomes relevant.
- Licence posture (closed-source?) — see D6.
- Is the half-day spike acceptable before this record is locked?

## Engine side (implemented 2026-10-11)

Status: the engine half is implemented (`overlay.py`, `report_model.py`, `pdf_finalize.py`,
`session_store.finalize / attach_report`, `POST /sessions/{id}/finalize`,
`POST /sessions/{id}/report`) and integration-tested against **headless Microsoft Edge**
(the same Chromium print path as `printToPDF`) on a real bag-004 session: pixel probe max
|Δ| = 0 on the 1280×840 overlay, the Plex subset found, every Arabic and English name found
in the text layer, three attachments read back by sha256. Printing from Electron itself is
still untested — the app does not exist yet.

- Overlay: 1280×(H + 120) px at dpi 100 (a 120 px bilingual footer: Z_ref, ground row,
  "N of M points snapped"); hollow KNN markers with leader lines; red ground line; labels
  de-overlapped. matplotlib 3.11 lays text out with libraqm, so labels go in as logical
  Unicode with LRM + FSI…PDI isolates; `arabic_reshaper` + `python-bidi` only run when
  libraqm is missing (B36). Font = the pinned Plex Regular TTF from `engine/nazeer_engine/
  assets/fonts/` (sha256-checked); a missing font or locale stack is a 500
  `arabic_stack_missing`, never a fallback face.
- Upload: the raw PDF bytes (`Content-Type: application/pdf`, ≤ 64 MiB) with
  `X-Overlay-Sha256` (and `X-Overlay-Version`) **and** `X-Report-Model-Sha256` — the
  report model the page was rendered from. Every finalize and every *changed* report-input
  PATCH writes a new `report_model_v<M>.json` (never rewritten in place); a page printed
  from an older model is refused (409 `report_model_mismatch`), so the sealed PDF and its
  attached `report_model.json` always agree (review 2026-10-11, B40). The pixel probe is
  always hard; the text and font probes are hard by default (`require_text` /
  `require_font` default true, B39) and can be relaxed per upload; attachment failures are
  soft (C3.7).
- **Print-page font rule (B38, measured):** every operator string the probe checks
  (`SessionView.required_report_texts`: measurement names, judge / council / event, camel
  id) must be drawn in an **embedded** face. With only Plex Regular embedded, a bold
  heading is a synthesized bold that Chromium emits as Type3 glyphs whose text extracts in
  visual order — the names become unsearchable and the probe fails (`text_probe_failed`,
  hint `synthesized_face`, `fonts.type3_present`). Either embed every Plex weight the page
  uses (`@font-face` per weight) or keep those strings in the regular weight.
