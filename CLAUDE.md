# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Nazeer Desktop** (نَظِيرْ) — non-contact camel body measurement for Mzayen camel-beauty
judging as a standalone desktop product: an **Electron + React + React-Redux + TypeScript + Tailwind
CSS app** (`app/`, built with Vite) talking to a local **Python 3.11 FastAPI engine**
(`engine/`). Runs offline on the Windows camera laptop: no CDN, no font fetch, no pip at
runtime.

End-user flow (operator decision 2026-10-10):

1. Search for / open a D455 `.bag` file directly.
2. The engine walks the bag and proposes the best frame candidates, ranked by mask depth
   statistics (lowest depth MSE about the mask-mean depth; mean depth ≥ 1 m).
3. The operator picks a frame, starts a measuring session and measures freely, naming
   each measurement: 2D distance, 3D distance, 2D curve, 3D curve (+ angles, see Decisions).
4. Sessions are saved to History; any session can be reopened, continued or inspected.
5. Finished sessions export to a bilingual AR/EN **PDF** report with all details.

```
.bag ─► engine: walk bag (rgb8 → BGR once; depth aligned to colour; intrinsics) ─► YOLO11n-seg mask per sampled frame
     ─► candidate ranking by mask depth stats ─► app: operator picks a frame
     ─► engine: Z_ref = median valid depth in mask · ground line = near-plane lowest mask row · depth per clicked point (direct, else KNN)
     ─► app: operator draws named 2D/3D distances and curves on an editing canvas (never an approval surface)
     ─► engine: computes every value, autosaves session.json, renders overlay.png ONCE (single rendering authority)
     ─► app: approve on that PNG → print page (React + Tailwind) → Electron printToPDF
     ─► engine: attaches overlay.png + session.json into the PDF, probes pixels/text/fonts, writes the manifest
     ─► bilingual AR/EN PDF (IBM Plex Sans Arabic), reviewed in-app before signing
```

The engine never scores beauty or ranks camels; it measures what the judge draws.
Depth fallbacks and rejections are always recorded, never silent.

Scaffolded 2026-10-04 inside the `camel_beauty` repo (`E:\camel_beauty`, git `main`); its own
git repository (`main`) since 2026-10-10, still inside the parent's folder. The parent's guidance
file (≈ 620 lines; committed as `CLAUDE.md`, in the parent's working tree currently an untracked
`AGENTS.md`) holds the history (Phases 1–21, ADR-001 honesty contract, audit disciplines
D7/D8/D9); read it for *why*. Nothing here imports the parent package.

## State of the repo (2026-10-18)

| Path | What is there |
|---|---|
| `app/` | **Stages 1–9 of the app plan done, with additions A (offline licence keys) and B (Windows installer), D11; 2026-10-13.** Electron 44 + electron-vite 5 (vite 7) + React 19 + Redux Toolkit + Tailwind v4 + TypeScript 5.9, exact pins (D9 "App implementation decisions"); what lives where: Architecture → "App map". The operator flow runs end to end through the UI: open a recording, the frame search and the proposed frames, measuring (the eight kinds, with the mouse or the keyboard crosshair), autosave, History, finalize, approve on the engine's verified image, print, seal, sign-off on the PDF. **Integration-tested:** `e2e/flow-real.spec.ts` drives the built app on bag 006 with `best.pt` through every `real_run` check (11/11, 2026-10-13); the dev app on the real engine passed the Stage 6 walk (24 checks), the Stage 7 walk (45: three languages sealed with strict probes, the headless re-export) and the Stage 8 walk (44/45; the one failure was the user's own pointer over the visible window, D9). The installer (`npm run dist`: unsigned NSIS, the engine as an embedded CPython) passed the packaged smoke on this laptop (24/24) and the D11 clean-PC checklist in Windows Sandbox, network on and off (2026-10-13). **Not production-validated:** no field laptop, no signed installer, no field capture. The vendor key pair exists (created 2026-10-12, key id `2f8696292b9d9ec0`; `src/main/license/publicKey.ts` holds its public half). Stage 9 (D9 "Review and wrap-up"): one read-only review of `app/` (19 findings, none a blocker: 18 fixed, each with a test; a fresh print partition per print kept, as D7 asks), the batched Arabic wording pass, `AGENTS.md` reduced to a pointer to this file; after the fixes `npm test` 700 tests, `npm run e2e` 16 passed, the real flow 11 of 11. **Release 1.0.0 (2026-10-14; `package.json` version 1.0.0):** the operator's wording decisions (the app, the engine's printed labels, «تثبيت» throughout the installer), the installer's two Sandbox findings fixed (`build/installer.nsh`: the install-mode page mirrored, the uninstaller in the language chosen at install), `npm test` 705, e2e 16, the real flow 11 of 11, `release\Nazeer Desktop Setup 1.0.0.exe` (packaged smoke 24/24, every D11 item passed again in Windows Sandbox); delivered with a 7-day trial key to one client as an evaluation under the operator's responsibility (D6; D11 "Release 1.0.0"). **D12 (proposed 2026-10-17; "Save as" and the comparison report): Stage 1 of 6 done** — "Save as" for single reports: main opens the Save dialog, fetches the sealed PDF from the engine (its SHA-256 checked against `session.json` and the manifest), writes the copy atomically anywhere but the data root, reads it back and records it (`src/main/report/`, `settings.ts`); the dialog opens by itself once the viewer verified a freshly sealed report; "Save PDF as…" on the Report screen and on History rows; `npm test` 776, e2e 16, the real flow 11 of 11 with the saved copy byte-identical to the sealed report (integration-tested). **Stage 2 of 6 done** (engine: the comparison model, storage and index): `comparison_model.py` builds the rows (exact name + kind + occurrence; 2D never shares a row with 3D; texts only, nothing ranked) from each member's frozen report model, `comparison_store.py` keeps `<root>/comparisons/<id>/` (create re-checks every member from its files; stale by content, computed), `history.sqlite` version 2 (comparison tables, a migration in place), six new operations and the eligibility of every History row; pytest 488, `npm test` 777 (unit-tested; the engine's real-model flow untouched). **Stage 3 of 6 done** (engine: the comparison seal): `POST /comparisons/{id}/report` probes the printed PDF in order (each camel's approved overlay, unchanged, on exactly one page after the previous camel's), checks each camel's names and camel id within its own pages, attaches every member's overlay, `session.json` and report model plus the comparison model, keeps a refused print, and re-checks the members after the probe (a camel changed meanwhile → `comparison_stale`); measured with headless Edge on real frames: 20 camels = 26 pages, 29.3 MB printed, 55.4 MB sealed, seal 6.8 s, peak 383 MB (`tools/measure_comparison_seal.py`; the upload cap 64 MiB follows); pytest 500, the opt-in `realpdf` comparison passes (integration-tested with Edge, not yet with the app). **Stage 4 of 6 done** (app: the comparison screens): History gains a Comparisons tab (`?tab=comparisons`), event and date filters, a selection column (eligible rows only, the engine's reason on the others) with a sticky Compare bar; the Compare dialog orders the camels (drag, or ▲ / ▼ from the keyboard), approves each image not sealed in a report on the engine's full image (WebCrypto-checked), takes the cover and language and creates the comparison; `#/comparisons/:id` edits the cover, shows each camel's stale reasons and offers "Compare again" and Delete; the limits come from `/meta/labels` constants; `npm test` 824 (unit-tested), e2e 16, the real flow 11 of 11. **Stage 5 of 6 done** (app: the comparison's print): `print.html` lays out a comparison model too (`ComparisonPage`: cover, the table in blocks of camel columns, one section per camel with its approved overlay; pre-flight: one overlay per camel in order, no cell wider than its column), main fetches and hashes each approved image and has the engine seal the PDF (`print.exportComparison`, one gate with the report's export), each print phase has its time limit, the sealed comparison is shown, checked and saved with "Save as"; printed and sealed in the built app at 1, 5 and 20 camels on real frames, every seal PASS (20 camels: 45 pages, 27.8 MB printed, 52.7 MB sealed, print 2.5 s, seal 6.1 s; `e2e/measure-comparison.spec.ts`); `npm test` 858, e2e 16, the real flow 11 of 11. **Stage 6 of 6 done (2026-10-18)**: `e2e/comparison-fast.spec.ts` (bag 004, ellipse stub, Arabic UI) and `e2e/comparison-real.spec.ts` (bag 006 + `best.pt`, English UI, both languages, the PDF read back with pdf.js) drive the comparison through the screens: History selection, order, cover, the image approvals, print, seal, the saved copy, the Comparisons tab, a reopened camel → stale (integration-tested); the Sandbox driver cancels the automatic Save dialog through Win32 (`scripts/sandbox/os-dialogs.mjs`, checked on this laptop only); one read-only review, 7 findings, each fixed with a test (D12 "Stage 6"). Plan: `~/.claude/plans/pasted-content-id-80b5-role-you-swirling-brook.md`. **Release 1.1.0 (2026-10-18; `package.json` 1.1.0):** pytest 502, `npm test` 863, `NAZEER_REAL=1 npm run e2e` 33 passed; `release\Nazeer Desktop Setup 1.1.0.exe` (unsigned; packaged smoke 24/24; an in-place upgrade from 1.0.0 on a real profile: licence kept, History index migrated to version 2); delivered with a **permanent** key (customer `Nazeer_CEO_Ahmed`) under the operator's responsibility (D6, D11 "Release 1.1.0"). The Windows Sandbox check no longer runs: since this laptop's Windows update (build 26100.9711) the Sandbox enforces Smart App Control and refuses the unsigned installer, 1.0.0 included |
| `engine/nazeer_engine/` | **the engine** (≈ 14.5 k lines): FastAPI sidecar, 39 HTTP operations, everything in contracts C1–C3 + ADR-D7's engine half + D12's comparison storage and seal (Stages 2–3). Integration-tested on real bags with the real model, headless Edge and the app; not production-validated (no field capture) |
| `engine/tests/` | ≈ 500 default tests (502 on 2026-10-18) (synthetic frames, fake RealSense, stub model) + 7 opt-in real-resource tests (`realbag`, `realmodel`, `realpdf`) |
| `engine/tools/real_run.py` | the real-bag check (the gate before the app): spawns the sidecar, walks a bag, picks a frame, places seeded random distances, prints with headless Edge, seals the PDF; **34/34 checks passed on bag 006 (2026-10-11; again on 2026-10-12 with report model 1.1)** |
| `tools/generate-license.mjs` | the licence-key generator (D11): run on the vendor's machine, never packaged; `--init` makes the Ed25519 pair in `%USERPROFILE%\.nazeer-license` (refuses git work trees, OneDrive, Desktop, Documents) and writes the app's baked public key; `--days N` / `--expires` trial keys, `--customer` permanent keys |
| `docs/arabic-wording-backlog.md` | the app's Arabic strings per stage and their batched wording pass (Stage 9, 2026-10-13: 11 corrections in `ar.json` and 3 in `main/dialogs.ts` applied); the operator's decisions for release 1.0.0 (2026-10-14: the four one-word-two-meanings items, the engine's printed wording, «تثبيت» throughout the installer) applied; the 12 style suggestions stay open; log new strings there |
| `engine/openapi.json` | the API snapshot for client codegen; a test fails when it drifts from the code |
| `engine/` | `.venv` (Python 3.11.9, **CPU-only torch 2.14.1**), `requirements.txt` (runtime pins incl. pypdf, arabic-reshaper, python-bidi), `requirements-dev.txt` (httpx2, pytest, ruff), `pyproject.toml` (pytest + ruff config) |
| `engine/models/` | `best.pt` (pinned, below), `last.pt` (alternative), `MODEL_CARD.md`, `metrics.json`, `results.csv` |
| `data/.bag/` | 6 D455 recordings (33.5 GB, copies of `../data/.bag`) + `new/` (a duplicate of bag 004) — gitignored |
| `docs/decisions/` | ADR records D1–D11; D7/D8/D10 carry "Engine parameters (implemented 2026-10-11)" sections |
| `fixtures/golden_frame.json` | the golden-frame oracle regenerated from bag 006 by the engine's reader (tracked) |
| `engine/wheels/` | intended offline wheelhouse for the pinned Python deps (not created; see Decisions) |

`runs\dev_root` is the app's dev data root (a copy of a `real_run` data root: one exported bag-006
session and its candidate set); it is gitignored with the rest of `runs/`. When `app/package.json`
changes (scripts, pins), update this table and "Commands" below in the same change.

## Commands

```powershell
# --- Engine environment. Always use the venv path: bare `python` may be 3.13/3.14.
engine\.venv\Scripts\python.exe --version                       # Python 3.11.9
engine\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"
#   → 2.14.1+cpu False   (GPU inference exists only in the parent's .venv-cuda; see Pitfalls)
# Recreate the venv (needs the network once; the CPU torch index is required):
py -3.11 -m venv engine\.venv
engine\.venv\Scripts\python.exe -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r engine\requirements.txt -r engine\requirements-dev.txt

# --- Tests and lint (run from engine\; engine\pyproject.toml holds the pytest + ruff config)
cd engine
.venv\Scripts\python.exe -m pytest -q                            # default suite ≈ 1 min, no bag / model / browser
.venv\Scripts\python.exe -m pytest tests\test_depthlookup.py -q  # one file
.venv\Scripts\python.exe -m pytest tests\test_api.py::test_session_measure_autosave_and_rebase -q
$env:NAZEER_REAL = "1"; .venv\Scripts\python.exe -m pytest tests\test_integration_realbag.py tests\test_segmenter.py tests\test_pdf_finalize.py -q
#   real bag + best.pt + headless Edge (≈ 40 s); or select by marker: -m "realbag and realmodel" / -m realpdf
$env:NAZEER_WRITE_GOLDEN = "1"   # with NAZEER_REAL: rewrites ..\fixtures\golden_frame.json (review the diff)
.venv\Scripts\python.exe -m ruff check . ; .venv\Scripts\python.exe -m ruff format --check .
.venv\Scripts\python.exe -m ruff check ..\app\scripts --config pyproject.toml   # the app's Python build helpers
.venv\Scripts\python.exe -m ruff format --check ..\app\scripts --config pyproject.toml
.venv\Scripts\python.exe -m nazeer_engine --dump-openapi openapi.json   # after any API change (test_api enforces it)

# --- Run the sidecar the way Electron spawns it (one worker; prints ONE ASCII JSON line on stdout)
.venv\Scripts\python.exe -m nazeer_engine --data-root <abs dir> [--port 0] [--token <secret>] [--cors-origin <origin>]
#   → {"event": "ready", "port": 51234, "pid": …, …}   or   {"event": "fatal", "code": …} and exit 2/3/5/6
#   --check validates data root + model and exits; --stub-model (dev only, needs NAZEER_ENGINE_DEV=1) skips YOLO
#   (it detects nothing); with --stub-mask ellipse it finds the same centred ellipse in every frame (model "stub-ellipse":
#   a real bag's walk proposes frames without YOLO, for the fast e2e; refused without --stub-model)
#   the data root must be absolute and not under Desktop/Documents/OneDrive; one engine per data root (engine.lock)

# --- Real-bag check: spawn the sidecar and drive the whole flow over HTTP like the app (≈ 1 min)
.venv\Scripts\python.exe tools\real_run.py [--bag <bag>] [--seed N] [--pick auto|<tile>|<candidate id>] [--angles]
#   bag 006 by default; writes ..\runs\real_run_<UTC>\ (data_root\, candidates\ + contact_sheet.jpg, final_report.pdf,
#   summary.json); random clicks, strict probes, headless Edge print; exit 0 only when every check passes
.venv\Scripts\python.exe tools\measure_comparison_seal.py [--sizes 1,5,20] [--candidates <set dir>]
#   D12: N sessions on the dev root's real frames, a comparison printed in Arabic with headless Edge and sealed
#   in a fresh process; prints pages, printed / sealed MB, print and seal time, peak memory per size (≈ 1 min);
#   writes ..\runs\comparison_seal_<UTC>\summary.json

# --- Model integrity (the engine refuses to load on mismatch: exit 3, model_hash_mismatch)
Get-FileHash models\best.pt -Algorithm SHA256
#   → 0E9EE2BAADA7C70531B66E0B98F7E1CF4DCF3CE7971C55BCE69A7270EC3A4320
cd ..

# --- App (Electron 44 + electron-vite 5 / vite 7 + React 19 + RTK + Tailwind v4; Node 24 / npm 11), run in app\
cd app
npm install                 # exact pins; postinstall `install-electron` fetches the checksum-pinned Electron binary
npm run dev                 # electron-vite dev + its engine (real model) on ..\runs\dev_root; main + preloads rebuilt
                            #   on change, renderer HMR. Dev switches: --data-root <dir> or NAZEER_DATA_ROOT,
                            #   NAZEER_STUB_MODEL=1 (+ NAZEER_STUB_MASK=ellipse), NAZEER_ENGINE_NO_WARMUP=1,
                            #   NAZEER_ENGINE_PYTHON=<python.exe>;
                            #   supervisor log: <userData>\logs\app-engine-stderr.log. Development builds use their own
                            #   profile %APPDATA%\Nazeer Desktop (dev); NAZEER_LICENSE_ENFORCE=1 + NAZEER_LICENSE_PUBLIC_KEY=<pem>
                            #   turn the licence gate on with a test key (ignored in production builds);
                            #   NAZEER_E2E_SAVE_DIALOG=cancel|file:<path>|folder:<dir> answers "Save as"'s dialog (D12;
                            #   the e2e specs default it to cancel; ignored in production builds)
npm run dev -- --remoteDebuggingPort 9333   # same, inspectable from Playwright (chromium.connectOverCDP)
npm run typecheck           # tsc over three projects: node (main/preload/shared), web (renderer/print), e2e
npm run lint ; npm run format:check         # ESLint (type-aware) ; Prettier (line width 100; also ..\tools)
npm test                    # Vitest: node project (CSP, app:// paths, API drift) + jsdom project (React)
npm run test:store-real     # the session store against a real engine: the stub-model engine on a copy of the dev
                            #   session (needs ..\runs\dev_root); reopen, autosave, a 409 rebase, finalize, overlay re-hash
npm run build               # electron-vite build → out\main, out\preload, out\renderer\{renderer,print}
npm run e2e                 # build + Playwright-Electron specs in e2e\: smoke + connectivity (each launch spawns
                            #   its own stub-model engine on a temp data root; connectivity copies the dev-root session;
                            #   license drives the Activate screen with keys from the real generator; export prints and
                            #   seals the dev-root session, then the headless re-export); flow-fast: bag 004 through the
                            #   Arabic UI with the ellipse stub (open, frames, session, four measurements, finalize,
                            #   approve, print, seal); comparison-fast (D12): two sessions on bag 004 set up over the
                            #   API, then History selection, order, cover, the two image approvals, print, seal, the
                            #   saved copy (NAZEER_E2E_SAVE_DIALOG folder:), the Comparisons tab, a reopened camel →
                            #   stale with its reason; labels come from the i18n tables by key (e2e\helpers\labels.ts)
$env:NAZEER_REAL = "1"; npm run e2e   # adds flow-real: bag 006 + best.pt through the English UI with every real_run check
                            #   (hover and saved depth sources, autosave revisions, previews, hashes, probes, the PDF's
                            #   pages, face and attachments read back with pdf.js, History), and comparison-real (D12:
                            #   the comparison flow on bag 006 + best.pt in both languages, its PDF read back with
                            #   pdf.js); one spec: npx playwright test e2e/flow-real.spec.ts after npm run build
$env:NAZEER_MEASURE = "1"; npx playwright test e2e/measure-comparison.spec.ts   # after npm run build: D12, the
                            #   built app prints and seals comparisons of 1, 5 and 20 camels (copies of the newest
                            #   ..\runs\comparison_seal_* roots) through print.exportComparison; times, pages, sizes,
                            #   peak memory → ..\runs\comparison_print_<UTC>\summary.json + the sealed PDFs (≈ 40 s)
npm run gen:api             # src\shared\api.d.ts from ..\engine\openapi.json (a test fails when it drifts)
npm run gen:codes           # src\shared\engine-codes.json: every error code in the engine source (a test fails on drift;
                            #   the i18n test fails when one has no Arabic + English label)
npm run gen:cmap            # src\print\plex-cmap.json: the code points of the engine's pinned Plex TTF (engine venv
                            #   fontTools) + its SHA-256; the print page's glyph check (a test fails when they drift)
npm run fixtures            # spawn the engine (stub model) on ..\runs\dev_root, write app\fixtures\*.json
npm run snap -- [--routes /,/design,/design/components,/design/domain] [--themes light,dark] [--langs ar,en]
                 [--label x] [--wait ms]
                            # dev app over CDP → full-page PNGs in ..\runs\app_snaps\<label>\ + renderer console errors
                            #   (from Git Bash set MSYS_NO_PATHCONV=1: it rewrites "/design" into a Windows path);
                            #   waits once for the engine (ready or fatal) before the first shot
npm run stage:engine        # the installer's engine → dist-engine\ (embeddable CPython 3.11.9 + the venv's runtime packages
                            #   + nazeer_engine + best.pt; signatures, DLL closure, import sweep, --check, serve smoke; ≈ 70 s;
                            #   the python.org zip is fetched once into .cache\, SHA-256 pinned; smoke logs in .cache\stage-engine\)
npm run dist                # release\Nazeer Desktop Setup <version>.exe: licence-key check → NAZEER_DIST=1 build → stage:engine
                            #   → electron-builder (electron-builder.yml); npm run dist:dir stops at release\win-unpacked
npm run smoke:packaged -- --move-profile-aside   # silent per-user install → Activate (bad keys, a fresh trial key from
                            #   the vendor key) → engine → quit → relaunch → renamed exe → uninstall; restores the profile
..\engine\.venv\Scripts\python.exe -I scripts\make_icon.py   # build\icon.ico + src\renderer\favicon.png from build\logo.png
npm run export -- <session_dir> [--out <result.json>]
                            # headless re-export (D7): build, then print and seal a finalized session again with its
                            #   own engine (no warm-up); only a session sealed once from its current overlay; exit 4 with
                            #   engine_already_running while the app serves that data root; packaged: "Nazeer Desktop.exe"
                            #   --export <session_dir> [--out <file>]
npm run check:sandbox -- [--installer <exe>] [--bag <bag> | --no-bag] [--modes full,offline] [--dry-run]
                            # the D11 clean-PC checklist in Windows Sandbox (feature on, after a restart): two runs
                            #   (network on: SmartScreen, the Arabic installer pages, per-user + all-users installs, a
                            #   standard user with an Arabic name; network off), each with the app, a bag, print and
                            #   seal (the Save dialog that opens by itself after the seal is cancelled through Win32,
                            #   scripts\sandbox\os-dialogs.mjs, D12); ..\runs\sandbox_check_<UTC>\summary.md per D11 item. Keep the Sandbox window visible
                            #   and untouched. Windows Sandbox 0.8.x on this two-GPU laptop logs on only with the
                            #   policy AllowVGPU = 0 (HKLM\SOFTWARE\Policies\Microsoft\Windows\Sandbox, set 2026-10-13, D11)

# --- Licence keys (D11): the vendor's machine; the private key stays in %USERPROFILE%\.nazeer-license
node tools/generate-license.mjs --init            # once: key pair + app\src\main\license\publicKey.ts (back up the folder)
node tools/generate-license.mjs --days 7          # a trial key on stdout (N x 24 h from now); --expires <instant> for a fixed date
node tools/generate-license.mjs --customer "Name" # a permanent key; --days/--expires with --customer = a named trial

# --- Re-run the evidence probes behind MODEL_CARD.md (parent repo, parent GPU venv)
cd E:\camel_beauty
.venv-cuda\Scripts\python.exe runs\electron_mvp_probe\probe_seg_contract.py   # puts parent src/ on sys.path itself
.venv-cuda\Scripts\python.exe runs\electron_mvp_probe\probe_color_order.py
.venv-cuda\Scripts\python.exe runs\electron_mvp_probe\probe_cpu_retina.py
.venv-cuda\Scripts\python.exe runs\electron_mvp_probe\probe_bag_timing.py
```

## Architecture (engine implemented 2026-10-11; app implemented 2026-10-13 — Stages 1–9 + additions A and B)

- **`app/` — Electron + Vite + React + TypeScript + Tailwind CSS.** Owns the operator UI:
  bag discovery (OS file dialog filtered to `.bag`, a recent list, an optional bounded
  scan of configured capture folders — the renderer only ever passes a path to the
  engine, never reads the multi-GB bag), the candidate grid, the editing canvas for the
  measurement kinds (the canvas is **never an approval surface**), the review of the
  engine's `overlay.png` (SHA-256 recomputed with WebCrypto and compared with the
  engine's stamp; mismatch is a hard error), History, the `print.html` Vite entry printed
  with `webContents.printToPDF` in a hidden window, and the in-app PDF viewer (bundled
  pdf.js) used for final sign-off. Resolves `DATA_ROOT = app.getPath("userData")` (dev:
  `--data-root`, `NAZEER_DATA_ROOT`, else `runs\dev_root`) and spawns/supervises the engine
  sidecar on `127.0.0.1` with it, once the offline licence gate (D11) has an active key.
  Packaged by electron-builder as an unsigned NSIS installer that carries the engine as an
  embedded CPython (D11).
- **`engine/` — Python 3.11 FastAPI service, one worker.** Owns everything that touches
  numpy: bag walking (pyrealsense2), YOLO inference (model loaded + warmed at startup),
  candidate ranking as a cancellable background job, Z_ref and ground line, depth lookup
  with KNN fallback, the measurement math, session persistence + the derived history
  index, the overlay PNG (single rendering authority) and the report model; after export
  it owns the evidence post-processing (pypdf attachment, probe, manifest). It does
  **not** typeset the document. Must stay importable without open3d / PyQt / pyvista.
- **Model** — one pinned checkpoint, hash-checked at load. Everything the operator sees
  traces back to one known model.

### App map (`app/`)

| Layer | Modules |
|---|---|
| main process (`src/main/`) | `index.ts` (lifecycle, single-instance lock, `--export` dispatch), `runtime.ts` (production = packaged or built with `NAZEER_DIST=1`: licence required, development switches ignored), `security.ts` + `csp.ts` (window flags, CSP builders, navigation / window-open / webview / permission guards, production menu, sender checks), `protocol.ts` + `appPath.ts` (`app://nazeer`, traversal-safe), `windows.ts` + `rendererRecovery.ts` (a crashed renderer is reloaded a few times, then the operator decides), `ipc.ts` (every `ipcMain.handle`; payloads checked by `shared/ipcValidate.ts`), `dialogs.ts`, `scan.ts` (bounded capture-folder scan), `settings.ts` (`<userData>\app-settings.json`: the capture folders, "Save as"'s last folder and the copies it wrote), `quit.ts` (renderer flush → engine shutdown → kill), `report/` ("Save as", D12: `saveAs.ts` the orchestration — the sealed PDF read and checked, the Save dialog, the data-root refusal, the copy verified and recorded; `atomicWrite.ts` temp file + fsync + rename; `savedCopies.ts` the recorded copy, open / show in folder) |
| engine supervisor (`src/main/engine/`) | `dataRoot.ts` (data-root rules), `command.ts` (the venv in development; in production `<resources>\engine\python\python.exe -I -u -B -m nazeer_engine` with the development variables dropped), `process.ts`, `readyLine.ts`, `supervisor.ts` (a token per start, ready-line identity, `/health` watchdog), `restartPolicy.ts` (one retry, crash backoff), `orphan.ts` (exit 6), `logs.ts` (rotating `<userData>\logs\app-engine-stderr.log`) |
| licence (`src/main/license/`, D11) | `verify.ts` (Ed25519 `NZL1.<payload>.<signature>`), `store.ts` (`<userData>\app-license.json`), `service.ts` (re-checked at every start; the engine starts only once a licence is active), `publicKey.ts` (written by `tools/generate-license.mjs --init`) |
| printing (`src/main/print/`, D7) | `exportPdf.ts` (the checks, the print, the upload and the result; the export gate shared with the comparison's), `exportComparison.ts` (D12: the comparison read again, every camel's image approved, the model and each overlay fetched and hashed, the print, the seal), `printWindow.ts` (hidden, sandboxed, its own in-memory partition; a time limit for the layout and another for `printToPDF`), `assets.ts` (the engine's pinned Plex TTF, hash-checked against `print/plex-cmap.json`, and the logo), `cli.ts` (`--export`) |
| preloads (`src/preload/`) | `index.ts` (`window.nazeer`; D12 adds `report.*` and `print.exportComparison`), `print.ts` (the print page's bridge); each a self-contained file (a sandboxed preload cannot load chunks) |
| shared (`src/shared/`) | `api.d.ts` (generated from `engine/openapi.json`), `engine-codes.json` (generated from the engine source), `ipc.ts` + `printChannels.ts` (channels, payload types), `ipcValidate.ts`, `ids.ts`, `fileNames.ts` (the default names of saved copies, sanitised for Windows) |
| renderer (`src/renderer/`) | `api/` (openapi-fetch client, RTK Query `engineApi`, asset URLs with the token, SSE `jobEvents`, the error envelope, runtime readers for labels / session views / report models / probes), `store/` (slices `engine`, `license`, `ui`, `bag`, `candidates`, `session`, `report`, `history`, `comparisons` (D12: the camels ticked in the operator's order, the Compare dialog, the approvals given in the app, the Comparisons tab's query), `savedFiles`; listeners `autosave`, `candidates`, `finalize`, `probes`, `indexRefresh` (History and Comparisons asked again when the open session's status, image or report changes); thunks; `session/` document, rebase, sync, flush; `services/overlayBytes.ts`; `useDropSaveOffer.ts`: leaving a sealed report's screen drops its Save offer, not on a StrictMode remount), `screens/` (Home, Candidates, CandidateSet, `measure/`, FinalizeScreen, ReportScreen, HistoryScreen (tabs Sessions and Comparisons: `ComparisonsTab`), ComparisonScreen (`#/comparisons/:id`, D12; its print and sealed PDF in `ComparisonReport`), About, Activate, `session/` gate + unsaved guard, ScreenError: a screen that failed to render), `components/ui/` (Radix-based primitives, the `Bi` / `Ltr` / `Num` isolates), `components/domain/` (bag picker, frame-search progress, candidate grid, measuring toolbar + the render-only canvas in `measure/`, measurement list, hover readout, Z_ref card, overlay approval, report inputs, probe report, pdf.js viewer, "Save as" panel, History table (with D12's selection column), the Compare bar and dialog, the member-image approval, the comparisons table, the engine and licence gates), `design/` (tokens, fonts, the development-only gallery `#/design`), `i18n/` (`ar.json`, `en.json`), `lib/` (`bidi.tsx` Latin-run isolation, `sha256.ts`, `pdf.ts`, `read.ts`) |
| print page (`src/print/`) | `model.ts` (report model 1.1, every printed field checked), `PrintPage.tsx`, `comparisonModel.ts` + `ComparisonPage.tsx` (D12: the comparison model 1.0 and its page; `main.tsx` picks the page by the job's `kind`), `text.tsx` (labels, operator text, numbers), `face.ts` (the Plex face from its bytes), `preflight.ts` (the probe's text rules and a glyph check against `plex-cmap.json`) |
| build, packaging, checks | `scripts/`: `gen-api`, `gen-engine-codes`, `gen-font-cmap`, `capture-fixtures`, `snap`, `store-real`, `stage-engine` (+ `engine_bundle.py`, `lib/`), `dist-checks`, `packaged-smoke`, `sandbox-check` (+ `sandbox/`; `sandbox/os-dialogs.mjs` cancels the packaged app's Save dialog through Win32), `make_icon.py`; `electron-builder.yml` (NSIS x64, per-user by default, fuses, publisher "Nazeer"); `build/` (`logo.png` → `icon.ico`, `installer.nsh` with the Arabic installer pages); `e2e/` (smoke, connectivity, license, export, flow-fast, flow-real, comparison-fast, comparison-real, the opt-in measure-comparison; `helpers/`, `helpers/comparison.ts` the comparison flow both comparison specs share); `fixtures/` (engine payloads for unit tests and the gallery) |

### Engine package map (`engine/nazeer_engine/`)

| Layer | Modules |
|---|---|
| foundations | `constants` (every threshold; `CONSTANTS_STAMP` goes into every session / candidates / manifest), `errors` (`EngineError(code, status, details)`), `jsonsafe` (finite-only JSON, `FiniteJSONResponse`), `fsio` (atomic writes with the C3.4 retry ladder, imencode/imdecode, fingerprints), `settings` (data-root rules), `versions`, `assets`, `logsetup` |
| measurement core | `geometry` (vendored math + `curve_length_3d`), `maskstats` (eroded-mask stats, Z_ref block, ground rows, depth-valid bbox, `frame_clearance`), `depthlookup` (C1: `build_frame_context`, `depth_for_pixel`), `provenance`, `session_compute` (input → computed row, presentation), `labels` (every code's AR/EN label) |
| bag → candidates | `bagreader` (lazy pyrealsense2), `segmenter` (pinned YOLO, retina masks; `StubSegmenter`), `candidates` (C2 gates, holders, ranking, persistence), `candidate_cache`, `frames`, `jobs` (one background job, cancel / stop) |
| sessions → report | `session_schema` (2.1 dataclasses, `required_report_texts`), `session_store` (locks, autosave, finalize, attach, delete), `history` (derived SQLite index), `recent`, `overlay` (the PNG), `report_model`, `report_content`, `arabic`, `pdf_finalize` (probes + attachments; the comparison's ordered probes) |
| comparisons (D12) | `comparison_model` (pure: eligibility, staleness by content, rows matched by exact name + kind + occurrence, member blocks from the frozen report models — texts only), `comparison_store` (`<root>/comparisons/<id>/`: create under the member session locks in sorted order, view, cover / language → model v+1, the seal: evidence read under the member locks, the probe without them, a second look before writing; delete to the trash, reconcile) |
| HTTP | `api/app.py` (`create_app`, error handlers, token + CORS middleware), `api/routes_*.py`, `api/schemas.py` (pydantic; `extra="forbid"`, no NaN), `api/views.py` (response shapes), `__main__.py` (the sidecar) |

### HTTP API for the renderer (React + Redux)

39 operations; `engine/openapi.json` is the contract (operation ids = function names, e.g.
`put_document`) — generate the client types from it. Conventions:

- Errors are always `{"error": {"code", "message", "details"}}` with a stable `code`
  (`stale_revision`, `job_busy`, `camel_id_required`, `overlay_drift`, `text_probe_failed`,
  `report_model_mismatch`, `validation_error`, `internal_error`, …), including 500s (which
  carry CORS headers) and a failed job's `error`; the OpenAPI documents every 4xx/5xx as
  `ErrorOut`. `/meta/labels` gives the bilingual label of every code, kind, source, flag,
  bucket and status — never hard-code strings.
- Auth: `--token` ⇒ header `X-Nazeer-Token` (or `?token=` for `<img>` / `EventSource`);
  `/health` stays open. CORS defaults to the Vite dev origins and `app://nazeer`.
  `/docs` and `/redoc` (CDN assets) exist only with `NAZEER_ENGINE_DEV=1`;
  `/openapi.json` always.
- Flow: `POST /bags/inspect` → `POST /candidates/jobs` (202 job | 200 cached; poll
  `GET /candidates/jobs/{id}` or SSE `…/events`; `cancel`, `stop`) →
  `GET /candidates/{fp}/{ph}` (unordered grid; each item has `urls` and a `ref`) →
  `POST /sessions {candidate: ref, camel_id}` (201 `SessionView`) → hover
  `POST /sessions/{id}/depth` and drag `POST …/preview` (both echo `seq`) → autosave
  `PUT …/document {revision: stored + 1, measurements: [...]}` (omitted `camel_id` /
  `operator` / `notes` are kept; ETag `"r<revision>-<hash>"`, optional `If-Match`; 409
  `stale_revision` carries `details.current`, the full view to rebase onto; a replay of
  the stored revision is a 200) → `POST …/finalize` (renders the overlay; approve on
  `outputs.overlay.url`) → print with the verified PNG bytes, the report model at
  `outputs.report_model.url` and every `required_report_texts` string → `POST …/report`
  with the raw PDF (`Content-Type: application/pdf`, `X-Overlay-Sha256`,
  `X-Report-Model-Sha256`; text and font probes strict unless `require_text=false` /
  `require_font=false`) → `GET …/report` for sign-off (`outputs.report.stale` when it no
  longer shows the session). History: `GET /sessions?q=&status=` (reconciled on every call;
  a broken session folder is a `corrupt` row), `DELETE`, `POST …/reopen`,
  `PATCH …/report-inputs` (a change writes a new report model version). Since D12 each row also
  carries `event`, `n_comparisons` and `comparison {eligible, reason, approved_by_seal, overlay}`
  (labels group `comparison_ineligible`), and the list filters by `event` and
  `created_from` / `created_to` (ISO instants, inclusive).
- Comparisons (D12; engine done in Stages 2–3): `POST /comparisons {session_ids (the operator's order),
  cover {title, event, judge, council}, language}` (201; every member re-checked from its files;
  one refused member refuses the request and `details.members[]` names each with its `reason`) →
  `GET /comparisons/{id}` (members with `stale_reasons`, `notes`, `approved_by_seal`, the
  approved overlay's URL and SHA-256; staleness read from the member files) →
  `PATCH …/inputs` (cover / language → `comparison_model_v<N+1>.json`) → `GET …/assets/{name}`;
  `GET /comparisons?q=&status=&stale=` (reconciled; staleness from the index); `DELETE`. Labels
  groups `comparison_stale`, `comparison_statuses`; the app's limits are `/meta/labels` `constants`
  `COMPARISON_MAX_SESSIONS`, `COMPARISON_MAX_TITLE`, `COMPARISON_MAX_NAME`. Seal: `POST …/report` with the raw PDF
  (`X-Comparison-Model-Sha256`; text and font probes strict unless `require_text=false` /
  `require_font=false`; at most `COMPARISON_PDF_MAX_BYTES`) → `{comparison, probe}`; refusals 409
  `comparison_stale`, `comparison_model_mismatch`, `overlay_missing` / `overlay_drift` /
  `overlay_out_of_place`, `text_probe_failed`, `font_probe_failed`, `session_assets_changed` (a
  refused print kept, `rejected_url`); `GET …/report?v=` the sealed PDF.
- A measurement input is `{id, kind, name, points, targets?, line_a_id?, line_b_id?,
  color?, note}`; `kind` ∈ `distance_2d | distance_3d | curve_2d | curve_3d |
  angle_2d_3point | angle_3d_3point | angle_2d_from_horizontal | angle_4point`. The client
  owns ids (`next_measurement_id`, never decreases; ids and revisions ≤ 2**53 − 1) and
  sends the whole ordered list on every save; the engine returns computed rows with
  `presentation` (value, value text, depth basis, flag chips, rejection) for direct
  rendering.
- Candidate jobs: snapshot `counters` include `rejected_by_reason` live; a walk the
  operator stops early is shown but never served as a cache hit; picks are ≥ 1.5 s apart.

### Engine inference contract (locked in `engine/models/MODEL_CARD.md` §3)

| Setting | Value | Why |
|---|---|---|
| Input | BGR `uint8` H×W×3, **true colours**. The bag stores **rgb8**: convert once, in the bag reader | the old pipeline fed swapped colours (blue camel) |
| Resolution | letterboxed to 640 on the long side (1280×720 → 640×384 tensor) | training `imgsz` = 640 |
| Confidence | `conf=0.5`, highest-confidence detection only; none → rejection with a reason, never an empty mask | single-camel sessions |
| Masks | `retina_masks=True` | resizing the 384×640 proto mask without stripping its 12 px padding squeezed it ~6 % (IoU 0.881 vs retina; a 22 px ground-row shift in the parent's notes) |
| Output | mask H×W `uint8` 0/255 aligned to the frame, bbox `xyxy` px, confidence | |
| Z_ref | **median** of valid depth (0.3–5.0 m band) over the mask **eroded by 2 px** (the same pixel set the KNN tree uses); one frozen `z_ref` block per session (statistic, n_total, n_valid, valid fraction, MAD, band). Never reuse the parent notebook's `z_used_m`, which is the mean (mean − median is +0.04 m median, +0.22 m p95 on real frames) | robust to depth holes and boundary bleed |
| Ground line | lowest mask row **among columns whose bottom-8-px mask depth is within 12 % of Z_ref** (a far-side leg can put the raw lowest row ~37 px / 10 cm too low); both rows stored, the near-plane one drawn, a badge when they differ by > 8 px. Not a depth-projected plane (it rode up through the hooves) | perspective |
| 2D distance | `Z_ref · sqrt(((u1−u2)/fx)² + ((v1−v2)/fy)²)`, `uncertainty_m = distance · z_mad / z_median` | per-pixel depth never enters the 2D formula; the Z-plane assumption (5–12 % on real frames) is the dominant 2D error |
| Depth FOV | the aligned depth map does not cover the whole colour frame (~32 px left, 8–18 px right, 18–46 px top have no depth); store `depth_valid_bbox` per frame | KNN provenance (`knn_no_depth_band`) and the candidate flag `mask_in_depth_margin` are judged against it |
| Distortion | the colour stream's inverse Brown-Conrady coefficients are recorded but ignored by the pinhole math | state it in the report model |
| Serialisation | every number is passed through one finite-only normaliser (`float`/`int`/`bool`, NaN/Inf → `null`, no numpy scalars); sessions and API responses are written with `allow_nan=False` as the tripwire | bare `NaN` tokens break `JSON.parse`; Starlette raises on them |

**Golden frame** (bag `20260414_175757-006`, read index 180, 1280×720, true colours,
retina masks). Test oracle, tolerances ±1 % mask pixels / ±0.01 confidence:

| Checkpoint | conf | mask px | mask rows | CPU ms/frame |
|---|---|---|---|---|
| `best.pt` (pinned) | 0.959 | 269,033 | 9–715 | 46.0 |
| `last.pt` | 0.965 | 269,677 | 11–712 | 47.6 |

Provenance: computed in the parent `.venv-cuda` (torch 2.11.0+cu128, numpy 2.4.4,
opencv 4.13.0) from `E:\camel_beauty\reference\notebooks\data\rgbd_20260514_145407\rgb.png`
(sha256 `9f454886…8fd13c`, stored bluish — B > R) with channels reversed. Re-run in
`engine/.venv` on 2026-10-10 reproduced conf / pixels / rows exactly at 46.9–47.6 ms
(`best.pt`) and 47.2–49.8 ms (`last.pt`). The 11.7 ms GPU figure was measured with
`last.pt`. The 2.051 m / 2.063 m heights in the card are computed from rows 711/715, not
measured. "Read index 180" is the 0-based count of aligned colour+depth pairs (pairs
missing either stream are skipped without incrementing); `bag_time_sec 1776178686.5478632`
is the robust key. **Regenerated from the bag on 2026-10-11** by the engine's reader:
bit-identical to the parent capture (RGB and depth max |Δ| = 0; colour frame 9689, depth
frame 9538, timestamp 1776178686547.86 ms), and `best.pt` gives conf 0.9593, 269,033 px,
rows 9–715 in `engine/.venv`; Z_ref 1.930 m, depth-valid bbox [38, 22, 1276, 719], ground
row 715. The oracle is `fixtures/golden_frame.json` (frame bytes exact, model tolerances
as above), checked by `tests/test_integration_realbag.py`.

### Measurement types (decision 2026-10-10)

| Kind | Math | Parent status |
|---|---|---|
| 2D distance | `distance_2d_image_plane` at Z_ref | exists (`measure.py:179`), tested |
| 3D distance | depth per endpoint (contract C1) → backproject → `distance_3d`; `uncertainty_m = sqrt(σ_d² + nn_dist_m_max²)` for KNN endpoints so ± is never smaller than the snap | exists (`measure.py:139/169/463`), tested; uncertainty rule is new |
| 2D curve | `curve_length_2d`: chord-sum polyline in the Z = Z_ref plane; under-estimates arcs — label it a polyline | exists (`measure.py:216`), tested |
| 3D curve | **new**: depth per control point → backproject → `distance_3d` per segment; `measurement_type = "curve_3d"`, `points_3d`, `point_depth[]`, `segment_dz_m[]` | absent (grep `curve_3d|curve_length_3d|points_3d` → 0 hits); `CurveMeasurement.measurement_type` is hard-coded `curve_2d` |
| Angles (A2) | `angle_between_lines` (4-point), `angle_3point` 2D/3D, `angle_from_horizontal_2d` | exist; 3D 3-point happy path untested |

The operator picks the kind explicitly; **nothing falls back from 3D to 2D** (the parent
README §3.3 documents the opposite priority — it does not apply here). D7 adversarial
tests: `curve_length_3d` must change when depth changes; `curve_length_2d` must not read
depth.

### Depth lookup with KNN fallback (contract C1, proposed 2026-10-10, reviewed)

`depth_for_pixel(u, v, frame, *, tool_target) -> (depth_m | None, provenance)`

1. Valid depth = finite and 0.3 m ≤ d ≤ 5.0 m.
2. **Direct value**: the median of valid depths in the 5×5 window at the click (the
   parent's `backproject_pixel` rule, ≥ 30 % of the window valid). Inside the mask the
   window is restricted to in-mask pixels (unmasked window only if < 30 % remain, and
   say so). Record `window_n_valid`, `window_n_in_mask`, `window_spread_m`; flag
   `depth_edge` when the spread exceeds max(0.10 m, 5 % of Z) and use the nearer
   cluster's median when the median sits in the far cluster.
3. **KNN value** (the operator's rule): `scipy.spatial.cKDTree` built when the frame is
   loaded (≈ 140 ms on ~500k points, float32 coords, cached per session — never on the
   first click) over valid-depth pixels of the mask **eroded by 2 px** (neighbours come
   from the body surface, not the misaligned boundary ring); `KNN_K = 9`, odd, **median**
   of the k depths (same estimator as the direct path; tolerates 4 bad neighbours).
   Empty eroded set → raw mask with `knn_raw_boundary`. Record `k_used = min(k, n)`
   (clamp before indexing: cKDTree pads with `inf` and index `n`), max neighbour distance
   in px **and metres** (`px · Z / fx`), the neighbour centroid, `nn_depth_spread_m`
   (flag `knn_spread` and take the nearest cluster's median when it exceeds the edge
   threshold).
4. **Which value a point gets:** inside the mask with a valid window → direct
   (`window_median`), KNN stored as cross-check. Outside the mask, or window sparse →
   KNN (`knn_snapped_to_mask` / `knn_fill` / `knn_no_depth_band`). When the pixel's own
   window is valid but disagrees with KNN by more than max(0.05 m, 3 % of Z), the click
   is on another surface: the default Line/Curve tool keeps the operator's rule (camel
   depth) and stores `direct_depth_m` alongside with flag `off_mask_surface`; a
   Shift-click "ground / background point" keeps the direct value (`direct_off_mask`)
   for measurements that intend the real ground. The row prints both when they disagree.
5. **Hard rejections** (row persisted, value `null`): `pixel_out_of_image`,
   `no_valid_depth_in_mask`, `mask_valid_too_sparse` (eroded valid pixels <
   max(KNN_K, 2 % of mask)), and `knn_too_far` above `KNN_MAX_DIST_M = 0.30` (hoof and
   ground clicks resolve at 6–10 cm on real frames). **Soft flags** (value kept,
   visible): `knn_far` above 0.10 m, `knn_spread`, `depth_edge`, `off_mask_surface`.
6. **Provenance** per point is a typed, finite-only record (`source`, `depth_m`,
   `inside_mask`, window stats, `k_requested`, `k_used`, `nn_dist_px_max`,
   `nn_dist_m_max`, `nn_centroid_px`, `nn_depth_spread_m`, `direct_depth_m`, `flags[]`,
   `reason`). Overlay and PDF show it: KNN points as hollow markers with a leader line
   to the neighbour centroid, a bilingual "Depth basis" column ("direct", "snapped to
   camel 7.8 cm", "Z_ref 1.930 m") with flag chips, and a footer line "N of M points
   snapped".
7. **3D curve**: per-point provenance; `segment_lengths_m[]`, `segment_dz_m[]`; flag
   `segment_depth_jump` when |dz| > max(0.15 m, half the segment); the row stores
   `n_points`, `n_direct`, `n_knn`, `n_flagged` and the Z_ref polyline length of the same
   points as `cross_check_2d_m`; a curve with flagged segments is persisted and rendered
   `confidence = low` with the segment highlighted. Control points on the silhouette fall
   to KNN routinely (24–49 % of silhouette pixels fail the window rule on real frames) —
   expected, not an error. Rejection only via rule 5.
8. 2D rows never read per-pixel depth; endpoint depth is sampled as metadata only
   (`endpoint_dz_frac`, flagged above 10 %). Constants (`DEPTH_WINDOW = 5`, `KNN_K = 9`,
   `KNN_RING_EXCLUDE_PX = 2`, thresholds) are stamped into `session.json`.

### Frame candidate selection (contract C2, proposed 2026-10-10, reviewed)

1. Walk the bag with pyrealsense2 playback (`set_real_time(False)`); read index =
   0-based count of raw colour+depth pairs (RealSense frame numbers are not 0-based:
   colour span [25979, 26749] on bag 004 — record them too). Test the index against
   `sample_every` **before** align/copy (the parent aligns every frame and wastes 4 of 5:
   walk-only 5.1 ms/frame vs 10.4 with align). `sample_every` = 5, auto-raised to
   max(5, n_frames // 400) for long bags; stamped.
2. Per sampled pair: rgb8 → BGR once; YOLO per the contract; no detection → skipped with
   a reason.
3. `compute_mask_depth_stats` on the 2-px-eroded mask → `z_mean`, `z_median`, `z_var`
   (= mean((d − z_mean)²), **the operator's depth MSE**), `z_mad_mean`, `n_valid`,
   `n_total`; plus `mask_area_frac`, bbox aspect, completeness against `depth_valid_bbox`.
4. Hard filters: `rejection_reason == "ok"`; the camel not cut off by the image border
   (`mask_cut_by_frame`, `frame_margin_px` 1 — revised 2026-10-11, see below);
   `mask_area_frac` ∈ [0.10, 0.80] (parent MAF); **`z_mean ≥ 1.0 m` (operator's absolute
   floor)** and proposed `z_median ≥ 1.5 m` (A8); valid fraction ≥ 0.6. Every rejected
   frame is counted by reason in `candidates.json`. **Revision (D10, operator to
   confirm):** the original "no mask pixel within 8 px of the depth-valid region" rule
   rejected 155/155 sampled frames of bag 004 and the golden frame itself (the head sits in
   the 22 depth-less top rows); it is now the soft, visible flag `mask_in_depth_margin`
   (clicks there resolve by KNN with provenance), and the hard `mask_incomplete` again with
   `strict_depth_fov: true`.
5. Rank ascending by `z_var`; also record `rel_disp = z_mad / z_median` (same order,
   Spearman 0.965). Present the top M as an **unordered** grid (differences below ~15 %
   are frame-to-frame noise) with `z_median`, `rel_disp`, mask area, valid fraction and a
   bucket badge SIDE (w/h > 1.6) / END (< 1.3) / QUARTER; reserve ≥ 2 of M slots for the
   minority bucket when it qualifies (min-dispersion alone prefers side views). Temporal
   diversity 1.5 s computed on `read_index / 30` (bag timestamps contain duplicates).
6. Retention during the walk: full payload (rgb, depth, mask, intrinsics = 7.37 MB) for at
   most **one frame per 1.5 s bin**, replaced when a lower `z_var` arrives; every other
   sampled frame keeps a stats row only. RAM ≤ ceil(duration / 1.5) × 7.37 MB (bag 005
   ≈ 339 MB; hard cap 48 holders). Never re-fetch picks with `playback.seek()` (≈ 10 s per
   seek measured).
7. Persist: `M = 12` by default (≈ 59 MB per bag; fewer is a first-class partial result);
   per candidate `rgb.png`, `depth.npy` (float32 m), `mask.png`, `intrinsics.json`
   (+ distortion, `depth_valid_bbox`), `stats.json`, `thumb.jpg` (320×180);
   `candidates.json` with bag fingerprint, params, model sha256, `sample_every`,
   `n_sampled`, rejection + valid-fraction histograms. Cache key
   `bag_fingerprint = sha256(size ‖ mtime_ns ‖ first 1 MiB ‖ last 1 MiB)` at
   `<root>/candidates/<fingerprint>/<params_hash>/`; LRU purge above 2 GB.
8. Job API: `POST /candidates/jobs` → 202 `{job_id}`, one at a time (409), thread +
   `Event` cancel checked every frame, `pipe.stop()` in `finally`;
   `GET /candidates/jobs/{id}` → state, `progress_fraction` (`get_position / get_duration`),
   counters `{read, sampled, detected, passed, rejected_by_reason}`, `eta_s`; cancel
   endpoint; UI polls every 500 ms. Budget on this laptop: bag 005 ≈ 42 s warm / ≈ 50 s
   cold (walk ≈ 9 s, YOLO ≈ 20 s, stats + I/O the rest); warn when the first 200 MB read
   below 300 MB/s (removable media).
9. All image I/O via `cv2.imencode` + `Path.write_bytes` / `Path.read_bytes` +
   `cv2.imdecode` (`cv2.imwrite` / `cv2.imread` fail silently on non-ASCII Windows paths;
   Arabic folder names are realistic) — a grep test bans them; day-1 test runs the job on
   a bag under a folder named `اختبار`.

### Session, history, export (contract C3, proposed 2026-10-10, reviewed)

1. **Data root** is passed by the app (`--data-root`, absolute, writable; never a
   CWD-relative `runs/`, never Desktop/Documents/OneDrive — this machine has a OneDrive
   shadow of the parent repo). Layout `<root>/sessions/<id>/`, `<root>/candidates/…`,
   `<root>/comparisons/<id>/` (D12), `<root>/history.sqlite`, `<root>/recent.json`, `<root>/trash/`. Stamped into
   `session.json` and the manifest.
2. **Session** = one chosen candidate frame + operator measurements.
   `session_id = YYYYmmdd_HHMMSS_<6 hex>` (sortable, ASCII, no colon; the parent hit
   second-resolution id collisions); directory name = id; bag, read index and camel id are
   fields. The directory holds the frame assets copied from the candidate (≈ 4.9 MB),
   `session.json`, `overlay_v<N>.png`, `report_model.json`, `report_v<N>.pdf`,
   `report.manifest.json`. Create the directory and write `session.json` first, then
   insert the index row.
3. **History** `history.sqlite` (stdlib `sqlite3`) is a **derived, rebuildable index** of
   `sessions/*/session.json`, never authoritative: reconcile on startup and on every list
   (rows without a directory → "missing files", directories without a row → "unindexed",
   refresh by mtime). Single writer = the engine (uvicorn `--workers 1`); connection per
   request; `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`,
   `busy_timeout=5000`; Electron never opens the DB; backup via `Connection.backup()`. Index version 2 (D12, 2026-10-17) adds the `comparisons` and
   `comparison_members` tables (no foreign key to `sessions`: an `INSERT OR REPLACE` would cascade)
   and the sessions' `event`, `input_sha256`, `overlay_sha256`, `report_overlay_version`,
   `report_model_schema`; the migration adds the missing columns in one transaction and refreshes
   every row when the stored version is not 2 (also after a 1.0.0 engine ran on the root).
4. **Autosave**: the renderer keeps a monotonic `revision`; one save in flight, changes
   coalesced, 250 ms debounce, forced flush on blur / close / quit; the engine rejects
   `revision ≤ stored` with 409. Write = mkstemp → write → flush → `fsync` → `os.replace`
   with 3 retries on `PermissionError` (AV / OneDrive holds); final failure → 5xx and a
   persistent "unsaved" badge, never silent; stale `.session_*` temps purged after 1 h.
5. **Status**: `open` → finalize (overlay + report model frozen; manifest records sha256 of
   `session.json`, overlay and PDF) → `finalized` → export → `exported`. Any edit after
   finalize returns to `open` with `outputs_stale: true` and appends
   `{superseded_pdf, sha256, reopened_at}` to the manifest history; autosave is disabled
   while status ≠ `open`; outputs are versioned so an export never overwrites a file the
   viewer holds. Delete = close the viewer → rename the directory to `<root>/trash/<id>`
   → delete the row → purge trash on next startup; a failed rename stays visible as
   `delete_failed`.
6. **Schema**: `session.json` is written as `schema_version "2.1"`: curve_3d, KNN-derived
   endpoints and per-point provenance change the meaning of existing fields. The parent
   still reads 2.1 (its `from_dict` ignores unknown keys) but **must never re-save it**
   (its loaders whitelist keys and drop every new field); the engine refuses unknown
   versions. The vendored dataclasses add every new field to **both** `to_dict` and
   `from_dict`, with a round-trip contract test per class; frame-level provenance (the
   `z_ref` block, candidate stats, read index, model sha256) lives under
   `view_metadata[view_id]` and `library_versions`, the only containers the parent
   round-trips.
7. **Flow**: open/search bag → candidates grid → pick frame → measure freely (name each
   measurement) → autosave → History → export: finalize (overlay PNG, approve on it) →
   printToPDF in the app → engine attaches PNG + `session.json` (pypdf
   `PdfWriter.add_attachment`), probes (page count, attachment names + sha256, decoded
   page image == PNG pixels, every operator Arabic name in the text layer, an
   IBMPlexSansArabic subset among the fonts) → manifest → PDF reviewed in-app. Attachment
   failure keeps the PDF with `attachments_ok: false` + reason.

### Report = PDF (ADR-D7, accepted 2026-10-13; both halves implemented, the Electron side on 2026-10-12)

- Engine `POST /sessions/{id}/finalize` renders `overlay_vN.png` **once** (1280×(H+120)
  at dpi 100; IBM Plex Sans Arabic TTF from `nazeer_engine/assets/fonts`; matplotlib 3.11
  shapes with libraqm, so labels go in as logical Unicode with LRM/FSI…PDI isolates —
  `arabic_reshaper` + `python-bidi` only when libraqm is missing; HTTP 500
  `arabic_stack_missing` if the font or stack is missing — never an Arial fallback),
  writes `session.json` + `report_model_vN.json` atomically and returns the overlay
  sha256 in `outputs.overlay`.
- App: approve on that PNG; embed the same bytes in `print.html` (React + Tailwind,
  `@page { size: A4; margin: 12mm }`, Plex `@font-face`, `print-color-adjust: exact`,
  `page-break-inside: avoid` on the camel view and signature wells); await
  `document.fonts.ready` and every `img.decode()`; then
  `printToPDF({pageSize:'A4', printBackground:true, preferCSSPageSize:true, margins:{top:0,right:0,bottom:0,left:0}})`
  in a hidden window (`contextIsolation`, `sandbox`, fresh partition). Language
  (`ar | en | both`), rubric variant and names are explicit inputs, never `localStorage`.
- App POSTs the PDF bytes to `POST /sessions/{id}/report` (`X-Overlay-Sha256`); the
  engine attaches, probes and writes `report.manifest.json` (contract C3.7) and refuses
  the PDF on DRIFT (409, the rejected file kept as `report_vN.rejected_<UTC>.pdf`). PNG
  file bytes cannot survive inside a PDF container on any route, so this is the restated
  byte-identity guarantee.
- Every string in `SessionView.required_report_texts` (measurement names, judge /
  council / event, camel id) must be printed in an **embedded** Plex face: with only the
  Regular TTF embedded, a bold heading is a synthesized bold that Chromium emits as Type3
  glyphs whose text extracts in visual order — the probe fails `text_probe_failed` with
  the hint `synthesized_face` (measured with headless Edge, 2026-10-11). Embed each weight
  the page uses, or keep those strings regular.
- The page is rendered from one report model version (`outputs.report_model`); the upload
  names it with `X-Report-Model-Sha256`. Changing report inputs after printing writes a
  new model, so that print is refused (409 `report_model_mismatch`) — reprint.
- The generated PDF is the final review surface shown in-app; `--export <session_dir>`
  re-exports headlessly. Tests assert content (attachments, pixels, text, font names),
  never file bytes.
- **The comparison report (D12)** is sealed the same way, with an ordered pixel probe (image sizes
  read first; each camel's overlay matched by the SHA-256 of its RGB samples, on exactly one page,
  after the previous camel's), the text probe per camel section, every member's evidence attached
  (`m<NN>_<session>_overlay_vN.png`, `…_session.json`, `…_report_model_vN.json`) plus
  `comparison_model_vN.json`, and the member files re-checked after the probe. Measured with
  headless Edge (2026-10-17): 1.46 MB printed per camel; 20 camels seal in 6.8 s. Printed by the app
  (`print.html` in its comparison mode, D12 Stage 5): 20 camels = 45 pages, 27.8 MB printed, 52.7 MB
  sealed, 2.5 s to lay out and print, 6.1 s to seal; each print phase has a time limit (`print_timeout`).
- Rejected alternatives: reportlab in the engine (the parent's `render_pdf_report` uses
  Helvetica with no TTF registration and ignores curves; reportlab installed nowhere) and
  engine-side headless Chromium (a second Chromium on an offline laptop for no fidelity gain).

### Bag reader facts (probe on bag 004: 2.77 GB, 25.7 s, 771 frames)

Colour 1280×720 rgb8 @ 30 fps; depth 848×480 z16 @ 30 fps, depth units 0.001 m; depth
aligned to colour → 720×1280. Colour intrinsics fx 642.9, fy 641.93, cx 650.38,
cy 366.27, inverse Brown-Conrady `[-0.0536, 0.0636, -0.0011, 0.001, -0.0204]`. Raw aligned
depth holds 36–48 % zeros and 5–11 % of pixels beyond 5 m (max 27–48 m), which is why the
0.3–5.0 m band exists. The parent `extractor.py:424` labels the rgb8 payload as BGR —
that line is the colour-swap root cause; convert RGB→BGR once in the engine reader and
do not copy it.

## Reuse map — vendor from the parent, do not import it

The engine venv has no `camel_beauty`; copy what you need with its tests. Sources in
`E:\camel_beauty\`:

| Need | Copy from | Tests to port |
|---|---|---|
| `Intrinsics`, `backproject_pixel`, `distance_3d`, `distance_2d_image_plane`, `curve_length_2d`, `compute_mask_depth_stats`, `build_ground_band_mask`, `propagate_distance_uncertainty`, `angle_between_lines`, `angle_3point`, `angle_from_horizontal_2d`, `format_distance`, `generate_unique_colors` / `assign_color`, `_draw_ground_reference_cv2` (the live-view ground line — keep byte-equivalent), `find_arabic_font_path` (re-root: it resolves `parents[3]` = parent repo root) | `src/camel_beauty/four_view/measure.py` | `tests/test_phase21_v2_measure.py`, `tests/test_measure_2d_extensions.py`, `tests/test_mask_depth_stats.py`, `tests/test_measure_helpers.py` (also imports the report + overlay modules — split it) |
| `MeasurementSession`, `LineMeasurement`, `AngleMeasurement`, `CurveMeasurement`, `save_session` / `load_session` (atomic write) — extended per contract C3.6 | same file | same |
| History helpers: frozen-path resolution, unique ids, list query with count subquery, orphan finder, `delete_session` with counts, `Connection.backup()` | `src/camel_beauty/desktop/db.py`, `widgets/backup.py` | — (the parent History **page** is not a template: it has no reopen and its delete bypasses the cascade) |
| Overlay PNG: `render_session_overlay_figure`, `canonical_overlay_path` (operator-tuned label style: alpha 0.50 box, white stroke; ground line in red) | `src/camel_beauty/desktop/reporting/overlay_renderer.py` | `tests/test_measure_helpers.py`: `test_render_session_overlay_figure_metadata_counts`, `_empty_session`, `test_canonical_overlay_path_deterministic`, `test_overlay_figure_renders_curve_branch` |
| Candidate-walk precedent: cooperative cancel polled every frame, `pipe.stop()` in `finally`, MAF bounds, completeness margin, bucket thresholds, 1.5 s greedy guard | `src/camel_beauty/four_view/extractor.py` | `tests/test_phase21_v2_extractor.py` (stub-injected) |
| Report **content spec only** (sections: header/seal, session rows, measurements table, camel view, Mjaheem + Maghateer rubric, 27 regions, observations, Judge + Council wells, footer stamp) | `src/camel_beauty/desktop/reporting/templates/notebook_report_template.html` (1,745 lines; lines 1200–1203 are ≈ 2.9 MB of sample camel PNGs — drop them; the four Plex woff2 faces are ≈ 94 KB) | `tests/test_phase21_v2_report.py` shows the row assertions but does not collect (stale `measure_app` import) |
| SHA-256 PNG↔embed probe (pattern to restate for PDF) | `runs/html_iterations/export_cell_v3_replacement.py:393-409` (also `_patch_v4.py:568-578`, `COWORK.md` §6d) — an export-cell step, not library code | — |
| Arabic font / logos | `src/camel_beauty/desktop/assets/fonts/IBMPlexSansArabic-Regular.ttf` (236,708 B, OFL-1.1), `Nazeer/assets/logos/` | — |
| Judges' rubric | `docs/references/كتاب الابل.pdf` (+ `كتاب_الإبل_2.md`) | — |

Vendoring hazards (all verified): `overlay_renderer._ensure_locale_stack` runs
`pip install` at render time (lines 23–50) — delete it and pin `arabic-reshaper` (MIT) +
`python-bidi` (LGPL) + `pypdf` (BSD-3) in `requirements.txt`; the renderer imports
`format_distance` from `camel_beauty.four_view.measure` (line 112) — rewire;
`canonical_overlay_path` defaults to a CWD-relative path — make it absolute; add
`curve_3d`, KNN-marker and flag-chip branches. Do **not** vendor
`extractor._build_default_yolo_callable` (no `retina_masks`, nearest-resized low-res
mask — the exact path the model card rejects), the parent's `runs/`-relative output
paths, the 3D reconstruction, or anything PyQt.

## Engineering rules carried over

- **Honesty contract (parent ADR-001).** Every stage declares what it rejects and how. A
  rejection is `null` + a non-empty `rejection_reason`, never a degraded number, never a
  sentinel. A fallback (KNN depth) is recorded with its provenance and shown to the judge,
  never applied silently.
- **Four-state honesty when reporting work:** code state → unit-tested →
  integration-tested (real bag, real model) → production-validated. "Shipped" needs at
  least integration-tested; say which state a thing is in.
- **Library-version stamp** in every session, report model and manifest: python, numpy,
  opencv-python, scipy, ultralytics, pyrealsense2 (from pip metadata — the module has no
  `__version__`), torch, matplotlib, arabic_reshaper, python_bidi, pypdf, electron,
  chromium, app version, model sha256, data root. The parent's `_versions.py` captures
  only four libraries plus python/platform.
- **Semantically named functions get adversarial tests** (`distance_2d_image_plane` has
  no dz term; `curve_length_3d` changes with depth; `curve_length_2d` does not read it;
  `depth_for_pixel` on an outside-mask click returns a different `source` than inside).
- **No network at runtime:** no pip at import, no CDN Tailwind, no font fetch.
- **The live editing canvas is never an approval surface:** approve on the engine PNG,
  sign off on the PDF.
- **Python style:** `from __future__ import annotations`, ruff line length 100, double
  quotes, target py311 (`ruff check` + `ruff format` clean; config in
  `engine/pyproject.toml`). The venv was built with cp311 wheels; other interpreters are
  untested. Never type `\u` escapes for bidi control characters into source (they become
  the invisible character); build them with `chr()` — a test bans invisible controls.

## Data and artefacts (never commit)

`data/.bag/` (≈ 36 GB incl. the `new/` duplicate; copies of `../data/.bag` — don't make
more), `engine/.venv/`, `engine/models/*.pt`, `app/node_modules/`, `app/dist*/` (incl. `dist-engine/`, the staged engine), `app/release/` (installer, unpacked app), `app/.cache/` (python.org zip, staging logs),
`engine/build/`, `engine/dist/` (unused: PyInstaller was rejected, D11), `runs/` (dev data root: sessions,
candidates, overlays, PDFs, manifests, history DB). The parent's `.gitignore` covers
none of `node_modules/`, this directory's `*.pt` or `runs/`; the local `.gitignore` is
load-bearing. The model card, `metrics.json` and `results.csv` stay tracked.

## Pitfalls

- **Windows Smart App Control can block unsigned engine DLLs, intermittently** (D11): on 2026-10-12, in
  enforcement, it blocked `pyrealsense2` and matplotlib's `_c_internal_utils` from 12:40 to 13:13 ("An Application
  Control policy has blocked this file"), then allowed them again (reputation lookups); while blocked the engine starts but cannot open a bag or draw
  the overlay (since Stage A1 the stack then reports missing). On 2026-10-13 it blocked `pydantic_core`'s DLL from
  16:33 to 18:33: `--check` still passed (it returns before FastAPI is imported) but the sidecar could not serve, so
  no app, e2e or API test could run for two hours. Check
  `HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy` `VerifiedAndReputablePolicyState` (1 = on).
  In Stage B (D11) the unsigned installer, the rebranded app exe and the bundled engine ran here without a
  block (24-check install-and-run smoke), but they were built on this laptop and carry no Mark of the Web;
  once, polars' runtime DLL was blocked in the staging folder (the engine never loads polars).
  Turning it off cannot be undone without resetting Windows: an operator decision (also for the
  field laptop and the packaged engine). **Since 2026-10-18 Windows Sandbox enforces it too**
  (state 1; it was 2, evaluation, through 2026-10-14; this laptop's build 26100.9711): the unsigned
  installer, 1.0.0 included, is refused at its start, so `npm run check:sandbox` cannot pass until
  the installer is signed (D11 "Release 1.1.0"). Never change the setting on this laptop or in the
  Sandbox without the operator.

- **Old numbers are suspect.** The parent notebook path fed channel-swapped colours and
  the padding-squeezed mask (22 px ground-row shift). Its measurements are not regression
  oracles; use the golden-frame table.
- **Parent docs disagree with the card.** README §3.3 calls the notebook-compat mask
  canonical and makes 3D primary with 2D fallback. For this engine the model card wins
  and the operator picks the kind.
- **CPU-only engine.** ~47 ms/frame is the shipping assumption. If GPU is wanted, install
  the cu128 torch build into `engine/.venv`, re-pin, and re-run the probes.
- **Mask edges drive every number.** Z_ref, the ground line and KNN neighbours all come
  from the mask; the boundary ring carries misaligned background depth (0.26–0.30 m
  errors under a hoof on real frames), which is why Z_ref and the KNN tree use the 2-px
  eroded mask. Handlers, ropes and a second camel can merge into the mask. Hence the
  mandatory operator review.
- **Arabic in the PDF:** `printToPDF` before `document.fonts.ready` captures a fallback
  face; `printToPDF` defaults are Letter, no backgrounds, scaled-to-fit, 1 cm margins — all
  overridden; the parent template's load script picks the language from `localStorage`
  and hides the other — pin the language explicitly. A synthesized bold / italic face
  makes names unsearchable (Type3 glyphs, visual-order text): embed every weight used.
  Bidi on the page (measured in the real-run PDF): give each half of a bilingual label its
  own isolate (`dir="rtl"` / `dir="ltr"`), operator text `dir="auto"` / `<bdi>` (an English
  note starting with a digit is reordered otherwise); engine Arabic labels ending in a Latin
  fragment (`… Z_ref (> 10 %)`) lose their closing parenthesis in an RTL line unless that
  fragment is isolated: the app wraps every Latin run of an Arabic string in an LTR `<bdi>` at
  render time (`app/src/renderer/lib/bidi.tsx`, characters unchanged; verified in the UI,
  2026-10-11). An engine-side LRI…PDI in `labels.py` (built with `chr()`) would no longer be
  needed for the app, only for other consumers of the label strings.
- **App source never contains invisible characters** (bidi controls, zero-width marks,
  no-break spaces): build them with `String.fromCharCode`; `app/src/shared/no-invisible-chars.test.ts`
  fails otherwise. Tailwind v4's built-in `rtl:` variant also matches LTR islands inside an
  RTL page; the app redefines `rtl:`/`ltr:` from `:dir()` (`design/tokens.css`).
- **Right-to-left pages and image space:** pdf.js draws glyphs with canvas text, whose direction is
  inherited from the `<canvas>`; inside the Arabic page every glyph shifted by its own width
  (garbled PDF) until the canvas got `dir="ltr"` (D9, Stage 3). A Windows path with an Arabic
  folder name is reordered even inside an LTR isolate (the digits after the Arabic name join its
  run); `PathText` isolates each segment.
- **Arabic in the overlay:** matplotlib 3.11 already shapes and reorders with libraqm;
  feeding it `arabic_reshaper` + `get_display` output reverses the text (double bidi).
- **Sidecar PID:** a venv `python.exe` on Windows is a launcher that runs the real
  interpreter as a child, so the PID Electron holds is not the engine's; identify the
  engine by the ready line's `pid` (also in `engine.lock` and `/health`), stop it via
  `POST /system/shutdown` or by killing the spawned process (the launcher's job object
  takes the child with it).
- **Real-resource tests are opt-in** (`NAZEER_REAL=1` or `-m realbag` etc.); a test
  marked `realbag` and `realmodel` needs both names in `-m`. The real flow hard-links bag
  004 under `runs\اختبار\` (same volume, removed afterwards) — librealsense 2.57 opens
  non-ASCII paths directly (8.3 short names are disabled on drive E:).
- **Runs that drive a visible window get the user's own input:** a CDP-driven `npm run dev` walk or
  the Windows Sandbox run receives the real mouse and keyboard (the measuring canvas shares one
  crosshair between them, by design), so a keyboard-placed point can land under the user's pointer
  (Stage 8, D9). Keep exact-position checks in the Playwright e2e specs; say before a long visible
  run that the window should be left alone.
- **Paths:** `cv2.imwrite`/`imread` fail silently on non-ASCII Windows paths; the parent's
  four-view page writes to a CWD-relative `runs/` (lost or scattered sessions under
  Electron's spawn cwd or a read-only install dir); `playback.seek()` costs ≈ 10 s.
- **Tooling skew:** as of 2026-10-10 electron-vite 5.0 accepts vite ^5–^7 while vite is
  at 8.x — pin vite 7.x if electron-vite is used, or use plain Vite + electron scripts.
- **Session API edges in the vendored code:** `add_angle` on two `distance_2d` lines
  TypeErrors (`p*_3d` None passes `is_valid`); `display_color` is persisted only on
  curves; `add_curve_2d` stores non-finite z and NaN segments; `angle_between_lines` says
  "acute" but returns [0, 180]; `propagate_distance_uncertainty` ignores `K`;
  `backproject_pixel`'s 30 % rule divides by the nominal 25 even when border-clipped;
  `z_mad` is the mean absolute deviation about the mean, not a robust MAD.
- **191 training photos, none from the D455, all of one light-brown camel.** Expect
  failures in new venues, dusk, dust, partial views and dark Mjaheem coats (IR return and
  valid depth drop; untested); the field check (≥ 30 labelled D455 frames) is open.
- **Licences:** Ultralytics AGPL-3.0 (D6), python-bidi LGPL, IBM Plex OFL-1.1 — one
  counsel pass. Training-photo provenance unknown (card §9).
- **Model file name.** The card says `body_seg_v3_best.pt`; the file is still `best.pt`.
  The hash identifies it — rename when D1 is closed and update the card's status line.

## Decisions

`docs/decisions/README.md` indexes D1–D12 (D11: offline licence keys and the Windows installer, accepted 2026-10-12; D12: "Save as" and the comparison report, proposed 2026-10-17, implemented). D1 (checkpoint: `best.pt` recommended, hash
already matches) and D6 (licence; still open, with one evaluation delivery to a client under the
operator's responsibility on 2026-10-14 and a permanent-key delivery of release 1.1.0 on 2026-10-18) are drafted from the model card; D2–D5 are implied by
the card's numbering gap and never referenced — operator to fill. D7 PDF route
(Electron printToPDF; engine = rendering authority; **accepted 2026-10-13** after Stage 7), D8
measurement types + depth provenance (contract C1, **reviewed, parameters proposed**),
D9 app stack (Tailwind; offline rule) and D10 frame candidates + session/history flow
(contracts C2/C3, **reviewed, parameters proposed**) are drafted 2026-10-10. D7, D8 and
D10 gained "Engine parameters (implemented 2026-10-11)" sections, updated after an
adversarial review of the engine (24 findings fixed: report-model versioning, strict
probes, the 1.5 s pick gap, cluster sizes, autosave semantics, robustness); the one open
change for the operator is D10's C2.4 completeness revision. Record a decision there
before coding against it.
