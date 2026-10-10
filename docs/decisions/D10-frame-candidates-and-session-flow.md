# D10 — Frame candidates, session, history and export flow

Status: accepted 2026-10-10 (the five-step flow and the candidate metric, operator) ·
proposed 2026-10-10, reviewed by a 3-skeptic read-only pass (contract C2/C3 parameters).

## Context

Operator flow: (1) search for / open the bag directly; (2) the app loads the best frame
candidates, selected by mask statistics — depth is the metric: minimum MSE of depth about
the mask-mean depth, mean depth at least 1 m from the camera; (3) pick a frame, measure
freely, name each measurement; (4) sessions saved to history to continue or inspect any
camel frame; (5) export finished sessions to a PDF with all details.

Review evidence: `compute_mask_depth_stats.z_var` is exactly the MSE about the mask mean
(`np.var`, ddof 0; pinned by tests). Simulated on the parent's sweep of 1,817 every-5th
frames of all six bags (`E:\camel_beauty\runs\frame_quality_sweep\v2_2026_05_14\frames_all.csv`),
the drafted filters (z_mean ≥ 1.0 m, valid fraction ≥ 0.5) picked cropped close-ups: 7 of
the top 8 touch the frame edge and the #1 pick is a 1.04 m partial view. The metric itself
does not prefer far or small camels (Spearman z_var vs mask area −0.51); it prefers close,
wide, side-ish masks. Retaining full payloads for every passing frame would cost up to
3.07 GB RAM on bag 005; `playback.seek()` costs ≈ 10 s per call with the pinned
pyrealsense2. The parent aligns every frame before deciding whether it is sampled (walk-only
5.1 ms/frame vs 10.4 ms with align). The parent's four-view page writes to a CWD-relative
`runs/`; its session ids had second-resolution collisions; its loaders whitelist keys on
load, so "additive" fields are dropped on re-save.

## Decision

Contracts C2 and C3 as written in `CLAUDE.md`. Highlights:

- Candidates: every-N-th aligned pair (N = 5, auto-raised for long bags), YOLO per the model
  card, stats on the 2-px-eroded mask; hard filters = detection ok, mask complete against the
  depth-valid bbox (8 px), mask area ∈ [0.10, 0.80], **z_mean ≥ 1.0 m (operator)** plus
  proposed z_median ≥ 1.5 m, valid fraction ≥ 0.6; rank ascending z_var (the operator's
  metric); top M = 12 shown as an unordered grid with bucket badges and ≥ 2 slots reserved
  for the minority bucket; 1.5 s temporal diversity on read index; one payload holder per
  1.5 s bin during the walk; cancellable background job with progress; cache by bag
  fingerprint (size ‖ mtime ‖ first/last MiB); image I/O via imencode/imdecode (non-ASCII
  paths).
- Session: `<root>/sessions/<YYYYmmdd_HHMMSS_<6 hex>>/` with copied frame assets,
  `session.json` (schema **2.1**), versioned overlay/report outputs and a manifest; the
  directory is written before the index row.
- History: `history.sqlite` as a derived, rebuildable index (reconcile on list; WAL;
  connection per request; the engine is the single writer, uvicorn workers = 1; Electron
  never opens it).
- Autosave: revision-ordered, debounced, fsync + retries, visible failure; status machine
  open → finalized → exported with `outputs_stale` on re-edit and trash-rename delete.
- Export: finalize → approve on the engine PNG → printToPDF → engine attaches + probes (D7).

## Consequences

- The parent may read 2.1 session files but must never re-save them; the engine refuses
  unknown versions.
- Defaults to confirm with the operator: z_median ≥ 1.5 m, M = 12, N = 5, valid fraction
  0.6, bucket reservation, whether to expose best-so-far candidates while the walk runs.
- Day-1 tests: Arabic-path bag + data root; schema 2.1 round-trip per dataclass; the
  candidate job on the golden bag reproduces the golden frame's stats.
