# D9 — App stack: Electron + Vite + React + TypeScript + Tailwind CSS

Status: accepted 2026-10-10 (operator: Electron + Vite + React + TypeScript; "I want to use
also tailwind css"). The Tailwind scope (UI + print page) and the data-root rule are
assumptions from the review, not operator statements. App implementation decisions (toolchain,
version policy, fonts, labels, preload surface, security baseline) decided 2026-10-11 — see the
last section.

## Context

`app/` is empty. Node v24.21.0 and npm 11.19.0 are installed (no pnpm/yarn). The product
runs offline on the judging laptop. The PDF route (D7) prints a React + Tailwind page with
Electron's own Chromium.

## Decision

- Electron + Vite + React + TypeScript + Tailwind CSS. Tailwind is compiled at build time via
  the Vite plugin (`@tailwindcss/vite`, `@import "tailwindcss"` in the entry CSS); no CDN,
  no runtime fetch. Tailwind styles both the app UI and `print.html`.
- Tooling pin: as of 2026-10-10 electron-vite 5.0 accepts vite ^5–^7 while vite is at 8.x —
  pin vite 7.x if electron-vite is used, or use plain Vite + electron scripts.
- Data root: Electron main resolves `app.getPath("userData")` (dev: `--data-root`) and passes
  `--data-root <absolute path>` to the engine sidecar; the engine refuses to start otherwise.
  Never Desktop / Documents / OneDrive paths.
- Packaging: electron-builder (NSIS) with the PyInstaller one-dir engine as `extraResources`;
  the app spawns and supervises the engine on 127.0.0.1. (As built in Stage B: the engine is an
  embedded CPython 3.11.9 with the venv's runtime packages, not a PyInstaller build; D11.)
- The renderer never reads a `.bag`; it passes paths to the engine. PDF viewing in-app uses
  bundled pdf.js.

## Consequences

- Document the real `npm run dev / build / test / e2e / export` commands in `CLAUDE.md` in
  the same commit that adds `package.json`.
- `engine/wheels/` (offline wheelhouse of the pinned Python wheels, ≈ 2.5 MB for the
  Arabic/PDF deps) — whether to track it in git is open.
- One Playwright-Electron e2e covers the export flow; everything else stays in pytest/vitest.
  (As built: six Playwright-Electron specs — smoke, connectivity, license, export, and the operator
  flow fast and real; see "Tests and the end-to-end proof" below.)

## App implementation decisions (2026-10-11)

Status: decided with the operator during the app plan review (2026-10-11). What each item has
reached (code state → unit-tested → integration-tested → production-validated) is reported per
stage; results measured later are appended here.

- **Toolchain: electron-vite 5.0.0 with vite pinned to 7.3.6** (+ `@vitejs/plugin-react` 5.2.0, the
  last line that supports vite 7). One config builds main, two sandboxed preloads and a two-page
  renderer with HMR and main/preload hot restart, so there is no hand-written dev orchestration; its
  stable line peers `vite ^5 || ^6 || ^7`, and the vite-8 line (electron-vite 6.0.0-beta.8) is not
  used in a product. Build rules: a sandboxed preload can only `require` electron/events/timers/url,
  so each preload (`index`, `print`) must be one self-contained file — no externalised dependency
  (`externalizeDeps: false`) and no runtime module shared by the two entries (type-only imports are
  fine); `e2e/smoke.spec.ts` fails on any chunk `require`. electron-vite's `isolatedEntries` would
  enforce this, but in 5.0.0 its reporter calls `process.stdout.clearLine/moveCursor`
  unconditionally and the build crashes whenever stdout is not a TTY (measured 2026-10-11). The
  renderer root is `app/src/` with the pages `renderer/index.html` and `print/print.html`;
  `app/package.json` stays CommonJS.
- **Version policy:** exact pins (`save-exact`), lockfile kept, `engines.node >= 24.15.0`. Each
  package is pinned to its newest release that was at least 14 days old when pinned (cutoff
  2026-09-27 for the 2026-10-11 pins) within the newest majors whose peer ranges fit together — a
  supply-chain cooldown; patch bumps (Electron's Chromium fixes in particular) are revisited at
  packaging. TypeScript is 5.9.3 because openapi-typescript 7 peers `typescript ^5.x` (TS 7.0 is
  the native port). Electron 44.4.5 = Chromium 152 + Node 24.21.0. The full list is
  `app/package.json`.
- **Fonts:** the UI bundles `@fontsource/ibm-plex-sans-arabic` 5.3.0 (OFL-1.1) weights
  400/500/600/700 with `font-synthesis: none`. The print page uses only the engine's pinned
  `IBMPlexSansArabic-Regular.ttf` (sha256 `8e0f1046…0981`): Electron main reads it, checks it
  against the hash `npm run gen:cmap` pinned in `src/print/plex-cmap.json` (as built, Stage 7; this
  line first said `/health.arabic_stack.font_sha256`, the same pinned face) and hands the
  bytes to the page (`new FontFace`), so no font URL exists and dev cannot diverge from packaged;
  every printed string is weight 400 (B38; real_run measured this path as PASS). The parent
  template's four embedded "weights" are all Regular subsets — no Plex 500/600/700 exists in either
  repo.
- **Labels the engine does not provide:** `/meta/labels` covers kinds, sources, flags, rejections,
  candidate codes, statuses, buckets, targets, confidence and job states, but not API error codes,
  History `index_state`, job `stage` or the sidecar's fatal codes (shown while the engine is down).
  Those live in the app's `ar.json` / `en.json`; a parity test lists every code from the engine
  source; an unknown code renders the raw code plus the engine's message, never a blank.
- **UI language:** the selected language (Arabic by default, RTL) with a "show both languages"
  toggle; each half of a bilingual label sits in its own `dir` isolate. The PDF follows the
  report's explicit `language` input (`ar | en | both`).
- **Preload surface:** `window.nazeer = {engine: {getConnection, onStatus}, dialogs: {openBag,
  pickFolder}, scan: {captureFolders, setFolders}, print: {exportPdf}, app: {onBeforeQuit,
  openLogFolder}}`. `pickFolder`, `setFolders` and `openLogFolder` go beyond the surface listed in
  the app request; the operator accepted them on 2026-10-11 (they serve the configured capture
  folders and About's log-folder link). App and Chromium versions travel inside `getConnection()`.
  Every payload is validated in main and accepted only from the app's own frame. Stage 4 adds
  `engine.getStatus` and `engine.retry` (see "Engine supervisor and client" below); the licence
  addition adds `license.getStatus` and `license.activate` (D11).
- **Security baseline:** every window sandboxed with context isolation and no Node integration;
  the packaged renderer is served from `app://nazeer`, registered privileged (`standard`, `secure`,
  `supportFetchAPI`, `codeCache`) so it is a secure context (`crypto.subtle`) with a real origin for
  the engine's CORS list; CSP is sent as a response header (by the `app://` handler; in dev by a
  `webRequest` hook limited to the Vite server) and the print page gets its own policy without
  `connect-src`; permissions are denied except `local-network-access` and `loopback-network`
  (Chromium 152's Local Network Access for app:// → 127.0.0.1; the code has allowed both names
  since Stage 1, this line named the first only until Stage 9) and `clipboard-sanitized-write`, for
  the app origins only;
  navigation, `window.open` and webviews are blocked; the production menu has no reload or
  DevTools. The engine token is 32 random bytes per spawn; it is visible on the engine's command
  line to processes of the same Windows user, which sit inside the trust boundary anyway.
- **Packaging** (done in Stage B, 2026-10-12; D11): renderer libraries are bundled by Vite, and
  `electron-builder.yml` keeps `node_modules` out of the asar (`files: "!node_modules/**/*"`; the
  Stage B build's `app.asar` listed 42 entries, none from `node_modules`).

### Design system (Stage 2, 2026-10-11)

- Tokens live in `app/src/renderer/design/tokens.css` as `--nz-*` properties per `[data-theme]`
  scope, mapped to Tailwind utilities with `@theme inline` (Tailwind's default palette removed).
  Light = the parent report's sand/terracotta, dark = its near-black; several template colours were
  darkened to pass WCAG AA (e.g. muted text `#8a7a66` → `#66584a`, accent text `#b25f44` →
  `#8e4329`). Every text/surface and control pair is checked in both themes by
  `design/contrast.test.ts` (122 checks). Measurement swatches repeat the engine's
  `assign_color(0..11)` (ported and compared by a test); the canvas draws `row.display_color`.
- The production build emits the four Plex weights as 12 woff2 files (≈ 277 KB) plus woff
  fallbacks; the tiny Cyrillic subsets are inlined as `data:` URIs, hence `font-src 'self' data:`.
- Tailwind's built-in `rtl:` / `ltr:` variants also match anything inside a `[dir="rtl"]` element,
  so an LTR island in the RTL page (ids, code, the measuring canvas) mirrored its arrows
  (seen in the gallery); they are redefined from the computed direction (`&:dir(rtl)`).
- Bidi rendering rules: each half of a bilingual label in its own `lang` + `dir` isolate; Latin
  runs inside Arabic text (engine labels such as "… Z_ref (> 10 %)", "WCAG AA") wrapped in LTR
  `<bdi>` isolates at render time (`lib/bidi.tsx`) — the characters are unchanged, so the PDF text
  layer and the engine's text probe see the same strings; this fixes, app-side, the CLAUDE.md
  pitfall of the closing parenthesis jumping to the line start (verified in the gallery; the print
  page reuses it in Stage 7). Numbers sit in LTR isolates with ASCII digits; a unit follows outside
  the isolate in the surrounding direction (an Arabic unit inside the isolate read "م 1.842").
- Invisible characters (bidi controls, zero-width marks, no-break spaces) are never typed into app
  sources; `src/shared/no-invisible-chars.test.ts` fails on any (three had slipped in as literal
  characters where `\u` escapes were meant, and were replaced by `String.fromCharCode`).
- Test layout: Vitest projects `node` (main, shared, and renderer checks that read files:
  `*.node.test.ts`) and `web` (jsdom); the web project lets `design/tokens.css?raw` through
  (`test.css.include`), because Vitest stubs CSS imports as empty strings otherwise.

### Component library (Stage 3, 2026-10-12)

- Primitives in `app/src/renderer/components/ui/` on Radix (Dialog, AlertDialog, Tooltip, Toast,
  Select, Checkbox, Switch, Slider, Tabs, ToggleGroup, DropdownMenu, Popover, ScrollArea, Slot) and
  `cva`; domain components in `components/domain/`. Every value, uncertainty, depth basis, flag,
  rejection and confidence is rendered from the engine's `presentation` and `/meta/labels`
  (`LabelsProvider` / `CodeLabel`, raw code when a label is missing); the app computes none of them.
  `/meta/labels` is checked at runtime (`api/labels.ts` `parseLabels`). Errors are one plain shape
  (`api/errors.ts`); the app's own codes (`network_error`, `invalid_response`,
  `overlay_hash_mismatch`) are labelled in i18n `appErrors`, and a test keeps them disjoint from
  the engine's codes.
- Measuring canvas (render only; input in Stage 6): one SVG in image coordinates with the frame as
  an SVG `<image>`, not an `<img>` under the SVG as the plan said, so zoom and pan are only the
  `viewBox` and `getScreenCTM().inverse()` maps a pointer to image pixels. It follows
  `engine/nazeer_engine/overlay.py`: depth-provenance markers on 3D kinds only, rejected rows grey
  and dashed, flagged 3D-curve segments red, angle arcs at min(38 px, 0.35 × the shorter ray), the
  same label anchors, and the same greedy label placement (`placeLabels`, kept inside the canvas).
  Strokes do not scale with zoom; markers keep their screen size (overlay sizes × 1.3). It adds
  what only editing needs: squares for Shift-click ground targets, the mask tint, the depth-valid
  box, a selection halo, the clicks in progress and a crosshair (theme-independent colours in
  `design/index.ts` `CANVAS_STYLE`, like `OVERLAY_STYLE`).
- pdf.js 6.3.289 (`lib/pdf.ts`): `isEvalSupported` no longer exists (the 6.x build contains no
  `new Function`, and the CSP forbids eval anyway); `useWasm: false` (Chromium PDFs need no JPX or
  JBIG2 decoder, ICC images fall back to their alternate colour space, and the CSP has no
  `'wasm-unsafe-eval'`), `enableXfa: false`, `stopAtErrors: true`. pdf.js transfers its input buffer
  to the worker, so it gets a copy; a document is released by destroying its loading task (the 6.x
  document proxy has no `destroy`). Measured on the real sealed report of the dev-root session
  (`report_v1.pdf`, bag 006): with these options pdf.js opens it in Node (5 pages, the text layer
  contains the names, attachments = overlay PNG, session.json, report model; `lib/pdf.node.test.ts`,
  runs where `runs/dev_root` exists) and renders it in the dev app with its bytes' SHA-256 equal to
  `outputs.report.sha256`. **Found in the screenshots:** pdf.js draws glyphs with canvas `fillText`,
  whose direction is inherited from the `<canvas>` element; on the Arabic (RTL) page every glyph was
  drawn one advance too far left (garbled text). The canvas is `dir="ltr"` (test asserts it).
- File paths: a Windows path with an Arabic folder name is reordered by the bidi algorithm even in
  an LTR isolate (the digits after the Arabic name become Arabic numbers:
  `D:\captures\اختبار\20260414_181203-007.bag` displayed as `…\007-181203_20260414\اختبار.bag`).
  `PathText` isolates every segment; all displayed paths use it.
- The `/design` gallery has three dev-only pages (`/design`, `/design/components`,
  `/design/domain`; absent from the production bundle). The domain page renders the components on
  the fixtures and on the dev data root's real files, served by the Vite dev server through `/@fs/`
  (`server.fs.allow` gains `../runs`, dev server only): the frame and mask, the engine's overlay
  PNG and the sealed PDF, whose SHA-256 the page computes with WebCrypto — both equal the engine's
  stamps (`914513bd…475f7`, `85c9876b…b73237`).
- Production bundle notes for packaging: the pdf.js worker (1.27 MB) is emitted as an asset (Vite
  emits `?url` assets while scanning the module graph; since Stage 6 the report screen mounts the
  viewer); the renderer output is not minified with the current electron-vite configuration.

### Engine supervisor and client (Stage 4, 2026-10-12)

- **Data root** (`main/engine/dataRoot.ts`): packaged = `app.getPath("userData")`; dev =
  `--data-root <dir>` | `NAZEER_DATA_ROOT` | `<repo>\runs\dev_root`. The engine's rules (absolute;
  no Desktop / Documents / OneDrive segment; not under `%OneDrive%`, `%OneDriveConsumer%`,
  `%OneDriveCommercial%`) are checked before spawning, so a bad root is a fatal screen with the
  engine's own code `data_root_invalid`, not an exit 2.
- **Spawn** (`command.ts`, `process.ts`): dev runs `engine\.venv\Scripts\python.exe -m
  nazeer_engine` in `engine\`; production runs the installer's embedded CPython,
  `<resources>\engine\python\python.exe -I -u -B -m nazeer_engine` in `<resources>\engine` (Stage B,
  D11; it replaced the planned PyInstaller `nazeer-engine.exe`). Arguments: `--data-root`,
  `--port 0`, `--token=<64 hex>` (new per spawn), one `--cors-origin` per renderer origin
  (`app://nazeer`, plus the Vite origin in dev; the flag replaces the engine's defaults). Dev-only
  switches: `NAZEER_STUB_MODEL=1` (adds `--stub-model` and `NAZEER_ENGINE_DEV=1`),
  `NAZEER_ENGINE_NO_WARMUP=1`, `NAZEER_ENGINE_PYTHON`; dev passes the environment through;
  production drops `NAZEER_*`, `PYTHON*`, `YOLO_*`, `OTEL_*`, `FASTAPI_OTEL_*` and `MPLCONFIGDIR`,
  so the engine's own offline defaults always apply. `windowsHide`, stdout read for the whole run
  (the pipe never fills), exit reported after both pipes drained (`close`, or 1 s after `exit`:
  the venv launcher's child inherits the pipes).
- **Identity and states** (`supervisor.ts`): the engine is identified by the ready line's `pid`
  (in development the spawned process is the venv launcher; in production it is the engine
  itself, checked by the Stage B staging smoke). `starting → ready`; before ready, exit 2 / 3 / 5 is
  fatal at once; any other exit, or no ready line within 180 s, gets one retry (1.5 s) and is then
  fatal (`engine_exited` with the last 20 stderr lines, `engine_start_timeout`); a missing
  executable is `engine_spawn_failed`; a ready line without `token_required` is refused
  (`engine_protocol_error`). After ready an exit is a crash: restart after 1 / 2 / 4 / 8 / 16 / 30 s
  (reset after 5 minutes of stable running); more than 5 restarts within 5 minutes is
  `engine_restart_limit` (`restartPolicy.ts`). A replacement that dies before ready counts as
  another crash. These supervisor codes are app codes (i18n `appErrors`; a test scans
  `supervisor.ts` so each has both labels).
- **Data root locked (exit 6)** (`orphan.ts`): the fatal line names the lock holder's pid and port;
  the supervisor asks that port's `/health` (open, no token). When the pid and the data root both
  match, the holder is an engine left on our data root (typically by an app that was killed). In
  dev it is stopped and the start continues. A packaged app stops it only when the operator presses
  "Try again" on the fatal screen, which then explains this, or when it is an engine this app
  started itself. The plan's text was "stop it and retry / quit"; **the operator confirmed this
  reading on 2026-10-12** ("Try again" stops a confirmed left-over engine, pid and data folder
  matching the lock file; no Task Manager step). Re-verification happens on every start cycle. An unidentifiable holder (no port yet, no
  answer, another pid or data root) gets one retry and is never killed.
- **Watchdog**: `/health` every 15 s (5 s timeout, the ready pid must answer). Two misses in a row
  set `unresponsive` (a banner); the engine is kept running, since a long finalize must not be killed.
- **Logs** (`logs.ts`): `<userData>\logs\app-engine-stderr.log` = the engine's stderr plus the
  supervisor's lifecycle lines (the token is masked in the logged command line; the engine's stderr
  is written as it comes, and the engine never prints the token); one rotation to `.1` at 5 MiB.
  The engine keeps its own `<data root>\logs\engine.log`.
- **Quit** (`quit.ts`): the window's `close` and the app's `before-quit` first ask the renderer to
  flush (`app.onBeforeQuit`, answer within 3 s); unsaved changes or no answer → a bilingual
  "Quit anyway?" dialog (main owns these few strings, Arabic line first). Then `will-quit` is held
  while the engine is stopped (`POST /system/shutdown`, kill after 8 s: launcher and engine pid)
  and the HTTP cache (token-bearing asset URLs) is cleared. A renderer that crashes is logged and
  reloaded — since Stage 9 at most 3 times in 5 minutes, and never after `launch-failed` or
  `integrity-failure`; then a bilingual dialog offers "Try again" or "Quit"
  (`main/rendererRecovery.ts`).
- **Preload surface additions:** `engine.getStatus()` (the state at load; every
  `EngineStatusEvent` carries an increasing `seq`, so a reply older than a pushed event is dropped)
  and `engine.retry()` (the fatal screen's "Try again"). `print.exportPdf` arrives with the print
  page in Stage 7; its `ExportRequest` shape and validator are fixed in `shared/ipc.ts`.
- **Capture-folder scan** (`scan.ts`): paths and stat only; depth ≤ 3, ≤ 2 000 entries, ≤ 200 bags,
  ≤ 3 s (since Stage 9 also while one listing hangs, e.g. an unreachable network share: the scan
  stops waiting and names the folder); links and junctions are never followed (tested with a real
  junction); `truncated` when
  any bound is hit. The folders are stored in `<userData>\app-settings.json` (atomic write; a
  damaged file means the defaults and a log line).
- **Renderer client** (`api/client.ts`, `urls.ts`, `connection.ts`, `engineApi.ts`):
  openapi-fetch over the generated paths with the `X-Nazeer-Token` header and
  `cache: "no-store"`; every result is data or a plain `ApiErrorShape` (the engine's envelope kept;
  `network_error`; a malformed 2xx body is `invalid_response`). The ETag is read only from the six
  operations whose response is a `SessionView` (`create_session`, `get_session`, `put_document`,
  `finalize_session`, `reopen_session`, `patch_report_inputs`; a test derives the list from
  `openapi.json`). URLs for `<img>`, EventSource and pdf.js get the token with
  `URL.searchParams.set` and are refused when they point anywhere but the engine. RTK Query uses
  `fakeBaseQuery<ApiErrorShape>()`; a new connection (restart: new port, token, pid) rebuilds the
  client and resets the API cache. Operator routes render only while the engine is ready (waiting
  panel, fatal panel with Try again / Open the log folder / Quit); banners for a missing Arabic
  stack, the stub model, an unresponsive engine and unloadable labels. About shows the connection,
  `/health`, `/versions` and the labels count.
- **Connectivity, measured 2026-10-12** (`e2e/connectivity.spec.ts`, production build, its own
  stub engine). Passed from `app://nazeer`:
  - a token-header fetch (200), and the same fetch without the token (401 `unauthorized`);
  - the app's own client rendering `/health` on About;
  - an `<img crossOrigin ?token>` engine asset drawn into a canvas that stays readable, while the
    same URL without the token fails;
  - the WebCrypto SHA-256 of `rgb.png` fetched from the engine equal to Node's SHA-256 of the file;
  - kill the engine pid → restarted in about 2 s with a new pid, port and token, after which the
    old token gets 401;
  - quitting stops the engine by shutdown, not kill.

  Chromium 152's Local Network Access did not block app:// → 127.0.0.1 and showed no prompt
  (permission handler as above), so the loopback-server contingency is not needed.
  **EventSource:** blocked at first by Smart App Control (next item); verified later the same day,
  once the block had lifted: `progress` events from a stub walk on bag 004, then `cancelled`.
- **Finding (needs operator decision): Windows Smart App Control blocked unsigned engine DLLs —
  intermittently** (the measurements and their reading are in D11, "Smart App Control").
  - **Evidence:** this laptop's Smart App Control is in enforcement
    (`HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy\VerifiedAndReputablePolicyState = 1`; Code
    Integrity events 3033/3077, policy `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`).
  - **Blocked 12:40–13:13:** `pyrealsense2.cp311-win_amd64.pyd` (`ImportError: … An Application
    Control policy has blocked this file`) and matplotlib's `_c_internal_utils`; meanwhile the
    engine could not open a bag (500 `internal_error`) and could not draw an overlay.
  - **Allowed again by 14:56** with Smart App Control still enforcing: the engine suite passed
    (435 tests) and EventSource was verified. The decisions are reputation-based (cloud lookups);
    an offline field laptop is not measured.
  - **Not changed by the app:** turning Smart App Control off cannot be undone without resetting
    Windows; signing the product is the lasting fix (D11).
  - **Operator, 2026-10-12:** still undecided for the field laptop, and not a blocker for the
    installer. No Smart App Control setting is changed on any machine; the field laptop is tested
    once a signed installer exists, not before (D11).
- **Finding fixed in Stage A1 (operator-approved engine edit, 2026-10-12): `arabic_stack_ok` said
  true when matplotlib could not load** (`arabic.native_layout()` swallowed the ImportError; the
  reshaper fallback reported ok, and finalize then failed with an untyped 500). The stack check now
  imports matplotlib's compiled modules and reports the stack missing when one fails; finalize
  answers the typed `arabic_stack_missing`.

### Redux store (Stage 5, 2026-10-12)

- **Slices:** `ui`, `engine`, `license` (earlier stages), and new: `bag`, `candidates`, `session`,
  `report`, `history`. The RTK Query cache holds what is only read: health, versions, labels,
  recent bags, a candidate set, History's list, stats, backup, rebuild and delete. The open session
  is not in it: it lives in the `session` slice with its autosave. Nothing non-serialisable is in
  state; the engine client, the job's EventSource, the timers and the AbortControllers live
  outside Redux.
- **Changes from the Stage 0 slice table:**
  - no `labels` slice: the Stage 4 `getLabels` query already holds them, and a slice would copy the
    cache;
  - `ui` keeps the preferences only; toasts and dialogs come with the screens (Stage 6);
  - `report` holds the overlay check and the approval now; export and the PDF come in Stage 7;
  - `history` holds the query, and the list is RTK Query's.
- **Flows** run in the listener middleware, one instance per store: autosave, the hover and preview
  channels, finalize with the overlay check, and the candidate job (SSE, polling every 500 ms when
  the stream fails, `job_busy` attaches to the running job, cancel, stop). Thunks: open, create
  and reopen a session, report inputs, inspect a bag. The rules are in D10, "App side of C3.4".
- **Session views are checked once** (`api/sessionView.ts`): openapi-fetch's response types widen
  tuples (`points` arrives as `number[][]`), so the typed client's data is narrowed at one place,
  with a runtime check, and a body without the fields the store uses is `invalid_response`.
- **Quitting** now flushes autosave (`app.onBeforeQuit`), and answers whether unsaved work remains.
- **Tested:** unit tests against a simulated engine that applies the engine's save and finalize
  rules (`src/renderer/test/sessionEngine.ts`). A mutation run broke six rules one at a time (no
  debounce, no If-Match, a rebase that drops the engine's side, a terminal error retried, two
  probes in flight, any overlay hash accepted); each was caught by a test. Also run against the real
  engine (`npm run test:store-real`: the stub-model engine on a copy of the dev session; reopen,
  autosave, a concurrent writer's save rebased, report inputs, finalize, the overlay re-hashed).

### Screens (Stage 6, 2026-10-12)

- **Routes** (hash): `#/` open a recording · `#/candidates` the frame search ·
  `#/candidates/:fp/:ph` the proposed frames · `#/sessions/:id` measuring · `…/finalize` finalize
  and approve · `…/report` the report details and the sealed PDF · `#/history` · `#/about`; any
  other route says the page does not exist. The header adds the work in progress: the frame search
  and the open session (with its camel id).
- **A session route** loads the session it names unless it is the open one
  (`screens/session/SessionGate.tsx`). When another session would replace an open one with unsaved
  work (opening, creating, reopening), its autosave is flushed first; work that still cannot be
  saved is not dropped silently: the operator confirms (`useUnsavedGuard`).
- **Measuring** (`screens/measure/`):
  - the input rules are pure functions (`components/domain/measure/interaction.ts`): 2 clicks for a
    distance and for the angle from horizontal, 3 for a 3-point angle (vertex first), 2 or more for
    a curve, two line measurements for a 4-point angle; Shift marks a ground point for the 3D kinds
    only; a click on the last point finishes a curve (a double-click does that, and so does a second
    Enter), and is ignored by the fixed-count kinds (a double-click makes no zero-length segment);
    pointer positions map to image pixels with `getScreenCTM().inverse()`, inside the frame, two
    decimals;
  - keyboard: with the canvas focused, arrows move the crosshair 1 px (Shift: 10 px), the first
    Enter shows it in the middle of the view and the next places a point (Shift+Enter: a ground
    point), Backspace removes the last point. Outside a text field, dialog or menu: 1–8 choose the
    kind; Esc cancels the shape, then the kind, then the selection; Ctrl+Z / Ctrl+Y undo and redo
    (Ctrl+Z while drawing removes the last point); Delete removes the selected measurement; + / − / 0
    zoom (1–16×). The wheel zooms around the pointer; the middle button, or Space + drag, pans;
  - a finished shape is named before it enters the draft;
  - hover and the live preview go out at most once per animation frame, or after 50 ms when
    Chromium draws no frame: it draws none for a window covered by others, and the Stage 6 run
    found the hover readout empty that way;
  - a measurement just added, or a point just dragged, is previewed once with its exact input, so
    the list shows the engine's value until the autosave lands;
  - editing: rename, note, colour (the engine's palette, or automatic: by position), reorder,
    delete and undo, and dragging a point of the selected measurement (no kind chosen);
  - the 4-point angle tool flushes autosave first (the engine previews it against the stored lines)
    and lists the session's lines beside the canvas too;
  - **the rows shown** (decision): a row is always the engine's — the stored row when the draft
    holds the same input (saved); the stored row or the last preview for the same geometry (kind,
    points, targets, lines) under the draft's name, note and colour (not saved yet / preview: a
    rename keeps its value on screen); otherwise no value ("the engine computes the value when it
    is saved") and its clicks drawn dashed. A 4-point angle waits while one of its lines is changed,
    added or deleted and not saved (`store/session/selectors.ts`);
  - leaving the screen, or the window losing focus, flushes autosave;
  - text fields carry the engine's limits: measurement names 200 characters, their notes 2000, camel
    id 64, operator 100, session notes 4000.
- **Finalize and approve** (`screens/FinalizeScreen.tsx`): checks first (the camel id is required
  and the button waits for it; a conflict sends the operator back; rejected rows are flagged), then
  finalize and the overlay check. The **verified bytes** stay outside Redux
  (`store/services/overlayBytes.ts`), kept for exactly one session, overlay version and SHA-256:
  the approval shows those bytes through a `blob:` URL, not a second download, and the print step
  (Stage 7) sends those bytes. A sealed session opened later is checked again.
- **Report** (`screens/ReportScreen.tsx`): the report details form comes from the engine's report
  model (labels, scoring forms, observation fields), so it waits for finalize; saving sends only
  what changed, trimmed (`PATCH …/report-inputs`); on a sealed session that writes a new report model
  version. An exported session's PDF is downloaded and shown only when its SHA-256 matches the
  engine's, with the checks from its manifest. Printing: Stage 7 ("Printing" below).
- **History** (`screens/HistoryScreen.tsx`): search (300 ms after typing stops; the engine looks in
  the camel id, operator, recording, session id and measurement names), status, index state, order,
  pages of 50. Open: every session opens on the measuring screen, read-only when sealed, with links
  to its approval and report. Reopen: load, then `POST …/reopen`. Delete: after a confirmation; the
  open session is forgotten first; `session_busy` is tried again up to 4 times, 500 ms apart; a 404
  counts as done. The maintenance panel: stats, the last reconcile, a backup to the default place,
  a rebuild.
- **No toasts** (the Stage 0 component list had them): every notice stays where it happened (the
  backup's path in the maintenance panel, errors as ErrorPanels); the `ui` slice keeps preferences
  only.
- **Fixed on the way:**
  - in Arabic, a number's sign left its number ("+155.7°" showed as "155.7°+"): `lib/bidi.tsx` now
    isolates a sign that starts a number (at the start, after a space or after "(") with it; a
    hyphen inside a word ("مرحلة-6") stays outside;
  - the probe fallback above.
- **Tested:** each screen against the simulated engine (`test/sessionEngine.ts`, now with report
  inputs and the report model) or a scripted one (`connectScriptedEngine`): drawing every rule with
  the keyboard, naming, autosave, a conflict resolved, read-only and reopen; finalize, the verified
  image, approval, on to the report; History's search, delete with a busy retry, a failed delete,
  reopen, backup; Home's inspect and frame search; picking a frame starts a session with the
  candidate's reference; the report details patch.
- **Run on the real engine** (2026-10-12; the dev app with `best.pt` on a fresh data root, bag 006,
  driven over CDP like an operator): 24/24 checks. Frame search 38.7 s (12 frames), a session on the
  side view; all eight kinds drawn with the mouse and one with the keyboard, a ground point with
  Shift-click, a curve finished by a click on its last point and one by a double-click, a 4-point
  angle between the two 3D lines; the hover readout; rename, colour, note, reorder, delete and
  Ctrl+Z, a dragged point (1.890 m → 1.818 m); finalize, the overlay shown from bytes verified with
  WebCrypto, approval; report details saved (report model v2); History search by the Arabic camel
  id, reopen (outputs stale), delete (the folder in the trash, the engine answers 404); About; no
  renderer console error. Screenshots in `runs\app_snaps\stage6\`, the checks in
  `runs\stage6_walk_<UTC>\summary.json`. Printing and sealing the PDF are Stage 7.

### Printing (Stage 7, 2026-10-12)

- **Confirmed by the operator (2026-10-12):** the "rows shown" rule of Stage 6, restated to them in
  full (what a row shows while a rename waits for the debounce or is being saved, editing again before
  the save lands, leaving the screen, quitting, a failing save). One addition: the open session's
  entry in the header carries its save state while the engine does not hold everything (unsaved,
  saving, not saved, offline, conflict, finalizing: `UnsavedBadge`, `screens/OperatorLayout.tsx`),
  so a save that keeps failing stays visible from Home, History and About as well — while the
  engine is ready; while it is not, its waiting or fatal panel replaces every screen and the
  session's state waits in the store. A session made read-only elsewhere (`blocked`) shows its kept
  draft on the measuring screen, not in the header.
- **Wording (operator decision, 2026-10-12):** finalizing a session is «إقفال» (إقفال الجلسة،
  جارٍ الإقفال…، أقفل الجلسة أولًا؛ the state مُقفلة); approving the engine's image keeps «اعتماد»
  (اعتماد هذه الصورة، معتمدة، الصورة المعتمدة), the sense of the report's own «معتمدة من شركة نظير»
  (certified). 21 app strings and the engine's `finalized` status label changed; the development
  gallery's «أعراف الصورة المعتمدة» (a mistranslation of "Overlay conventions") became «اصطلاحات
  صورة المحرك». In English, "sealed" now names the exported PDF only; the session state says
  "finalized" (5 strings).
- **Preload surface:** `print.exportPdf(request) → ExportResult` in the operator window. The hidden
  print window has its own preload (`preload/print.ts`, `window.nazeerPrint`: `getJob()`,
  `ready(preflight)`) on its own channels (`shared/printChannels.ts`): the two sandboxed preloads
  share no runtime module, so neither needs a chunk (e2e smoke). Main answers the print channels only
  for the window it opened for the job (its webContents id, the main frame, `/print/print.html`).
- **Validation:** `validateExportRequest` (a session id; the overlay's version, SHA-256 and bytes,
  1 B to 32 MiB; the report model's version and SHA-256; no other field) and `validatePreflight`
  (at most 200 problems and 200 warnings, snake_case codes, details up to 64 KiB each).
- **The print window:** hidden (794 × 1123, A4 at 96 px per inch), sandboxed, context-isolated, no
  Node, its own in-memory partition (no `persist:`) with the same permission policy and, in built
  code, the app:// handler; the print preload; background throttling off; DevTools off; destroyed
  after the job, its storage cleared. The CSP is Stage 1's print policy, unchanged (no network,
  images from `blob:`/`data:`, fonts from self, `data:`, `blob:`). One export at a time
  (`export_busy`). The print pipeline itself is in D7 "Electron side".
- **The face:** only the engine's pinned IBM Plex Sans Arabic Regular, read by main from the
  engine's assets (`<repo>\engine\nazeer_engine\assets` in development,
  `<resources>\engine\nazeer_engine\assets` packaged: `engine/command.ts` `engineAssetsDir`),
  SHA-256 checked against `src/print/plex-cmap.json` (generated from that TTF by `npm run gen:cmap`;
  a test fails when they disagree) and added with `FontFace` from its bytes as "Nazeer Print Plex":
  no URL, so no `font-src` change.
- **App version headers:** the engine client now sends `X-App-Version`, `X-Electron` and
  `X-Chromium` on every call (finalize and the report-input change lacked them, so the session's
  library-version stamp missed the app's versions), and main's upload sends them too; the manifest's
  `printer` block records them.
- **Errors:** the export's own codes are app codes (`appErrors.*`; `api/errors.ts`
  `PRINT_ERROR_CODES`, 22 codes), labelled in Arabic and English like the others.
- **The report screen:** Print (or "Print again"), the progress, the sealed result, the engine's
  probe of a refused PDF with the file it kept, the print page's own findings, and warnings
  (characters printed in a fallback face). Two fixes found by the Stage 7 run: the sealed PDF's checks
  are read again for every sealed version (the manifest keeps its URL, and the read made at finalize
  time, without probes, stayed on screen: "the check result could not be read"); and in `lib/bidi.tsx`
  a Latin run now ends at a closing bracket it did not open (the report printed "تباين العمق (MSE)
  0.0231" as "MSE) 0.0231(": the run had swallowed the ")"; now "MSE" and "0.0231" are isolated
  separately). Both have tests; the bidi fix applies to the UI too.
- **npm scripts:** `gen:cmap` (the face's coverage table) and `export` (the headless re-export, D7).

### Tests and the end-to-end proof (Stage 8, 2026-10-13)

The original consequence above ("one Playwright-Electron e2e covers the export flow") grew stage by
stage into six specs; Stage 8 adds the two that drive the whole operator flow through the UI.

- **`e2e/flow-fast.spec.ts` (in `npm run e2e`):** the built app with the stub-model engine and
  `NAZEER_STUB_MASK=ellipse` (D10 "Development stub mask") on the real bag 004, in the Arabic UI:
  "Choose a .bag file…" with the OS dialog answered in main (`dialog.showOpenDialog` replaced through
  `electronApp.evaluate`), the frame search, a proposed frame, four named measurements (a 2D distance
  with the keyboard crosshair, a 3D distance and a 3D curve with the mouse, and a 2D distance placed
  with the keyboard while the mouse rests on the canvas), finalize, approval on the overlay verified
  with WebCrypto, print; the engine seals it (strict probes PASS, pixel |Δ| 0, every name found, one
  Plex subset, attachments). About 20 s; skipped when bag 004 is absent.
- **`e2e/flow-real.spec.ts` (`NAZEER_REAL=1`):** the built app with the real engine (`best.pt`,
  warmed up) on bag 006, in the English UI, eleven steps with every check `engine/tools/real_run.py`
  makes, on what the app produced: health with the pinned model and the Arabic stack; rgb8; the
  frame search (whole bag, ≥ 1 proposal, the operator gates, ≥ 1.5 s apart, one tile per proposal);
  revision 0 and Z_ref = the picked candidate's mask median; depth sources as placed, once from the
  app's own hover requests (inside: direct; a click 15 px above the silhouette: snapped to the
  camel; Shift over the ground with a 3D tool: the ground's own depth) and once on the saved rows;
  all eight kinds drawn through the UI with every autosave answered 200 at the next revision (no
  conflict); a replay of the stored revision is a 200 with the same ETag and a stale save a 409
  `stale_revision` carrying the current view; previews equal the saved values; the 3D curve's 2D
  cross-check equals the 2D curve on the same points; finalize and approve in the UI, the overlay
  W × (H + 120) with the hash the app verified, the report model's hash; report details in Arabic,
  print and seal (verdict PASS with strict text and font probes, pixel |Δ| 0, every
  `required_report_texts` string found); the sealed PDF read back with pdf.js (its SHA-256 =
  `outputs.report.sha256`, A4 pages, only `IBMPlexSansArabic` faces and no Type3, the attachments
  `overlay_vN.png`, `report_model.json`, `session.json`, the first two byte-identical to the approved
  overlay and the printed model, `session.json` schema 2.1 with every measurement); History: the
  engine's search and the History screen find the session by its Arabic camel ID, exported. Content
  only, never PDF bytes. Run of 2026-10-13: 11/11 in 59–84 s (bag 006: 1751 pairs, 351 sampled, 12
  proposed in 35 s; 10 measurements, 10 autosaves; report v1 from model v2: 5 pages, 14 required
  texts).
- **How the specs drive the app:** labels come from `ar.json` / `en.json` by key
  (`e2e/helpers/labels.ts`), so the Arabic wording review changes no spec; the engine is called
  from the test process with the app's own connection (port and token: no CORS involved); click
  positions come from the session's own mask, decoded with a canvas in the renderer
  (`e2e/helpers/flow.ts` `framePoints`: inside ≥ 6 px from the edge, a miss 15 px above the
  silhouette with no mask pixel within 8 px, the ground 6 px below the drawn ground line).
- **pdf.js 6 in Node** (`e2e/helpers/pdf.ts`, the legacy build with the app's own options):
  `getAttachments()` returns a `Map` of names without their bytes, and `getAttachmentContent(id)`
  returns the bytes (earlier versions returned an object with the content); `fontExtraProperties`
  gives each font's PDF name and its Type3 flag.
- **Unit tests added:** `shared/offline.test.ts` (the app's sources name no host but the loopback
  engine or a `.invalid` placeholder; no stylesheet or font imported from a URL, no updater, crash
  upload, external link or Node network request; the policy half stays in `csp.test.ts`); the print
  page reads no stored state while it renders (a stored "English, both languages" preference and an
  Arabic report: Arabic only, and no `Storage` method called).
- **Development switch:** `NAZEER_STUB_MASK=<mode>` passes `--stub-mask <mode>` to a development
  engine (`main/engine/command.ts`; ignored in production builds; the engine refuses it without the
  stub model).
- **The manual pass on bag 006** (`npm run dev`, the real model, a fresh data root, driven over CDP
  as in Stage 7: all eight kinds, editing, finalize, approve, three prints, History, then
  `npm run export` with the app closed): 44 of 45 checks passed (`runs\stage8_walk_20261013T160422Z`;
  a first run got through 42 of 43 before the script's own clean-up failed, Electron still holding
  its temporary profile); three PDFs sealed with strict probes, the headless re-export PASS, no
  renderer console error. The one failure, in both runs: the keyboard angle's points were placed at
  fractional positions, i.e. under a pointer,
  not at the crosshair, although the script had moved its own mouse off the canvas. The window of
  `npm run dev` is a real window on the desktop, and mouse movement over it moves the shared
  crosshair (by design); the e2e specs, whose keyboard points land exactly, cover the path
  deterministically, including a mouse resting on the canvas.

### Review and wrap-up (Stage 9, 2026-10-13)

Status: one read-only review agent over `app/` and `tools/generate-license.mjs` (no file written,
nothing run but reads; the review areas of the plan: IPC and validation, the security baseline and
CSP, the token, the licence gate, contract adherence C1–C3 and D7, RTL / bidi, offline,
robustness). It reported 19 findings — 2 major, 10 minor, 7 nits, no blocker — and 8 places where
this record had drifted from the code. Nothing broke the security baseline, the token handling or
the licence gate beyond D11's documented limits. Each finding was checked in the code before it
was fixed; the majors and the races were reproduced first by a test that failed on the old code.

- **Fixed, each with a test:**
  - Autosave after an engine restart (major; D10 "App side of C3.4"): the engine-ready listener ran
    inside the status dispatch, before the bridge installed the new client, so a save the outage
    held back waited for the next edit. The bridge now installs the connection the slice will keep
    (computed with its reducer) before dispatching (`store/engineBridge.ts`); the test goes through
    the real bridge (the old one set the connection first, the reverse of production).
  - `job_busy` on another recording (major; C2): the frame search followed a running job whatever
    bag it walked, under the bag the operator asked for. It now attaches only to a job on the same
    recording (Windows path rules: separators, repeats, case); another recording's job is named
    with its path and a Cancel for it, never shown as this one's (`busyElsewhere`).
  - A 4-point angle under a new name, or a preview, kept a value while one of its lines changed
    (D9 "rows shown"): every angle row with a value now waits for its lines.
  - Print waited for nothing while the report details had unsaved edits: Print is disabled with
    "Save the report details before printing", and the details are frozen while printing.
  - Overlay checks matched their answers by version only: a slow check of another session could
    mark this one's image as not matching or drop its kept bytes. Answers now carry their session;
    only the check still shown keeps or drops bytes, and only its own (fails closed either way).
  - A screen that threw while rendering showed React Router's English default page with no way
    back (production has no reload): a bilingual error element (`screens/ScreenError.tsx`,
    `appErrors.screen_failed`) replaces the screen inside the shell; the layout's own is the
    last resort.
  - The operator window reloaded a crashed renderer without limit: at most 3 reloads in 5 minutes,
    none after `launch-failed` or `integrity-failure`, then a bilingual dialog ("Try again" / "Quit",
    with the log folder; `main/rendererRecovery.ts`); a second launch also shows a hidden window.
  - `--export` with an `--out` that cannot be written hung (the result file's error escaped and
    `app.exit` was never reached): the run ends with exit 1, `out_write_failed` on stdout, and any
    remaining throw ends the run as 1.
  - The export could throw where it promises a coded answer: an answer cut off after the upload is
    now `network_error` with the HTTP status, a face that cannot be read `print_font_unreadable`
    (new code), an unreadable logo prints without it, and the report screen reads the session
    again after every print attempt, so a PDF the engine sealed shows as sealed even when its
    answer was lost.
  - An answer about an earlier bag could replace the bag opened after it: inspect answers carry
    their path and count only for the bag still open.
  - A key that verified but could not be saved left the Activate screen at once (D11 says the
    screen tells): it now shows that in both languages, with Continue.
  - A print page result main refused (more than 200 problems, details too large) left main waiting
    for the 90 s timeout: it now fails at once as `print_page_failed` with the reason
    (`preflightOrRefusal`).
  - Nits: the operator channels now also require the operator page (`/renderer/index.html`), so
    the hidden print page gets only its own two channels; main sends the token only to the engine's
    origin (`engineCallUrl`, as the renderer's `engineUrl`); a PDF viewer closed while pdf.js loads
    creates no document; the licence generator refuses an impossible `--expires` (`2026-02-30`,
    `24:00`) instead of rolling it over; the capture-folder scan keeps its 3 s while one listing
    hangs; a ready line still buffered when `stop()` began no longer reports "ready" during
    shutdown.
- **Kept as it is: a fresh print partition per print.** The review suggested one reused in-memory
  partition, since Electron keeps every session object for the life of the process. D7 and
  CLAUDE.md ask for a fresh partition per print, Electron cannot release a session, and the storage
  of each is cleared after its print; the growth (one session object per print) is unmeasured.
  Changing it would be a contract deviation for a nit, so it is recorded here instead.
- **This record corrected:** the third permission `loopback-network`; the print face checked
  against `plex-cmap.json`'s hash; the pdf.js worker note; the masked token (the logged command
  line only); "Printing comes in Stage 7"; the header save state only while the engine is ready;
  the scan's time bound; PyInstaller and "packaging not started" (Decision, App implementation
  decisions).
- **Wrap-up:** CLAUDE.md (the `app/` status row, an "App map", the project paragraph, the engine
  rows, a pitfall about runs that drive a visible window); `AGENTS.md` became a pointer to
  CLAUDE.md (operator, 2026-10-13); the batched Arabic wording pass (`docs/arabic-wording-backlog.md`
  "Stage 9 batch pass": 11 corrections applied, four one-word-two-meanings decisions and the style
  suggestions left for the operator).
- **Checks after the fixes:** typecheck, lint and format clean; `npm test` 132 files and 700 tests
  passed (1 file and 1 test skipped); `npm run e2e` 16 passed and 11 skipped (48 s);
  `NAZEER_REAL=1` `e2e/flow-real.spec.ts` 11 of 11 on bag 006 with `best.pt` (1.1 min): the same
  values as in Stage 8, sealed with PASS. The engine is unchanged in Stage 9.
