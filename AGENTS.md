# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project

**Nazeer Desktop** (نَظِيرْ) — non-contact camel body measurement for Mzayen camel-beauty
judging as a standalone desktop product: an **Electron + React + TypeScript + Tailwind
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

Scaffolded 2026-10-04 inside the `camel_beauty` repo (`E:\camel_beauty`, git `main`);
meant to become its own repository. The parent's `AGENTS.md` (≈ 600 lines) holds the
history (Phases 1–21, ADR-001 honesty contract, audit disciplines D7/D8/D9); read it for
*why*. Nothing here imports the parent package.

## State of the scaffold (2026-10-10)

| Path | What is there |
|---|---|
| `app/` | **empty** — Electron + Vite + React + TypeScript + Tailwind CSS is the chosen stack; nothing scaffolded |
| `engine/` | `.venv` (Python 3.11.9, **CPU-only torch 2.14.1**) + `requirements.txt` (52 lines, UTF-8 BOM) + `models/`; **no engine source yet**; no reportlab / arabic-reshaper / python-bidi / pypdf |
| `engine/models/` | `best.pt` (pinned, below), `last.pt` (alternative), `MODEL_CARD.md`, `metrics.json`, `results.csv` |
| `data/.bag/` | 6 D455 recordings (33.5 GB, copies of `../data/.bag`) + `new/` (a duplicate of bag 004) — gitignored |
| `docs/decisions/` | ADR records D1–D10 (directory was empty until this pass) |
| `fixtures/` | **empty** — intended home of the golden frame (below) |
| `engine/wheels/` | intended offline wheelhouse for the pinned Python deps (not created; see Decisions) |

When `app/package.json` or the engine package lands, replace the "intended" commands
below with the real ones in the same commit.

## Commands

```powershell
# --- Engine environment (exists today). Always use the venv path: bare `python` may be 3.13/3.14.
engine\.venv\Scripts\python.exe --version                       # Python 3.11.9
engine\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"
#   → 2.14.1+cpu False   (GPU inference exists only in the parent's .venv-cuda; see Pitfalls)
engine\.venv\Scripts\python.exe -m pytest engine -q             # no tests yet; NOTE: inherits the PARENT
#   pyproject (rootdir E:\camel_beauty, --strict-markers, testpaths=tests) until engine/ has its own config
# Recreate the venv — UNPROVEN offline: requirements.txt pins torch==2.14.1 without +cpu or an index URL,
# so add the CPU index (or a +cpu pin) before trusting this:
py -3.11 -m venv engine\.venv
engine\.venv\Scripts\python.exe -m pip install -r engine\requirements.txt

# --- Model integrity (the engine must refuse to load on mismatch)
Get-FileHash engine\models\best.pt -Algorithm SHA256
#   → 0E9EE2BAADA7C70531B66E0B98F7E1CF4DCF3CE7971C55BCE69A7270EC3A4320

# --- Intended, once the engine package exists (fill in the real module path; one worker, data root from the app)
engine\.venv\Scripts\python.exe -m uvicorn <engine_module>:app --host 127.0.0.1 --port <port> --workers 1
#   the app passes --data-root <absolute, writable dir>; the engine refuses to start without it

# --- Intended, once app/ is scaffolded (Electron + Vite + React + TS + Tailwind via @tailwindcss/vite; Node 24 / npm 11)
cd app; npm install
npm run dev            # Electron + Vite dev loop, spawns the engine sidecar with --data-root
npm run build          # packaged app (electron-builder) with the engine as extraResources
npm test               # renderer/unit tests (print-page composition, hashing)
npm run e2e            # one Playwright-Electron export test (golden session → PDF → probe)
npm run export -- <session_dir>   # headless re-export (hidden window), no interactive UI

# --- Re-run the evidence probes behind MODEL_CARD.md (parent repo, parent GPU venv)
cd E:\camel_beauty
.venv-cuda\Scripts\python.exe runs\electron_mvp_probe\probe_seg_contract.py   # puts parent src/ on sys.path itself
.venv-cuda\Scripts\python.exe runs\electron_mvp_probe\probe_color_order.py
.venv-cuda\Scripts\python.exe runs\electron_mvp_probe\probe_cpu_retina.py
.venv-cuda\Scripts\python.exe runs\electron_mvp_probe\probe_bag_timing.py
```

## Architecture (intended; only the engine venv + model exist)

- **`app/` — Electron + Vite + React + TypeScript + Tailwind CSS.** Owns the operator UI:
  bag discovery (OS file dialog filtered to `.bag`, a recent list, an optional bounded
  scan of configured capture folders — the renderer only ever passes a path to the
  engine, never reads the multi-GB bag), the candidate grid, the editing canvas for the
  measurement kinds (the canvas is **never an approval surface**), the review of the
  engine's `overlay.png` (SHA-256 recomputed with WebCrypto and compared with the
  engine's stamp; mismatch is a hard error), History, the `print.html` Vite entry printed
  with `webContents.printToPDF` in a hidden window, and the in-app PDF viewer (bundled
  pdf.js) used for final sign-off. Resolves `DATA_ROOT = app.getPath("userData")` (dev:
  `--data-root`) and spawns/supervises the engine sidecar on `127.0.0.1` with it.
- **`engine/` — Python 3.11 FastAPI service, one worker.** Owns everything that touches
  numpy: bag walking (pyrealsense2), YOLO inference (model loaded + warmed at startup),
  candidate ranking as a cancellable background job, Z_ref and ground line, depth lookup
  with KNN fallback, the measurement math, session persistence + the derived history
  index, the overlay PNG (single rendering authority) and the report model; after export
  it owns the evidence post-processing (pypdf attachment, probe, manifest). It does
  **not** typeset the document. Must stay importable without open3d / PyQt / pyvista.
- **Model** — one pinned checkpoint, hash-checked at load. Everything the operator sees
  traces back to one known model.

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
| Depth FOV | the aligned depth map does not cover the whole colour frame (~32 px left, 8–18 px right, 18–46 px top have no depth); store `depth_valid_bbox` per frame | completeness and KNN provenance are judged against it |
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
is the robust key. Z_ref on that frame ≈ 1.93 m. A frame regenerated from the bag has
**not yet** been shown to reproduce 269,033 px — run that once and record it. `fixtures/`
is empty: regenerate the frame from the bag with the engine's own reader.

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
4. Hard filters: `rejection_reason == "ok"`; mask complete (no mask pixel within 8 px of
   the depth-valid region's edge); `mask_area_frac` ∈ [0.10, 0.80] (parent MAF);
   **`z_mean ≥ 1.0 m` (operator's absolute floor)** and proposed `z_median ≥ 1.5 m` (A8);
   valid fraction ≥ 0.6. Every rejected frame is counted by reason in `candidates.json`.
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
   `<root>/history.sqlite`, `<root>/recent.json`, `<root>/trash/`. Stamped into
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
   `busy_timeout=5000`; Electron never opens the DB; backup via `Connection.backup()`.
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

### Report = PDF (ADR-D7, proposed pending a half-day spike)

- Engine `POST /sessions/{id}/finalize` renders `overlay.png` **once** (fixed figsize/dpi;
  IBM Plex Sans Arabic TTF from an engine asset dir; `arabic_reshaper` configured from
  the TTF + `python-bidi`; HTTP 500 if the font or locale stack is missing — never an
  Arial fallback), writes `session.json` + `report_model.json` atomically and returns
  `overlay_png_sha256`.
- App: approve on that PNG; embed the same bytes in `print.html` (React + Tailwind,
  `@page { size: A4; margin: 12mm }`, Plex `@font-face`, `print-color-adjust: exact`,
  `page-break-inside: avoid` on the camel view and signature wells); await
  `document.fonts.ready` and every `img.decode()`; then
  `printToPDF({pageSize:'A4', printBackground:true, preferCSSPageSize:true, margins:{top:0,right:0,bottom:0,left:0}})`
  in a hidden window (`contextIsolation`, `sandbox`, fresh partition). Language
  (`ar | en | both`), rubric variant and names are explicit inputs, never `localStorage`.
- App POSTs the PDF bytes to `POST /sessions/{id}/report/finalize`; the engine attaches,
  probes and writes `report.manifest.json` (contract C3.7) and refuses the PDF on DRIFT.
  PNG file bytes cannot survive inside a PDF container on any route, so this is the
  restated byte-identity guarantee.
- The generated PDF is the final review surface shown in-app; `--export <session_dir>`
  re-exports headlessly. Tests assert content (attachments, pixels, text, font names),
  never file bytes.
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
  quotes, target py311 (add ruff to the engine dev deps; not in the venv yet). The venv
  was built with cp311 wheels; other interpreters are untested.

## Data and artefacts (never commit)

`data/.bag/` (≈ 36 GB incl. the `new/` duplicate; copies of `../data/.bag` — don't make
more), `engine/.venv/`, `engine/models/*.pt`, `app/node_modules/`, `app/dist*/`,
`engine/build/`, `engine/dist/` (PyInstaller), `runs/` (dev data root: sessions,
candidates, overlays, PDFs, manifests, history DB). The parent's `.gitignore` covers
none of `node_modules/`, this directory's `*.pt` or `runs/`; the local `.gitignore` is
load-bearing. The model card, `metrics.json` and `results.csv` stay tracked.

## Pitfalls

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
  and hides the other — pin the language explicitly.
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

`docs/decisions/README.md` indexes D1–D10. D1 (checkpoint: `best.pt` recommended, hash
already matches) and D6 (licence) are drafted from the model card; D2–D5 are implied by
the card's numbering gap and never referenced — operator to fill. D7 PDF route
(Electron printToPDF; engine = rendering authority; **proposed pending the spike**), D8
measurement types + depth provenance (contract C1, **reviewed, parameters proposed**),
D9 app stack (Tailwind; offline rule) and D10 frame candidates + session/history flow
(contracts C2/C3, **reviewed, parameters proposed**) are drafted 2026-10-10. Record a
decision there before coding against it.
