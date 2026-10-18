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
n_candidates, partial}`; one job at a time (409 `job_busy`; since Stage 9 the app attaches only
to a job on the same recording, and names one on another recording, with a Cancel for it);
`cancel` discards, `stop` ranks
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

**Development stub mask (Stage 8, 2026-10-13; planning decision 1).** `--stub-mask ellipse`
(only with `--stub-model`, which itself needs `NAZEER_ENGINE_DEV=1`; otherwise exit 2
`stub_mask_needs_stub_model`) makes the stub return the same centred ellipse in every frame
(semi-axes 30 % of the width and 35 % of the height: 33 % of the frame, aspect 1.52 at
1280 × 720, so QUARTER; confidence 0.9). A real bag then goes through every C2 gate without
YOLO, which is what the fast end-to-end test needs. The stub names itself `stub-ellipse` (file
and SHA-256 in the ready line, `/health` and `candidates.json`), so its candidate sets get their
own params hash and never mix with the plain stub's (`stub`, no detection) or the model's. The
app passes it with `NAZEER_STUB_MASK=ellipse` (development builds only). On bag 004: 771 pairs,
155 sampled, 155 detected, 107 passed (48 `valid_frac_too_low`: the ellipse is not the camel),
**8 candidates** (all QUARTER, z_median 1.75–2.20 m, valid fraction 0.61–0.71) in 9.4 s.

## App side of C3.4 (implemented 2026-10-12, Stage 5)

The renderer's session store (`app/src/renderer/store/`) is the other half of the autosave
contract. Status: unit-tested against a simulated engine that follows `save_document` and
`finalize`, and integration-tested against the real engine (stub model, a copy of the dev
session: `npm run test:store-real`).

- **The document** the app owns and sends is the ordered measurement inputs plus `camel_id`,
  `operator` and `notes` (`store/session/document.ts`). The engine computes everything else; the app
  never derives a value. Ids are client-owned; `next_measurement_id` never decreases, undo included.
  Limits as the engine's: 500 measurements, ids and revisions ≤ 2**53 − 1.
- **Autosave** (`store/listeners/autosave.ts`): a whole-document `PUT` at `revision = stored + 1`,
  with `If-Match` when the ETag is known; one save in flight; edits coalesce behind a 250 ms
  debounce; a flush sends at once (quitting: main waits 3 s and the renderer answers within 2.5 s;
  leaving the measuring screen; closing the session). After a `200` the draft adopts the engine's
  echo of everything unchanged since sending (a filled colour, the default targets), so nothing
  looks unsaved; edits made meanwhile go out next.
- **409 `stale_revision`** (`store/session/sync.ts`), against `details.current` (or a GET when it is
  missing):
  - my save in flight is what the engine holds (its answer was lost) → saved;
  - same revision and document (only the status, report inputs or ETag moved) → updated, and the
    save is sent again with the new ETag;
  - the session is not open any more → `blocked`: nothing is saved, the draft is kept and shown
    unsaved, and reopening sends it;
  - otherwise a three-way rebase by measurement id (`store/session/rebase.ts`): base = what the
    engine held when the draft diverged, mine = the draft, theirs = `current`; a change on one
    side is taken, the same change on both is fine, two different changes to one measurement
    (edit/edit, edit/delete, the same new id added differently, different reorders, a text field)
    are a **conflict**: autosave and edits stop until the operator keeps theirs or mine. Never a
    silent drop.
  A 409 carries no ETag: the save after a rebase goes without `If-Match`. The revision check alone
  keeps it safe, and its answer brings the new ETag.
- **Failures:** any other 4xx is terminal (`error`): the draft is kept and not sent again, not even
  by a flush, until it changes. No engine, a network failure, a 5xx or `session_busy` is transient
  (`offline`): retried after 1, 2, 4, 8, 16, then every 30 s, and at once, after a GET of the
  session, when the supervisor reports the engine ready on a new connection (until Stage 9 that
  catch-up ran before the new client was installed and waited for the next edit; D9 "Review and
  wrap-up"). A save whose answer was lost is retried as it was and lands once: the engine's
  identical replay of the stored revision is a 200.
- **States** the UnsavedBadge shows: `finalizing` › `conflict` › `blocked` › `saving` › `offline` ›
  `error` › `dirty` › `clean`. Unsaved work, as the quit dialog asks about it, is a draft different
  from the engine's, a save in flight, or an open conflict.
- **Finalize** (`store/listeners/finalize.ts`): edits and undo freeze, the debounce is skipped and a
  save in flight lands first; then one call, `{revision: stored}` when clean or
  `{revision: stored + 1, document}` when dirty, plus the report inputs when given. On success the
  session is sealed (no autosave) and the app fetches the overlay, SHA-256es it with WebCrypto and
  compares with `outputs.overlay.sha256`: a mismatch is `overlay_hash_mismatch`, a hard error, and
  cannot be approved. The approval is the app's (no engine endpoint, not persisted) and names the
  overlay version and SHA-256, so a newer overlay is never covered by it. Any finalize failure
  (`camel_id_required` included) unfreezes, fetches the session and reconciles before autosave
  resumes.
- **Hover and drag** (`store/session/probe.ts`, `store/listeners/probes.ts`): one depth and one preview
  request in flight; the newest pointer state waits and goes out with the answer; an answer counts
  only for the request in flight of the current generation (pointer-leave, a tool change, Esc and
  commit start a new one); an error or a 5 s timeout frees the slot. A preview row is kept with the
  exact input it was computed for and is shown, marked unsaved, until the engine's stored row
  replaces it.

## App side of C3.5 (implemented 2026-10-12, Stage 6)

The screens over the session's states (D9 "Screens"). Status: unit-tested against the simulated
engine, and run on the real engine through the UI (D9, "Run on the real engine").

- **Finalize** is its own screen: the camel id is asked for there and the button waits for it (the
  engine's `camel_id_required` stays the authority); a conflict sends the operator back to measuring.
  After finalize the overlay is checked as in "App side of C3.4", and approved on the screen that
  shows the verified bytes.
- **Sealed sessions** (finalized, exported) open read-only: no tool, no edit, a banner with
  "Reopen for editing". Reopen (from measuring, approval or History) is `POST …/reopen`: the
  session is open again and its outputs are stale until it is finalized again.
- **Delete** (History): after a confirmation, the store forgets the session if it is the open one
  (nothing of it stays on screen: the PDF viewer lives on the report screen, not History), then
  `DELETE`; a `session_busy` answer (a save still finishing) is tried again up to 4 times, 500 ms
  apart; a 404 is what was asked. The engine moves the folder to the trash, as C3.5 says.
- **Opening another session** while the open one has unsaved work flushes it first; what still
  cannot be saved is discarded only after the operator confirms.
- **Unsaved work, confirmed by the operator (2026-10-12):** a renamed (or re-noted, recoloured)
  measurement keeps the engine's stored value on screen, marked not saved, until the engine stores
  a revision with exactly that input; a changed geometry shows no value until the engine computes
  it. Edits made while a save is out are kept and sent next; leaving the measuring screen or the
  window losing focus sends the save at once; finalize carries what is still unsaved; opening another
  session or quitting asks before anything the engine does not hold is dropped. Added at the
  operator's request: the open session's entry in the header shows its save state from every screen
  (D9 "Printing").

## History index version 2 (D12 Stage 2, 2026-10-17)

C3.3 is unchanged: `history.sqlite` stays a derived, rebuildable index and the files win. Version 2
adds what D12's comparison report needs:

- the `comparisons` and `comparison_members` tables, the index of `<root>/comparisons/*/comparison.json`
  (reconciled like the sessions: before every list, a failed delete kept visible, a broken folder a
  `corrupt` row). `comparison_members` has **no foreign key to `sessions`**: an upsert is an
  `INSERT OR REPLACE`, which SQLite carries out as a delete that would cascade (measured), and a
  member must outlive its session's row to say `member_deleted`;
- the sessions' `event` (the report's event name), `input_sha256` (`document_input_sha256`),
  `overlay_sha256`, `report_overlay_version` and `report_model_schema` (the version string in the
  current report model file; `""` when it is missing or unreadable);
- History filters by event and by measuring date (`created_from` / `created_to`, ISO instants,
  inclusive, compared with `julianday()` so a stored `+00:00` and a local offset agree), and the
  search also reads the event.

The migration runs once per start in one `BEGIN IMMEDIATE`: it reads the stored `index_version`
first, adds only the columns `PRAGMA table_info` lacks, and — when the stored version is not 2
(a new file, version 1, or release 1.0.0 run on the same data root since, which writes 1 and upserts
without the new columns) — sets `session_mtime_ns = 0` on every `ok` and `corrupt` row so the next
reconcile refreshes it; a `delete_failed` row keeps its state. Tested on a hand-built version-1
file and on a version-2 file reset the way release 1.0.0 would (`tests/test_history.py`).
