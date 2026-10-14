# Nazeer Desktop (نظير)

Non-contact camel body measurement for Mzayen camel-beauty judging. Nazeer Desktop is a
Windows desktop app. It reads an Intel RealSense D455 recording (`.bag`), proposes the best
frames of the camel, and lets the judge measure on the chosen frame. It then produces a sealed,
bilingual Arabic/English PDF report.

It runs fully offline. There is no cloud service, no CDN, no font download and no package
installation at runtime.

The app measures what the judge draws. It never scores beauty or ranks camels.

> **Version 1.0.0** (2026-10-14). Status: **integration-tested** on real recordings with the
> real model, and the installer has been checked on a clean Windows image (Windows Sandbox).
> **Not production-validated**: the installer is unsigned, and the app has not yet been run
> on the field laptop or on a field capture.

---

## What the operator does

1. **Open a recording.** Pick a D455 `.bag` file with the file dialog, from the recent list,
   or from a scan of the capture folders.
2. **Choose a frame.** The engine walks the recording, finds the camel in each sampled frame
   (YOLO11n segmentation) and proposes up to 12 frames, ranked by how even the depth is over
   the camel's body. The operator picks one.
3. **Measure.** The operator names each measurement and draws it on the frame, with the
   mouse or with a keyboard crosshair. There are eight kinds:

   | Kind | How it is computed |
   |---|---|
   | 2D distance | in the camel's reference plane (Z_ref, the median depth of the camel) |
   | 3D distance | from the depth at each end point |
   | 2D curve | a polyline in the reference plane |
   | 3D curve | a polyline through the depth at each control point |
   | Angles | 3 points in 2D or 3D, from the horizontal, or between two lines |

   The operator always picks the kind. Nothing falls back from 3D to 2D. When a point has no
   direct depth, the app takes it from the nearest points on the camel's body (KNN), shows
   that on screen and prints it in the report. A value that cannot be measured is rejected
   with a reason; it is never replaced by a guess.
4. **Save and come back.** Every change is saved automatically. Each session appears in
   **History**, where it can be reopened, continued, inspected or deleted.
5. **Report.** The engine draws the final measurement image once; the operator approves that
   image. The app then prints the report to PDF (Arabic, English, or both). The engine attaches
   the image and the session data to the PDF, checks the PDF's pixels, text and fonts, and
   seals it. The operator signs off on the PDF inside the app.

## Installing (for operators)

- **Requires:** Windows 10 or 11, 64-bit. The installer is about 330 MB and needs about
  2.6 GB free in `%TEMP%` while it installs. Windows "N" editions need the Media Feature Pack.
- **Install:** run `Nazeer Desktop Setup 1.0.0.exe`. The installer is in Arabic or English and
  can install for the current user (default) or for all users. It is **not code-signed yet**,
  so Windows SmartScreen shows an "unrecognized app" warning (More info, then Run anyway). On
  a PC with Smart App Control turned on, an unsigned app may be blocked.
- **Activate:** on first start the app asks for a licence key. It is checked on the computer
  itself, with no internet. A trial key stops working on its expiry date; a permanent key never
  asks again. A key can be replaced later from the **About** screen.
- **Where the data lives:** `%APPDATA%\Nazeer Desktop\`. Each session is a folder under
  `sessions\<session id>\` (the id starts with the UTC date and time). It holds the frame,
  `session.json`, the approved image and the reports `report_v1.pdf`, `report_v2.pdf`, …
  A file named `report_vN.rejected_….pdf` is a print the engine refused. Copy the PDFs
  unchanged: they carry their attachments, and the manifest records their SHA-256.
  Uninstalling keeps this folder.

## How it is built

```
.bag ─► engine: read the recording, find the camel, rank the frames ─► app: the operator picks a frame
     ─► engine: reference depth, ground line, depth for every point (direct, else KNN)
     ─► app: the operator draws named measurements (an editing view, never the approval surface)
     ─► engine: computes every value, saves the session, draws the measurement image once
     ─► app: approve on that image ─► print page ─► Electron printToPDF
     ─► engine: attaches the image and the session to the PDF, checks it, writes the manifest
     ─► bilingual PDF, reviewed in the app before signing
```

| Part | Technology | Role |
|---|---|---|
| `app/` | Electron 44, electron-vite 5 (Vite 7), React 19, Redux Toolkit, Tailwind CSS v4, TypeScript 5.9 | The operator UI, the engine's supervisor, licence keys, printing to PDF, the installer |
| `engine/` | Python 3.11, FastAPI, pyrealsense2, Ultralytics YOLO (CPU), NumPy/SciPy, matplotlib, pypdf | Reading recordings, segmentation, depth, the measurement maths, sessions and History, the measurement image, sealing the PDF |
| `engine/models/` | one pinned checkpoint, `best.pt` | checked against its SHA-256 at every start (see `MODEL_CARD.md`) |

The app starts the engine as a local process on `127.0.0.1` with a fresh token at each start,
and talks to it over HTTP. The engine's API (31 operations) is described in
`engine/openapi.json`; the app's client types are generated from it. The report font is IBM
Plex Sans Arabic, bundled with the app.

## Repository layout

| Path | What is there |
|---|---|
| `app/` | the Electron app (`src/main`, `src/preload`, `src/renderer`, `src/print`, `src/shared`), its tests, the end-to-end specs (`e2e/`), build scripts (`scripts/`) and installer resources (`build/`) |
| `engine/` | the Python engine (`nazeer_engine/`), its tests, `tools/real_run.py` (the real-recording check), `openapi.json` |
| `tools/generate-license.mjs` | the licence-key generator (vendor machine only, never packaged) |
| `docs/decisions/` | decision records D1–D11 (start with `README.md`) |
| `docs/arabic-wording-backlog.md` | the app's Arabic wording, its reviews and open suggestions |
| `fixtures/golden_frame.json` | the reference frame used to test the engine against a real recording |
| `CLAUDE.md` | the full developer guide: contracts, commands, architecture, pitfalls |

Not in git: the recordings (`data/`), the model weights (`engine/models/*.pt`), the Python
environment (`engine/.venv/`), `app/node_modules/`, build output (`app/out/`, `app/dist-engine/`,
`app/release/`) and run data (`runs/`).

## Development

Requirements: Windows, Node 24 (≥ 24.15) with npm 11, Python 3.11 (`py -3.11`), and the
model file `engine/models/best.pt`.

```powershell
# Engine: create the environment once (needs the network once; CPU-only PyTorch)
py -3.11 -m venv engine\.venv
engine\.venv\Scripts\python.exe -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r engine\requirements.txt -r engine\requirements-dev.txt

# App
cd app
npm install          # exact pinned versions; also fetches the checksum-pinned Electron binary
npm run dev          # the app with hot reload, plus its engine on ..\runs\dev_root
```

Always call the engine's Python as `engine\.venv\Scripts\python.exe`; a bare `python` may be a
different version.

### Checks

```powershell
# Engine (from engine\)
.venv\Scripts\python.exe -m pytest -q                       # ≈ 440 tests, about a minute
.venv\Scripts\python.exe -m ruff check . ; .venv\Scripts\python.exe -m ruff format --check .
.venv\Scripts\python.exe tools\real_run.py                  # the whole flow on a real recording

# App (from app\)
npm run typecheck ; npm run lint ; npm run format:check
npm test                                                    # Vitest unit and component tests
npm run e2e                                                 # Playwright on the built app
$env:NAZEER_REAL = "1"; npm run e2e                         # adds the full flow on a real recording and the real model
```

After any change to the engine's API, regenerate `engine/openapi.json`
(`python -m nazeer_engine --dump-openapi openapi.json`) and the app's types (`npm run gen:api`);
tests fail when either drifts.

### Building the installer

```powershell
cd app
npm run dist                                    # release\Nazeer Desktop Setup <version>.exe
npm run smoke:packaged -- --move-profile-aside  # install, activate, run, relaunch, uninstall
npm run check:sandbox                           # the clean-PC checklist in Windows Sandbox
```

`npm run dist` builds the app, stages the engine as an embedded CPython 3.11 with its runtime
packages and the model (`npm run stage:engine`), and packages an NSIS installer with
electron-builder. The installer is unsigned.

### Licence keys

Keys are Ed25519-signed and verified offline (decision D11). The generator runs on the
vendor's machine only:

```powershell
node tools/generate-license.mjs --init                  # once: create the key pair, write the app's public key
node tools/generate-license.mjs --days 7                # a 7-day trial key
node tools/generate-license.mjs --customer "Name"       # a permanent key
```

The private key lives in `%USERPROFILE%\.nazeer-license\`. It must never enter a repository
(the generator refuses repository folders) and should be backed up. Losing it means a new key
pair, a rebuild, and new keys for every client.

## Engineering rules

- **Honest values.** A rejected measurement is empty with a reason, never a degraded number.
  Every depth fallback is recorded and shown to the judge.
- **One rendering authority.** The engine draws the measurement image; the judge approves on
  that image and signs off on the PDF, never on the live editing canvas.
- **Offline.** Nothing is fetched at runtime.
- **Status words.** Work is described as code state, unit-tested, integration-tested (real
  recording, real model) or production-validated.

Decisions are recorded in `docs/decisions/` before code is written against them.

## Open items

- Code signing, and Smart App Control on the field laptop.
- A field check on the field laptop with new D455 captures; the model was trained on 191
  photos of one camel, none taken with the D455.
- The model licence (Ultralytics, AGPL-3.0; decision D6) is still open. Version 1.0.0 was
  delivered to one client as an evaluation under the operator's responsibility.
- Open report questions (D7): signatures, one PDF per language, PDF/A, the scoring-form heading.
- The frame-completeness rule revised on real recordings (D10, C2.4) awaits confirmation.

## Licences

This repository is private; no licence is granted. Third-party components include Ultralytics
YOLO (AGPL-3.0), python-bidi (LGPL), IBM Plex Sans Arabic (SIL OFL 1.1), Electron and the npm
and Python packages pinned in `app/package-lock.json` and `engine/requirements.txt`.
