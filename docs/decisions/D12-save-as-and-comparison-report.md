# D12 — "Save as" for every PDF report, and the combined comparison report

Status: **proposed** (2026-10-17). The operator decided both features on 2026-10-17; this record
holds the design, the four decisions taken with the operator in Stage 0 (Q1–Q4), and the
deviations flagged for the operator's confirmation. Implementation: Stage 1 = F1 for single
reports; Stages 2–6 = F2 (plan `~/.claude/plans/pasted-content-id-80b5-role-you-swirling-brook.md`).
Nothing is implemented when this record is first written.

## Context

Release 1.0.0 seals each report inside the engine's data root
(`<data root>/sessions/<id>/report_vN.pdf`, C3.2, D7), one camel per PDF. The operator asked for:

- **F1 — "Save as":** save any sealed PDF anywhere, under any name. The engine's sealed copy stays
  where it is, because History, the in-app sign-off, `outputs.report.stale` and the manifest
  depend on it; the user's copy is written by Electron main to the path chosen in a native Save
  dialog. The dialog opens by itself after a seal. "Save PDF as…" appears on the Report screen, on
  every History row with a sealed report, and on comparisons. Cancelling keeps the sealed copy and
  shows "not saved to a file yet".
- **F2 — a combined comparison report:** the operator picks one or more camels (sessions) in
  History and exports **one** sealed PDF holding all of them: a cover, a comparison table, then one
  section per camel with its approved engine image and measured data. It is stored in the app,
  listed in a new "Comparisons" tab in History, can be reopened, viewed, saved again and deleted,
  and turns stale when a member changes.

Binding (unchanged): CLAUDE.md, D7–D11 and `engine/openapi.json`. The engine is the single
rendering and measurement authority; approval happens on the engine PNG; sign-off happens on the
PDF; the honesty contract holds; the app runs offline. The engine never scores, ranks or judges
camels, and the app never computes a measurement value.

Facts from the code that shape the design (Stage 0, checked by a read-only reviewer):

1. **Approval is the app's own and is never stored** (D10 "App side of C3.4"; the `report` slice
   resets on every session load). A session can be finalized and never approved. The only durable
   proof of a past approval is a report sealed from the current overlay, the `--export` guard
   (`main/print/cli.ts`: status finalized or exported, not `outputs_stale`,
   `report.overlay_version == overlay.version`). Both versions start at 0 and a reopen moves
   neither, so the guard needs every clause. The proof assumes every seal path required an
   approval; the development tool `engine/tools/real_run.py` seals without one.
2. **`session.json` is rewritten without a measurement change** when its own report is sealed
   (`attach_report`) and when its report details change (`patch_report_inputs`). The revision, the
   overlay version and SHA-256 and `document_input_sha256` move only with edits and re-finalize.
3. **Report model 1.1** rows carry every printed text (kind, value, uncertainty, depth basis,
   flags, confidence, rejection, `n_points`, `n_points_knn`); `frame.texts` the Z_ref and ground
   lines; `summary` the snapped and counts lines. Model and overlay files are versioned and never
   rewritten; the overlay footer carries the session id and render time, so two sessions never
   share an overlay.
4. `pdf_finalize` checks **one** overlay anywhere in the PDF (every image decoded, twice: before and
   after attaching), extracts the text of every page, attaches three files; uploads are capped at
   `PDF_MAX_BYTES` = 64 MiB. Measured: an overlay ≈ 1.13–1.17 MB, a sealed single report
   ≈ 2.6–2.85 MB.
5. The hidden print window answers only `/print/print.html`; its CSP allows no network;
   `printToPDF` itself has **no timeout** (a hang keeps `oneAtATime` busy until restart).
6. `GET /sessions/{id}` builds the depth-lookup (KNN) context (hashes the frame files, may answer
   409 `session_assets_changed`; the cache holds 4). `GET /sessions/{id}/assets/session.json`
   serves the file without that cost.
7. History index v1 has no event, date filter, overlay SHA, report-model schema or report-overlay
   version. Upserts are `INSERT OR REPLACE` with foreign keys on, and SQLite cascades a REPLACE
   into `ON DELETE CASCADE` children; `ensure_schema` always writes `index_version`; reconcile keeps
   rows that look fresh by mtime and size.
8. Engine error codes are labelled in the app's `errors.*`; `gen:codes` sweeps every
   `"code": "<literal>"` in the engine sources and `i18n.test.ts` requires exactly those labels.
   `/meta/labels` is `dict[str, Any]` in OpenAPI, but the app's `parseLabels` keeps only the groups
   it knows.
9. Wording: «حفظ» already means "saved to the engine" (`save.*`, `measure.pending` «لم يُحفظ بعد»,
   `report.unsavedInputs`, `history.title`); «نسخة» already means a version (conflicts), the backup
   and the development build; `errors.save_failed` is an engine code; «مُقفلة» and «مُصدَّرة» are
   session statuses; «مؤهَّل» reads as "qualified" in a contest.
10. The e2e specs answer OS dialogs in main (`e2e/helpers/flow.ts`); `npm run check:sandbox`
    prints and seals in the packaged app, so it will meet the new Save dialog.

## Decisions taken with the operator (Stage 0, 2026-10-17)

| # | Question | Decision |
|---|---|---|
| Q1 | A finalized camel whose image was never approved (fact 1) | **Approve in the dialog.** Finalized and exported camels are eligible; a member without a report sealed from its current image is approved in the Compare dialog: its full engine image, fingerprint-checked. No existing decision changes |
| Q2 | When a comparison turns stale (fact 2) | **Content changes only:** a member reopened, edited, re-finalized or deleted. Each member's `session.json` SHA-256 is still recorded and compared; a change alone is a note, not stale |
| Q3 | Arabic for "Save PDF as…" (fact 9) | «حفظ نسخة PDF باسم…»; hint «لم تُحفظ نسخة منه في ملف بعد»; done «حُفظت نسخة في:»; «فتح الملف» · «إظهار في المجلد». English: "Save PDF as…", "Not saved to a file yet", "Saved to:", "Open file", "Show in folder" |
| Q4 | Two measurements with the same name and kind in one camel | **Pair by order, marked:** the 1st with the 1st, the 2nd with the 2nd; rows show (1/2), (2/2); the pairing is recorded in the comparison model |

## Decision — F1 Save as

1. **Two copies.** The engine's sealed copy stays in the data root. Electron main writes the user's
   copy; the engine never learns where (local paths stay in the app's settings).
2. **`report.saveAs({kind: "session" | "comparison", id, version, suggestedName})`.** The renderer
   sends no path and no bytes. Main:
   1. reads what is sealed: for a session `GET /sessions/{id}/assets/session.json` (no KNN
      context, fact 6) → `outputs.report_version / report_file / report_sha256`; when
      `report.manifest.json` `files.pdf` names the same file its SHA-256 must agree. For a
      comparison, `GET /comparisons/{id}` (no frame context). A version other than the one the
      screen shows is `save_as_report_changed`;
   2. fetches the bytes (`GET …/report?v=N`; the token goes to the engine only) and checks their
      SHA-256 (`save_as_report_mismatch`, hard);
   3. opens `dialog.showSaveDialog(operator window, {title, defaultPath, filters: PDF})` —
      `defaultPath` = the last folder used (when it still exists, else Documents) + the
      re-sanitised suggested name; one dialog at a time; Arabic names and folders are allowed;
   4. forces `.pdf`: an appended extension that lands on an existing file asks Replace / Cancel —
      a file is never replaced silently; the dialog's own overwrite prompt stays on;
   5. refuses a path inside the data root (the engine owns it): the parent folder's real path
      (junctions, 8.3 names) against the data root's, case-insensitive (`path.relative`, as
      `dataRoot.ts`); the message offers "Choose another place" or "Cancel";
   6. writes atomically: a temp file in the target folder → write → fsync → close → rename, never
      in place; EBUSY / EPERM / EACCES are retried 3 times, then a bilingual message names the
      likely case (the file is open in another program; the folder is read-only; a cloud-sync
      hold) with "Try again", "Save elsewhere…", "Cancel";
   7. re-reads the written file and compares its SHA-256 with the sealed report's; a mismatch
      removes that copy and is a hard error (`save_as_copy_mismatch`);
   8. records the folder and the copy `{kind, id, version, path, sha256, bytes, size, mtimeMs,
      savedAt}` (the newest 500) in `<userData>\app-settings.json` (never localStorage); each
      field is validated on its own (a bad record drops only itself), the write is retried, a save
      over a recorded path drops the older record of it, and a record that cannot be written makes
      the answer "saved, not recorded" (logged), never "failed".

   Main's own codes are `save_as_*` (never `save_failed`, an engine code), listed in
   `SAVE_AS_ERROR_CODES` (`api/errors.ts`) and labelled in `appErrors.*`.
3. **`report.savedCopy({kind, id, version})`** returns the recorded copy with `exists` and
   `changed` (size or modification time moved; checked with a short time bound for network
   folders). **`report.openSaved({…, action: "open" | "show"})`** opens the recorded path only
   (`shell.openPath` / `shell.showItemInFolder`, `.pdf` only), never a path from the renderer.
4. **Renderer.** After every successful seal, once the in-app viewer has verified the sealed bytes
   (D7: the in-app PDF stays the review surface) and while the operator is still on that screen,
   the Save dialog opens by itself. "Save PDF as…" on the Report screen, on every History row with
   `report_version > 0`, and on comparisons. Cancelling shows "Not saved to a file yet"; after
   saving, the path with "Open file" and "Show in folder". A stale sealed PDF can still be saved;
   its stale badge stays.
5. **Default names** (`src/shared/fileNames.ts`, pure; the renderer builds them, main sanitises
   again): a session `<camel id, else session id>_<YYYY-MM-DD>.pdf` (the measuring day, the
   session's `created_at` in local time; `_v<N>` added for report version N > 1); a comparison
   `مقارنة_<n>_<date>.pdf` / `comparison_<n>_camels_<date>.pdf` by UI language (its creation day;
   `_v<N>` as above). Sanitising: Windows-illegal characters and C0 controls → `_`; Unicode format
   characters (`\p{Cf}`) removed — a right-to-left override could fake an extension; reserved
   device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9, also with an extension or superscript digits)
   prefixed with `_`; trailing dots and spaces trimmed; at most 120 code points before `.pdf`,
   never splitting a surrogate pair.
6. **Tests:** the development switch `NAZEER_E2E_SAVE_DIALOG` = `cancel` | `file:<absolute path>`
   | `folder:<absolute folder>`, read through `devSwitch` (production builds ignore it, D11). It
   replaces only the OS dialog call; every check after it still runs. `launchApp` defaults it to
   `cancel`, so no printing spec is ever blocked by a modal dialog.

## Decision — F2 comparison report

1. **Eligibility** (the engine computes it from the index; Stage 2). Each `GET /sessions` row
   gains `event`, `n_comparisons` and `comparison {eligible, reason, approved_by_seal, overlay}`.
   Reasons (labels group `comparison_ineligible`): `not_finalized`, `reopened`, `model_outdated`
   (report model 1.0), `files_missing`, `file_corrupt`, `delete_failed`, and — only when a comparison
   is created, from the files — `files_changed` (the overlay or report model no longer has the
   SHA-256 recorded at finalize; added in Stage 2). Every row stays visible;
   an ineligible one cannot be ticked and says why. Creating a comparison re-checks every member
   from its files. Reasons travel under a `"reason"` key, never as `"code"` (fact 8).
2. **Approval (Q1).** `approved_by_seal` = status ∈ {finalized, exported} ∧ not `outputs_stale` ∧
   `report_version` > 0 ∧ `overlay_version` > 0 ∧ `report_overlay_version` = `overlay_version`.
   This comparison's own earlier seal of the same overlay (version and SHA-256) also counts, for
   printing it again. Any other member is approved in the Compare dialog: its full engine image,
   verified with WebCrypto, then Approve (naming its version and SHA-256), held in the
   `comparisons` slice by session — never in the single-slot `overlayBytes` cache the open session
   needs. Main refuses a member without proof or approval (`comparison_approval_required`).
   **Deviation (flagged):** main fetches each approved overlay from the engine and checks its
   SHA-256 against the approval (byte identity by hash, the `--export` precedent) instead of
   receiving 20 × 1.1 MB over IPC. Switch back: the renderer sends the verified bytes, as
   `print.exportPdf` does.
3. **Content, in order:** the cover (title — an engine default when empty —, event, judge,
   council, date; the camel list: position, camel id, session id, bag and read index, status; the
   version stamp: engine and app versions, comparison model file, version and SHA-256, generated
   time); the comparison table (a new page); one section per camel, each on a new page (heading;
   the approved overlay — the same bytes, hash-checked, `break-inside: avoid`; the Z_ref and
   ground lines; the measurement table with depth basis and flag chips; the snapped and counts
   lines; member provenance: overlay and report-model files with SHA-256, the member model's
   `engine_version` and `generated_at`, the session revision); the signature wells (judge,
   council; `break-inside: avoid`); provenance (without `data_root`); the disclaimers. An overlay
   never appears outside its own section (no thumbnails on the cover or in the table).
4. **Nothing ranks.** No sort by value, no highlight, no difference, percentage or total. Columns
   follow the operator's order; rows follow first appearance across that order. The comparison
   model carries **texts only** — cells and member rows carry no numbers — and an engine
   disclaimer says the camels appear in the order the operator chose and the values are shown side
   by side, not ranked. Columns are headed "#k", the camel id and the session id (two members may
   share a camel id: the same camel on two frames).
5. **Rows** are built by the engine. Key = (exact stored name, computed `kind`, occurrence), so 2D
   and 3D never share a row (`distance_2d` ≠ `distance_3d`, `angle_2d_4point` ≠ `angle_3d_4point`).
   Occurrence = the k-th measurement with that name and kind in its session, printed as "(k/n)"
   when n > 1 (Q4), recorded per row; each cell names its `measurement_id`. Case, spacing and
   harakat differences make separate rows (exact matching). An unnamed measurement never matches
   across camels. A cell: `value_text` (null when rejected — never blank-as-zero),
   `uncertainty_text` (flag), `depth_note` — the engine's "k of n points snapped to the camel
   (KNN)", null for 2D kinds or 0 (flag; the honesty contract needs it: a snap under 10 cm carries
   no flag) —, `flags`, `confidence` when not high, `rejected`, `rejection`. A missing measurement
   is `null`, printed as the engine's `static.missing` "—".
6. **The model** `comparison_model_vN.json` (`comparison_model_version` "1.0"; every version
   immutable): `engine_version`, `generated_at`, `comparison_id`, `language` (ar | en | both, one
   for the whole file, an explicit input); `cover`; `members[]` in the operator's order (position,
   session id, camel id, operator, revision, status, created_at, bag name and read index, overlay
   `{file, version, sha256, width, height}`, report model `{file, version, sha256, engine_version,
   generated_at}`, `session_json_sha256`, `document_input_sha256`, frame texts `{z_ref, ground,
   source}`, rows (texts only), summary `{snapped_text, counts_text}`); `rows[]` (`key`, `name`,
   `kind`, `kind_label`, `occurrence`, `n_occurrences`, `cells[]`); `disambiguated[]`; `static`;
   `versions` (library stamp and app versions); `constants`. A cover or language change writes
   v+1 by copying members and rows from vN (no member file is read).
7. **Stale (Q2: by content)**, computed, never stored: on every list by a LEFT JOIN of the members
   with the reconciled sessions index; on every get, print and seal from the member files
   (authoritative). Per-member reasons (labels group `comparison_stale`): `member_deleted`,
   `member_unreadable`, `member_reopened`, `member_edited` (revision or input hash),
   `member_refinalized` (overlay version or SHA-256). A changed `session.json` SHA-256 alone is the
   note `member_session_changed`. A stale comparison keeps its sealed PDF (viewable and savable,
   with a stale badge) and refuses a new print (409 `comparison_stale`); "Compare again" makes a
   new comparison with the same order and cover (deleted members dropped and named). No refresh in
   place.
8. **Storage:** `<root>/comparisons/<comparison_id>/` (`YYYYmmdd_HHMMSS_<6 hex>`):
   `comparison.json` (schema "1.0"; status `created` → `sealed`, own label group
   `comparison_statuses`), `comparison_model_vN.json`, `report_vN.pdf`,
   `report_vN.rejected_<UTC ms>_<hex>.pdf` (kept, as D7), `comparison.manifest.json`. Files first,
   index row second (C3.2). Delete = rename to `<root>/trash/comparison_<id>` (purged at the next
   start); a failed rename stays visible as `delete_failed`. The index is `history.sqlite` version
   2: a `comparisons` table; `comparison_members` with a cascading key to `comparisons` only — **no
   foreign key to `sessions`** (fact 7); new `sessions` columns `event`, `overlay_sha256`,
   `report_overlay_version`, `report_model_schema`. Migration in one transaction: read the stored
   version first, add only the missing columns, and when the stored version is not 2 force a
   refresh of the `ok` and `corrupt` rows (a failed delete stays visible); safe again after a 1.0.0
   engine ran on the same root. Date filters compare with `julianday()`.
9. **Seal.** Lock order: the comparison's lock, then member session locks in sorted order (session
   code never takes a comparison lock). Member locks are held only to snapshot the bytes and check
   staleness, and again to re-check and write; the probe runs without them (a change in between is
   409 `comparison_stale`, the file kept). Pixel probe (hard, ordered): image sizes read first, each
   same-size image decoded once and matched by the SHA-256 of its RGB bytes (tolerance 0); member
   k's overlay must match an image on exactly one page, after member k−1's (a thumbnail elsewhere or
   an image split by a page break is `overlay_out_of_place`, added in Stage 3); page and |Δ|
   recorded. Text probe
   (hard): every required text (all member measurement names, camel ids, the cover's title, event,
   judge and council) in the document, and each member's names and camel id within its own pages.
   Font probe (hard). Attachments (soft, C3.7): each member's overlay, `session.json` and report
   model (flag), and the comparison model, read back by SHA-256. Page count. The upload cap
   `COMPARISON_PDF_MAX_BYTES` and the timeouts come from the Stage 3 measurement (20 camels:
   29.3 MB printed, 55.4 MB sealed, 6.8 s; the cap is 3 MiB per camel × `COMPARISON_MAX_SESSIONS`,
   at least the single report's 64 MiB — 64 MiB today).
10. **Manifest** `comparison.manifest.json`: files (comparison, model, PDF with pages), members
    (overlay with its page and |Δ|, report model, `session.json` SHA-256 at creation and attached,
    notes), probes, printer (app, Electron, Chromium), history (created, inputs changed, exported,
    re-exported, report rejected), versions.
11. **Print page: a mode of `print.html`** (no new Vite entry, so the same CSP path, preload,
    bridge and window checks). `PrintJob` becomes a union (`report` | `comparison`); `main.tsx`
    dispatches to `PrintPage` or `ComparisonPage`. Preflight: exactly N overlays in order at their
    natural size, untouched; a new `print_overflow` check. Comparison tables use `table-layout:
    fixed` and `overflow-wrap: anywhere`, blocks of at most K camel columns (a layout constant: 6,
    or 4 for both languages), each repeating the name and kind columns; `thead` repeats; rows
    `break-inside: avoid`; one face at weight 400; A4, 12 mm. **`printToPDF` gets a print-phase
    timeout** (the window destroyed, `print_timeout`); it also applies to the single report (flag).
12. **Limits** (`constants.py`, so in `CONSTANTS_STAMP`): `COMPARISON_MAX_SESSIONS = 20`
    (proposal, operator to confirm); schema, model and manifest versions "1.0"; title ≤ 200; event,
    judge and council ≤ 100; `COMPARISON_PDF_MAX_BYTES`. No headless `--export` for comparisons.

## Consequences

- The user's copy is outside the engine's control; the app records only where it wrote it and its
  hash.
- History index version 2: the first start refreshes every row.
- `npm run check:sandbox` must dismiss the Save dialog that now opens after its print (code updated
  in Stage 6; the tool runs only when the operator asks).
- A 20-camel PDF is tens of MB, measured in Stage 3 (engine, headless Edge) and Stage 5 (Electron).
- The preload surface (D9) gains `report.saveAs`, `report.savedCopy`, `report.openSaved`
  (Stage 1) and `print.exportComparison` (Stage 5), for the operator's acceptance as before.

## Rejected alternatives

- **Merging the already-sealed single PDFs:** attachments, probes and the text layer would not form
  one verified document, and the cover and comparison table exist nowhere.
- **The renderer matching names across camels:** the app computes nothing; the engine builds rows.
- **A separate Vite entry for the comparison page:** it would duplicate the CSP, preload and window
  checks.
- **Landscape named pages for the wide table:** mixed page sizes in `printToPDF` are unverified;
  column blocks instead.
- **Normalising names before matching:** the operator chose exact matching.
- **Refreshing a stale comparison in place:** "Compare again" keeps the old record.
- **Recording the user's copy in the engine manifest:** local paths stay in the app's settings.
- **The renderer sending the target path or the PDF bytes.**
- **Patching `dialog.showSaveDialog` through `app.evaluate` in the e2e specs:** the operator asked
  for a development switch that production builds ignore.

## Flagged for the operator (each with its switch back)

- `COMPARISON_MAX_SESSIONS` = 20 (a proposal; any number ≥ 1 in `constants.py`).
- Comparison cells also show the engine's `± …` and the KNN note (remove both lines from the cell;
  the KNN note then lives only in the per-camel section).
- Each member's report model is attached too (drop that attachment).
- Default file names carry `_v<N>` for report version N > 1 and use the measuring day (drop the
  suffix; use the printing day).
- The signature wells sit at the end of the comparison PDF (move them after the table).
- The comparison print checks the approved overlays by SHA-256 and does not carry their bytes over
  IPC (send the bytes from the renderer).
- `printToPDF` gets a timeout, which also applies to the single report (no timeout).

## Open

- The flags above and `COMPARISON_MAX_SESSIONS`.
- D7's open questions apply to the comparison as well: signatures, one PDF per language, PDF/A.

## Stage 1 — "Save as" for single reports (implemented 2026-10-17)

Status: **integration-tested** — the app's real flow on bag 006 with `best.pt`
(`NAZEER_REAL=1` `e2e/flow-real.spec.ts`, 11 of 11): after the seal the Save dialog opened by
itself once the viewer had verified the sealed bytes, and main wrote
`جمل-اختبار-حقيقي_2026-10-17.pdf` (2,821,273 bytes in the final run) into a folder named in Arabic,
its SHA-256 equal to the sealed report's. Not production-validated (no field laptop, no signed installer). F2 (the
comparison report) is Stages 2–6; `report.saveAs` takes `kind: "session"` until Stage 5.

- **Measured first** (Electron 44.4.5 on this laptop; the Windows Save dialog driven by window
  messages, no keyboard): saving over an existing file shows Windows' "Confirm Save As"; a name typed
  without an extension comes back with the filter's `.pdf`; `other.txt` comes back unchanged. So the
  dialog's own overwrite prompt covers what it returns, and main asks itself only when it appended
  `.pdf` and that file exists (decision F1.2.4 as written).
- **Main:** `src/main/report/saveAs.ts` (the orchestration, injected engine, dialogs and file
  system; one save at a time; at most 20 dialogs in one save), `atomicWrite.ts` (temp file
  `.<name>.<pid>.<random>.tmp` beside the target, write, fsync, close, rename; EBUSY / EPERM /
  EACCES retried after 100, 300 and 900 ms), `savedCopies.ts` (the recorded copy, `exists` and
  `changed` within 2 s; open / show in folder on the recorded path only), `dialogs.ts` (the Save
  dialog and the three questions, bilingual), `settings.ts` (fields read one by one, the rename
  retried, the newest 500 copies, one per report version, a path written over replaces its older
  record), `ipc.ts` (three channels, `ipcValidate.ts`), `index.ts` (the wiring and the test switch).
  The sealed report is read from `assets/session.json` and `report.manifest.json`, so a save from
  History never builds the depth-lookup context of a session that is not open.
- **Renderer:** the `savedFiles` slice and its thunks; `SaveCopyPanel` on the Report screen's sealed
  card and as History's notice; the Save dialog after a seal through `takeSaveOffer`, which reads
  the offer from the store when it runs, so React's StrictMode cannot open two dialogs; the
  History row button for rows with `report_version > 0`; i18n 20 strings (11 `report.*`, 9
  `appErrors.save_as_*`, `SAVE_AS_ERROR_CODES`) and 14 strings in main, in the wording backlog.
- **Tests:** unit — `fileNames`, the three validators, `settings` (fields, records, a write that
  fails, the rename retried), `saveAs` (an Arabic folder, cancel, the default folder, the appended
  `.pdf` and its question, the data root in another case and through a junction, retry / elsewhere /
  cancel after a failed write, a copy that reads back different is removed, mismatching bytes or
  manifest, a newer version, no report, no engine, an unrecorded copy, the dialog bound),
  `atomicWrite`, `savedCopies`, the slice and thunks, `SaveCopyPanel` (Arabic and English),
  `ReportScreen` (the dialog after a seal, once; cancel; a moved copy; a failure), History (the
  row button; the notice); e2e — `export.spec.ts` (the dialog after the seal answered by the test
  switch with a folder named «اختبار حفظ»: the copy byte-identical to the sealed report, no temp
  file left; History saves it again), and the real flow above. `launchApp` answers "cancel" by
  default, so no spec waits on the dialog.
- **Found on the way:** `app/package.json` had been CRLF in the working tree since the release's
  restore from git (`git diff` empty), so `npm run format:check` flagged it; LF restored, no content
  change. A race in the new e2e check (History's notice names the copy saved earlier at once, so
  the folder was read while the second copy was still a temp file) was fixed in the spec: it waits
  for the new copy to replace the first, then for the save to end; 3 repeated runs passed.
- **Not in Stage 1:** the Sandbox tool still meets the dialog after its print (Stage 6); the
  preload additions await the operator's acceptance (D9).

## Stage 2 — the comparison engine: model, storage, index (implemented 2026-10-17)

Status: **unit-tested** (engine pytest 488 passed, 6 opt-in skipped; 41 of them new). No real-bag
run yet: the comparison reads only files the real flow already writes (the frozen report model,
the overlay, `session.json`), and its integration test is the real flow of Stage 6. The seal
(upload, probes, the sealed PDF) is Stage 3; nothing in the app's screens uses it before Stage 4.

- **`comparison_model.py`** (pure): `ineligible_reason` and `approved_by_seal` (F2.1, F2.2, every
  clause of the `--export` guard), `stale_reasons` (Q2: reopened, edited — revision or input hash —,
  re-finalized — overlay version or SHA-256 —, deleted, unreadable; never the report's own seal or
  report details), `member_block` (from the member's frozen report model 1.1: frame texts, rows as
  texts, the snapped and counts lines, provenance texts), `build_rows` (F2.5: key = exact name +
  kind + occurrence; first appearance across the operator's order; "(k/n)" when a name repeats,
  recorded in `disambiguated` with each camel's count; an unnamed measurement never matches), the
  model (`comparison_model_version` 1.0), `revise_model` (cover / language → v+1 copying members and
  rows), `required_texts`.
- **`comparison_store.py`**: create takes the member sessions' locks in sorted order (with a 10 s
  bound, then `session_busy`) and re-reads each member: `session.json` (its SHA-256 recorded), the
  overlay and the report model SHA-256 against `session.json`, the model's version and the overlay
  it names. One refused member refuses the request; `details.members[]` names every refused member
  with its labelled `reason`. The files are written before the index row; delete renames the folder
  to `<root>/trash/comparison_<id>`; reconcile and rebuild cover `comparisons/`; stale temps there
  are purged at start.
- **Index version 2** (D10 "History index version 2"): the comparison tables (no foreign key to
  `sessions`), the sessions' comparison columns, the event and date filters, the migration in place.
  The list's `stale` filter is an SQL twin of `stale_reasons`; a test changes each column the
  predicate reads, one at a time, and checks both agree.
- **HTTP** (6 new operations, 37 in all): `create_comparison`, `list_comparisons`, `get_comparison`,
  `patch_comparison_inputs`, `get_comparison_asset`, `delete_comparison`; `list_sessions` gains
  `event`, `created_from`, `created_to` and each row `event`, `report_overlay_version`,
  `n_comparisons`, `comparison {eligible, reason, approved_by_seal, overlay}`; `/meta/labels` gains
  `comparison_ineligible`, `comparison_stale`, `comparison_statuses` (with `coverage_problems`);
  CORS allows `X-Comparison-Model-Sha256` (used from Stage 3). The app: `npm run gen:api`,
  `gen:codes` (11 new codes, each labelled in `errors.*`), `parseLabels` keeps the three groups.

**Differences from the plan, each small:**

- Error codes: a refused member answers `comparison_member_not_found` (404),
  `comparison_member_not_final` (not finalized or reopened), `comparison_member_model_outdated`,
  `comparison_member_unavailable` (files missing, unreadable, a failed delete) or
  `session_assets_changed` (files changed after finalize); the planned `comparison_member_stale` is
  folded into `comparison_member_not_final`. The first refused member decides the code. Also new:
  `comparison_assets_changed` (a model file changed on disk) and `comparison_id_collision`.
- `GET /comparisons/{id}/assets/{name}` arrives in Stage 2 rather than 3, so the view's model and
  manifest URLs work from the start.
- A comparison's view reports `approved_by_seal` also when this comparison was sealed (its members
  are fixed, so its own seal showed the same image), as F2.2 says; it is false everywhere until Stage 3.
- `created_to` is inclusive.

**Found on the way:** the dev data root's original session (`20261011_152956_e20a7c`, sealed by
`real_run` on 2026-10-11) still carries report model 1.0, so the engine lists it as
`model_outdated` — the case the reason exists for, met on real data. The app's fixtures were
recaptured from a one-session copy of the dev root and only `labels.json` and `history_list.json`
kept (the dev root now also holds a session from 2026-10-13 without a ground point, which
`capture-fixtures.mjs` cannot use, and the old fixtures carry report model 1.1, which the print
tests need).

**Open:** the word «مراجعة» (revision vs review), in the wording backlog; `COMPARISON_MAX_SESSIONS`
and the flags above.

## Stage 3 — the comparison seal (implemented 2026-10-17)

Status: **unit-tested, and integration-tested with headless Edge** — the opt-in `realpdf` test prints
a three-camel Arabic comparison (engine-rendered overlays, Arabic and mixed names, a name that repeats
within one camel) and seals it with the strict probes; the measurement below sealed 1, 5 and 20
camels on real bag-006 frames, every one PASS. Not yet through the app: its print page is Stage 5,
its real flow Stage 6. Not production-validated.

- **`pdf_finalize.finalize_comparison_pdf`** (beside the single report's `finalize_pdf`; both now
  share `_seal`, the attach-write-read-back step, whose behaviour for the single report is unchanged):
  - **ordered pixel probe** (`ordered_pixel_probe`): every image XObject's `/Width` and `/Height`
    read from the PDF first (through Form XObjects); only images of an overlay's size decoded, each
    XObject once, matched by the SHA-256 of its RGB samples and shape (tolerance 0, so a hash match
    is |Δ| = 0); member k's overlay on exactly one page after member k−1's; per member `page`,
    `pages`, `max_abs_diff`; failures `overlay_missing`, `overlay_drift` (an image of the right size
    that is no camel's, with the smallest |Δ| as a diagnostic) and the new `overlay_out_of_place`
    (out of the operator's order, a thumbnail elsewhere, an image split by a page break);
  - **text probe** (`comparison_text_probe`): the text layer extracted once per page; every required
    text in the document; each member's names and camel id within its section, [its overlay's page,
    the page before the next camel's overlay] (the print page keeps the heading with the overlay,
    Stage 5); a member whose overlay was not found is left to the pixel verdict;
  - **font probe** as the single report; **attachments** `m<NN>_<session>_overlay_vN.png`,
    `m<NN>_<session>_session.json`, `m<NN>_<session>_report_model_vN.json` per member and
    `comparison_model_vN.json`, each read back by SHA-256; the written file must still carry the
    matched images: their decoded streams are fingerprinted before and after (no second PIL decode);
  - the probe records `timings_ms` (open, pixel, text, fonts, attach, total).
- **`ComparisonStore.attach_report`**: the comparison's lock for the whole seal; the member locks
  (sorted) to read the evidence — a stale member is 409 `comparison_stale` listing every stale
  member, an overlay or report model whose bytes changed `session_assets_changed` — then released for
  the probe, then taken again for a second look and the writes: a member that changed meanwhile is
  `comparison_stale` with the print kept as `report_vN.rejected_<UTC ms>_<hex>.pdf`. The model's
  SHA-256 must be sent (`comparison_model_sha_required`) and be the current model's
  (`comparison_model_mismatch`: the cover or language changed after printing). A PASS writes
  `report_vN.pdf`, status `sealed`, the manifest (`files.pdf`, each member's overlay page and |Δ|,
  `session.json` SHA-256 attached and a `member_session_changed` note when it differs from creation,
  probes, printer, `exported` / `re-exported`) and the index row.
- **HTTP** (39 operations): `upload_comparison_report` (`POST /comparisons/{id}/report`, raw PDF,
  `X-Comparison-Model-Sha256`, `require_text` / `require_font`, 413 above `COMPARISON_PDF_MAX_BYTES`,
  415 for another content type; a refusal carries `rejected_url`) and `get_comparison_report`
  (`GET …/report?v=`). Four new codes, each labelled in the app's `errors.*`:
  `comparison_stale`, `comparison_model_mismatch`, `comparison_model_sha_required`,
  `overlay_out_of_place`.
- **Measured** (`tools/measure_comparison_seal.py`, 2026-10-17; real frames of bag 006 from the dev
  root, 8 named measurements per camel, printed in Arabic by headless Edge, the seal alone in a fresh
  process):

  | camels | pages | printed | sealed | print (Edge) | seal | of which pixel / text / attach | peak working set |
  |---|---|---|---|---|---|---|---|
  | 1 | 4 | 1.5 MB | 2.9 MB | 1.3 s | 0.4 s | 0.20 / 0.08 / 0.06 s | 74 MB |
  | 5 | 8 | 7.3 MB | 13.9 MB | 2.9 s | 1.4 s | 0.86 / 0.23 / 0.18 s | 138 MB |
  | 20 | 26 | 29.3 MB | 55.4 MB | 8.3 s | 6.8 s | 3.88 / 1.53 / 0.97 s | 383 MB |

  So `COMPARISON_PDF_MAX_BYTES` = max(64 MiB, 3 MiB × `COMPARISON_MAX_SESSIONS`) = 64 MiB (2.2× the
  20-camel print). For Stage 5: the print-phase and upload timeouts should allow at least 10× these
  times (proposal: 120 s each), to be confirmed with Electron's own numbers.

**Differences from the plan:** the new code `overlay_out_of_place` and the "exactly one page" rule
(the plan's "after member k−1's" alone let a cover thumbnail of camel #1 pass); the rejected-file
helper is shared with the session store (`rejected_report_name`); the measurement is a tool, not a
pytest test, because its numbers are the deliverable (the `realpdf` test checks correctness at three
camels).

**Found on the way:** Chromium writes an overlay's colour space as an indirect `[/ICCBased n 0 R]`;
the written file renumbers its objects, so the first fingerprint (which printed the reference)
refused every real print as "no longer carries the overlay pixels". The fingerprint now resolves
references (the profile compared by its bytes), with a unit test.

**Open:** as Stage 2; plus the timeouts for Stage 5.

## Stage 4 — the app's comparison screens (implemented 2026-10-17)

Status: **unit-tested** (`npm test` 149 files, 824 tests; 47 of them new). The screens talk to the
engine of Stages 2–3 through the generated client, but no spec drives them against a real engine yet:
that is Stage 6's end-to-end flow. Printing and sealing a comparison, its PDF viewer and its "Save as"
are Stage 5, so a comparison made here stays "not sealed yet".

- **Engine (one addition):** `/meta/labels` `constants` gains `COMPARISON_MAX_SESSIONS`,
  `COMPARISON_MAX_TITLE` and `COMPARISON_MAX_NAME`, so the app takes its limits from the engine and
  never keeps its own copy (`test_labels` checks them; the OpenAPI is unchanged, the labels payload
  being a free object). Without them the app shows the count alone and the engine still refuses.
- **Redux:** a `comparisons` slice — the ticked camels in the operator's order (each a snapshot of its
  History row: eligibility, reason, the image to approve, `approved_by_seal`), the Compare dialog's
  cover and language, the approvals given in the app keyed by session and naming version and SHA-256
  (`approvalOf`: sealed, approved, or needed; a new image needs a new approval), the camels "Compare
  again" left out, and the Comparisons tab's query. RTK Query `listComparisons`, `getComparison`
  (both asked again whenever a screen mounts: staleness is computed on every read),
  `createComparison`, `patchComparisonInputs`, `deleteComparison`, with a `Comparisons` tag that
  session deletes, reopens and history rebuilds also invalidate; a listener (`indexRefresh`) drops
  both lists when the open session's status, image or sealed report changes (finalize, reopen, seal).
- **History** (`#/history`, `?tab=comparisons` for the second tab): filters by event and measuring
  dates (local days sent as their first and last instants, both inclusive); a selection column (only
  eligible rows can be ticked; an ineligible row shows the engine's reason; a list refreshes the
  snapshots of the ticked camels it shows, so one reopened meanwhile turns ineligible); "Select all
  shown" (eligible rows, list order, up to the maximum); a sticky bar with the count, Clear and
  Compare; the delete confirmation names how many comparisons hold the session.
- **Compare dialog:** the camels in the operator's order — dragged by the handle or moved with the
  ▲ / ▼ buttons from the keyboard, removed with ✕ —, each with its approval: sealed in a report from
  its current image, approved here, or "Approve the image", which opens the engine's full image
  checked with WebCrypto (the single report's `OverlayApproval`; the bytes are held only while that
  dialog is open). The cover (title, event — prefilled when every camel shares one —, judge,
  council; trimmed only) and the language. Create is enabled once every camel is eligible and
  approved; the engine re-checks every camel, and a refusal lists each refused camel with its
  labelled reason. A created comparison opens at `#/comparisons/:id`.
- **Comparisons tab:** search, status, out of date or not, order (date or title — never a value),
  pages; each row shows the camels as chips in print order, the status, "Out of date" with each
  changed camel's reasons, "Sealed report out of date"; Open; Delete after a confirmation (the
  sessions stay).
- **`#/comparisons/:id`:** the cover and language, saved as one change (the next comparison data
  version); the camels in print order with their status when compared and now, the stale reasons and
  notes, the approval (the same dialog), a link to each session that still exists; an out-of-date
  alert; "Compare again" (each camel's History row read again with `GET /sessions?q=<id>`, the exact
  id picked; a deleted or ineligible camel left out and named; the dialog opens with the old order,
  cover and language); Delete.
- **Tests (Vitest, English and Arabic):** the slice (order, maximum, eligibility, refresh, approval by
  version and SHA-256, readiness, the shared event, create, Compare again, the bodies), History's
  day bounds, the listener, the Compare-again thunk, the selection column, the bar, the dialog
  (arrows, approval on the verified image, the POST body in the operator's order, a refusal listing
  the camels), the approval dialog (a mismatch cannot be approved), the comparisons table, History's
  tabs, filters, selection and delete notice, the comparison screen (order, stale reasons, cover
  PATCH, Compare again, delete). `npm run e2e` 16 passed, 11 skipped; `NAZEER_REAL=1`
  `e2e/flow-real.spec.ts` 11 of 11 (History's search step passes through the new tabs; the saved
  copy byte-identical).

**Differences from the plan, each small:**

- The limits come from `/meta/labels` (above) rather than a copy in the app.
- Approval is offered on the comparison screen too, not only in the Compare dialog: a comparison made
  earlier (or before the app restarted) can then be printed in Stage 5 without going back to History.
  Approvals live in the app's memory only (D10: approval is never stored), so a restart asks again
  for every image not sealed in a report.
- "Compare again" reads each camel's History row through the existing search (`q` matches the session
  id); no new engine filter. It replaces the camels ticked in History at that moment (one selection).
- Drag and drop uses the browser's own; it is not exercised in jsdom (the move it dispatches is).

**Open:** the word «ترتيب» (order vs ranking; it carries both in the engine's printed disclaimer) —
options in the wording backlog, "D12: the comparison screens"; as Stage 3 otherwise.

## Stage 5 — printing and sealing the comparison in the app (implemented 2026-10-17)

Status: **unit-tested, and printed and sealed in the built app** — the Electron app with its engine
printed and sealed comparisons of 1, 5 and 20 camels on the Stage 3 measurement's real frames
(`e2e/measure-comparison.spec.ts`, opt-in `NAZEER_MEASURE=1`), every seal PASS. That run calls
`print.exportComparison` directly with the stub-model engine (printing runs no model); the flow
through the screens with bag 006 and `best.pt` is Stage 6.

- **Print page:** `print.html` has a second mode (F2.11): `PrintJob` is a union
  (`kind: "report" | "comparison"`) and `main.tsx` lays out `PrintPage` or `ComparisonPage`.
  `comparisonModel.ts` checks every printed field of the comparison model 1.0 (texts only; a wrong
  field is named by its path; one cell per camel; positions 1..N). `ComparisonPage.tsx`: the cover
  (the engine's masthead with the operator's title, the cover rows, the camels in print order with
  their source and status), the comparison table in blocks of camel columns (6 in one language, 4 in
  both; each block repeats the measurement and kind columns; `table-layout: fixed`,
  `overflow-wrap: anywhere`; the header row repeats on every page; "—" for a missing measurement;
  "(k/n)" where a camel has a name twice), one section per camel starting on a new page (its heading
  and its approved overlay kept together, its session, status, source, Z_ref and ground lines, its
  measurements with the depth basis and flag chips, the snapped and counts lines, its sources), the
  signature wells, the provenance (without the data root) and the three disclaimers. An overlay
  appears only in its own section. The page is laid out at the A4 content width (186 mm), so the
  print page's own check `print_overflow` (a table cell wider than its column) measures what will be
  printed; the pre-flight also requires one overlay per camel, in order, each naming its camel
  (`print_overlay_order`).
- **Main (`print/exportComparison.ts`):** the comparison read again (not stale; the model version the
  screen shows); every camel approved — `approved_by_seal`, or the approval the renderer sends
  (version and SHA-256 of the current image), else `comparison_approval_required` naming the camels;
  the model bytes hashed against the stamp, schema 1.0, and naming the view's camels and images in
  the same order; each overlay fetched from the engine and hashed against the approval (the
  `--export` precedent: no image bytes over IPC); the face and logo; the hidden window; the upload with
  `X-Comparison-Model-Sha256`. One gate for both exports (`oneAtATime(…, gate)`): a report and a
  comparison never print at once.
- **Time limits (`printWindow.ts`):** each phase has its own — the page's layout and checks, then
  `printToPDF` itself (`withinTime`; a hung print destroys the window and ends with `print_timeout`).
  Comparison: 120 s each, upload 180 s; the single report: 90 s each (its print phase had no limit
  before, fact 5; flag).
- **"Save as" for a comparison:** `kind: "comparison"` in `report.saveAs` / `savedCopy` /
  `openSaved`; main reads the comparison view (which reads no frame) and
  `comparison.manifest.json`, fetches `GET /comparisons/{id}/report?v=N` and checks its SHA-256; the
  default name is `مقارنة_<n>_<date>.pdf` / `comparison_<n>_camels_<date>.pdf` by the UI language
  (`_v<N>` for N > 1); settings records keep the kind.
- **Renderer:** on `#/comparisons/:id` a "Print and seal" card (enabled once the comparison is
  current, every image approved and the cover saved; the reason shown otherwise), the print page's
  problems and warnings, a refused print's probe; the sealed PDF downloaded, checked against the
  engine's SHA-256 and shown with pdf.js, its probe with each camel's image page and its names'
  pages; "Save as", which opens by itself once the viewer verified a print sealed on that screen.
  The Comparisons tab offers "Save PDF as…" on sealed rows. The `comparisons` slice keeps the last
  print (`export`) and builds the approvals to send (`exportApprovals`).
- **New app codes** (labelled in `appErrors`): `comparison_approval_required`,
  `comparison_model_hash_mismatch`, `comparison_model_outdated`, `comparison_model_unreadable`,
  `print_overlay_order`, `print_overflow`. No engine change; the OpenAPI and the engine codes are
  unchanged.
- **Measured in Electron** (2026-10-17, `runs/comparison_print_20261017T191536Z`; each size in a
  fresh app and engine; times as main reports them; peak working sets from `app.getAppMetrics()`
  sampled every 200 ms, the engine's from Windows):

  | camels | language | pages | printed | sealed | fetch + images | lay out + print | seal (of which probes) | main | print window | engine |
  |---|---|---|---|---|---|---|---|---|---|---|
  | 1 | ar | 4 | 1.4 MB | 2.7 MB | 0.03 s | 0.52 s | 0.49 s (0.45) | 137 MB | 134 MB | 111 MB |
  | 5 | ar | 12 | 7.0 MB | 13.2 MB | 0.09 s | 0.88 s | 1.69 s (1.58) | 181 MB | 183 MB | 172 MB |
  | 20 | ar | 45 | 27.8 MB | 52.7 MB | 0.22 s | 2.50 s | 6.08 s (5.71) | 304 MB | 370 MB | 408 MB |
  | 20 | both | 50 | 27.9 MB | 52.8 MB | 0.23 s | 2.91 s | 6.97 s (6.57) | 311 MB | 395 MB | 410 MB |

  So the Stage 3 limits hold: the 20-camel print is 28 MB against the 64 MiB upload cap (2.3×), the
  slowest phase (the seal, 7 s) is 26× inside its 180 s limit and the print 41× inside 120 s. The
  page count differs from Stage 3's stand-in (26 pages): each camel's section here holds its frame
  lines and sources too, about two pages a camel.

**Differences from the plan:**

- The single report's print phase also gets a limit (90 s), as planned and flagged; its layout limit
  is unchanged.
- The approval check in main also accepts a camel the engine reports `approved_by_seal` (its own
  report, or this comparison's earlier seal of the same image), as Stage 2 defined it.
- The masthead shows the operator's title when there is one (the engine's default title otherwise);
  the cover rows repeat it.
- The measurement is an opt-in Playwright spec that calls the bridge, not a screen walk: no pointer
  or keyboard, so it can run beside the operator (D9).

**Open:** as Stage 4 (the word «ترتيب»), plus the 90 s print-phase limit for the single report and the
comparison's 120 / 120 / 180 s limits (flags).

## Stage 6 — end to end, the review and release 1.1.0 (implemented 2026-10-18)

D12 is implemented in full and ships in release 1.1.0 (D11 "Release 1.1.0"). Its status stays
**proposed** until the operator accepts it with the flags above.

- **End to end through the screens** (`e2e/helpers/comparison.ts`, shared by both specs). The
  sessions are set up over the engine API (two camels, each on its own proposed frame, frames with a
  side view tried first; a frame without a clear point above the camel is dropped with its session).
  Everything after that goes through the UI:
  1. History: tick the two rows; the Compare bar; the dialog lists them in the ticking order;
     ▲ moves the second up.
  2. Cover (title, event, judge, council) and language; Create stays disabled until each image is
     approved on the engine's full image.
  3. Create; print; sealed; the viewer verifies the bytes; the Save dialog (the
     `NAZEER_E2E_SAVE_DIALOG` folder switch) writes the default name, byte-identical to the sealed
     report.
  4. The engine's view and manifest: members in print order, each overlay on its own pages with
     |Δ| 0, every probe PASS, Plex only, no Type3, the seven attachments read back by SHA-256. The
     rows: the same name with 2D and 3D on separate rows, «عرض الصدر» paired by order (1/2) and
     (2/2), a name only one camel has with "—" for the other.
  5. The Comparisons tab lists it. Reopening one camel from History makes it stale with that
     camel's reason (`member_reopened`): the print is blocked, the PDF marked, the row ticked off
     in History. The cover is not stale (`report_stale` false: the two signals are separate,
     `comparison_store.py`).
  - `comparison-fast.spec.ts`: bag 004 with the ellipse stub, the Arabic UI, the folder «اختبار
    مقارنة»; 3/3 in 23 s.
  - `comparison-real.spec.ts` (`NAZEER_REAL=1`): bag 006 with `best.pt`, the English UI, language
    both, the folder «مقارنات»; the saved PDF read back with pdf.js (A4 pages = the probe's, the
    comparison and session ids in the text, only the Plex face, the attachments) and every required
    text found by the engine's probe; 3/3 in 1.1 min (6 pages, 5.1 MB).
- **The Sandbox tool** meets the Save dialog that opens by itself after a seal (production builds
  ignore the test switch). `scripts/sandbox/os-dialogs.mjs` (ASCII-only) finds the visible standard
  dialogs (`#32770`) of every process running the app's executable and posts them `IDCANCEL`.
  It matches processes by executable path, not by pid: the pid Playwright reported was not the one
  that owned the dialog. `sandbox-app.mjs` then expects "Not saved to a file yet". Checked on this
  laptop against the built app's real Save dialog (cancelled in 1 s). **Not yet run inside the
  Sandbox**: on 2026-10-18 the Sandbox's Windows enforced Smart App Control and refused the unsigned
  installer before the app could run (D11 "Release 1.1.0").
- **One read-only review** of the D12 diff: 7 findings, no blocker. Each is fixed with a test that
  fails without the fix:
  1. `ComparisonScreen` kept the previous comparison's cover draft when "Compare again" led to
     another comparison at the same model version. The screen is now keyed by the comparison id.
  2. A folder named `..x` inside the data root counted as outside it (`saveAs.ts`
     `isInsideFolder`; the same pattern in `engine/dataRoot.ts`). Only `..` and `..\…` leave the
     folder now.
  3. A share of this machine (`\localhost\E$\…`, measured: realpath keeps the UNC path) could reach
     the data root. The target folder and its parents are now compared with the root by identity
     (volume serial and file id, `fs.stat` bigint).
  4. The history index v2 migration reset comparisons whose delete had failed, so they showed again.
     Rows in `delete_failed` are now spared, as for sessions.
  5. React StrictMode (development only) dropped the Save offer after a first seal.
     `store/useDropSaveOffer.ts` drops only that screen's own offer, and only when no screen shows
     that report any more.
  6. A required name could match across a page boundary in the text probes. Pages are now joined
     with a newline after normalising, for the comparison and for the single report alike (stricter,
     never looser).
  7. An index row the migration had not yet refreshed (a busy session at the first list) has empty
     hashes, which read as "edited". An empty current hash is now unknown in `stale_reasons` and in
     the SQL twin. Revision and versions are still compared.
- **Checks** (2026-10-18): pytest 502 passed, 7 opt-in skipped; ruff check and format clean;
  typecheck, lint and format clean; `npm test` 863 passed, 1 skipped; `NAZEER_REAL=1 npm run e2e`
  33 passed, 3 opt-in skipped (flow-real 11/11, comparison-fast 3/3, comparison-real 3/3).
