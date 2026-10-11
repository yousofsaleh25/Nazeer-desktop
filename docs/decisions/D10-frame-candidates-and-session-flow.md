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

## Engine parameters (implemented 2026-10-11)

Status: implemented in `engine/nazeer_engine` (`bagreader`, `candidates`, `jobs`,
`session_store`, `history`, `api/`) and integration-tested with the pinned `best.pt` on
bag 006 (golden frame) and bag 004 (full flow through the HTTP API, bag hard-linked under a
folder named `اختبار`, Arabic data root). Plan decisions B1–B38 in
`~/.claude/plans/ancient-exploring-snowflake.md`.

**C2.4 completeness — revised on real data (B37), operator to confirm.** The literal rule
("no mask pixel within 8 px of the depth-valid region") rejected **155 of 155** sampled
frames of bag 004 and would reject the golden frame itself: the D455's depth map starts at
row 22–24, and a camel that fills the frame vertically has its head in those depth-less
rows (golden mask rows 9–715). Implemented instead:

| Gate | Parameter (default) | Kind |
|---|---|---|
| mask touches the image border (`mask_cut_by_frame`) — the parent's `_mask_is_complete` | `frame_margin_px` (1; 0 disables) | hard |
| mask enters the depth-less colour margin (`mask_in_depth_margin`) | `completeness_margin_px` (8) | soft, visible flag; clicks there resolve by KNN with provenance |
| the literal C2.4 rule (`mask_incomplete`) | `strict_depth_fov` (false) | hard when true |

Bag 004 under the default: 771 pairs, 155 sampled, 155 detected, 50 passed (105
`mask_cut_by_frame` — hooves on the last image row), 11 one-per-bin holders and **7
candidates** after the 1.5 s gap below (END 4, QUARTER 3, spread from 1.3 s to 23.3 s; the
bag is end-on), every one flagged `mask_in_depth_margin`; job 17–21 s on this laptop (CPU,
budget 60 s).

**Evidence from the real-run check (bag 006, 2026-10-11, `engine/tools/real_run.py`)** for
the operator's call on C2.4 and the buckets: 351 sampled, 225 passed, 12 proposed (97
`mask_cut_by_frame`). Two proposals (read indices 760 and 1115) have a **truncated hump**:
their top mask row is 7 px below the border with a 346 / 375 px flat run. The model's
box-cropped mask stops a few pixels short of the border, so the 1-px `frame_margin_px` never
sees the cut. The camel (head or hump) reaches rows 4–17 in 10 of the 12 proposals (camera
≈ 1.9 m away, where the frame is ≈ 2.2 m tall). An 8-px margin would also reject the golden frame (top
row 9), so a flat-run test or operator review fits better than a wider margin. Side views with
the head up measure w/h 1.38–1.49 and are badged QUARTER (1 SIDE of 12), so the SIDE / END
thresholds 1.6 / 1.3, and the minority reservation built on them, need the operator's look
too.

**Walk and selection.** Read index = 0-based count of colour+depth pairs; sampling is
tested before `align.process`; `sample_every` = max(5, n_frames // 400) unless given; EOF =
a 2 s `try_wait_for_frames` timeout at position ≥ 0.99 of the duration or read index ≥
n_estimate − fps, else 3 retries then `bag_read_stalled`; the colour stream must be `rgb8`
(reversed once) or `bgr8` (copied), anything else is `bag_color_format_unsupported`. One
payload per ⌊read_index / fps / 1.5⌋ bin (a strictly lower `z_var` replaces; cap 48 evicts
the worst); rank by (`z_var`, `rel_disp`, read index) and pick greedily up to M = 12,
**skipping any frame within 1.5 s of a pick** (the bins alone let read indices 44 and 45
both through); the SIDE/END bucket that the *pick* starves gets up to 2 slots by swapping
its best remaining frames in for the worst-ranked picks of other buckets, keeping the gap
(QUARTER is never reserved); `selection` reports `skipped_too_close` and any shortfall;
`near_misses` lists frames that failed only tunable gates. Verified on bag 004: picks are
≥ 1.5 s apart, every holder is proposed or within 1.5 s of a proposed frame, and a steadier
frame of the same view is left out only by the gap.

**Jobs and cache.** `POST /candidates/jobs` → 202 `{job}` or 200 `{cached: true,
n_candidates, partial}`; one job at a time (409 `job_busy`); `cancel` discards, `stop` ranks
what was gathered (`partial: true`) — such a stopped walk stays viewable at its URL but is
**never a cache hit** (the next start re-walks); progress by polling or SSE (`/events`), the
counters carry `rejected_by_reason` live and a slow-media warning appears while the walk
runs; a failed job's `error` has the API error shape (`code`, `message`, `details`).
Results live at `<root>/candidates/<fingerprint>/<params_hash>/` (new params ⇒ new hash);
publish moves an existing directory aside first (Windows, B28); LRU purge above 2 GB.

**Sessions and export.** Autosave is a whole-document `PUT /sessions/{id}/document` with
`revision = stored + 1`: an identical replay of the stored revision is 200 (checked before
`If-Match`); anything else ≤ stored is 409 `stale_revision` carrying the `current` view
for the Redux store; omitted `camel_id` / `operator` / `notes` keep their values; the
ETag is `"r<revision>-<hash>"` and moves with any change (status, outputs, report inputs);
an edit on a finalized / exported session reopens it with `outputs_stale` and a manifest
entry (B19), but an identical document never does; ids are never reused. Only schema 2.1
is read (B20); a session file of the wrong shape is a `corrupt` History row, never a crash
of the list or of the engine start. Finalize renders `overlay_vN.png` once (idempotent at
the same revision) and writes `report_model_vM.json`; every changed report-input PATCH
writes a **new** model version, and the PDF upload must name it (`X-Report-Model-Sha256`;
409 `report_model_mismatch` otherwise) so the sealed PDF and its attached model always
agree. The upload probes (text and font probes strict by default), attaches and writes
`report_vN.pdf`; a DRIFT keeps `report_vN.rejected_<UTC ms>_<hex>.pdf` and answers 409
with the probe. `SessionView.required_report_texts` lists the strings the text probe
requires (B38); `outputs.report.stale` says when the PDF on file no longer shows the
session.

**Golden frame.** Regenerated from bag 006 by the engine's reader, bit-identical to the
parent capture (RGB and depth max |Δ| = 0); `best.pt` gives conf 0.9593, 269,033 px, rows
9–715; Z_ref 1.930 m; recorded in `fixtures/golden_frame.json` (tracked).
