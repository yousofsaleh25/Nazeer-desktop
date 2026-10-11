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
  the app spawns and supervises the engine on 127.0.0.1.
- The renderer never reads a `.bag`; it passes paths to the engine. PDF viewing in-app uses
  bundled pdf.js.

## Consequences

- Document the real `npm run dev / build / test / e2e / export` commands in `CLAUDE.md` in
  the same commit that adds `package.json`.
- `engine/wheels/` (offline wheelhouse of the pinned Python wheels, ≈ 2.5 MB for the
  Arabic/PDF deps) — whether to track it in git is open.
- One Playwright-Electron e2e covers the export flow; everything else stays in pytest/vitest.

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
  against `/health.arabic_stack.font_sha256` (the face the overlay was drawn with) and hands the
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
  Every payload is validated in main and accepted only from the app's own frame.
- **Security baseline:** every window sandboxed with context isolation and no Node integration;
  the packaged renderer is served from `app://nazeer`, registered privileged (`standard`, `secure`,
  `supportFetchAPI`, `codeCache`) so it is a secure context (`crypto.subtle`) with a real origin for
  the engine's CORS list; CSP is sent as a response header (by the `app://` handler; in dev by a
  `webRequest` hook limited to the Vite server) and the print page gets its own policy without
  `connect-src`; permissions are denied except `local-network-access` (Chromium 152's Local Network
  Access for app:// → 127.0.0.1) and `clipboard-sanitized-write`, for the app origins only;
  navigation, `window.open` and webviews are blocked; the production menu has no reload or
  DevTools. The engine token is 32 random bytes per spawn; it is visible on the engine's command
  line to processes of the same Windows user, which sit inside the trust boundary anyway.
- **Packaging** (later stage, not started): renderer libraries are bundled by Vite, so
  `node_modules` stays out of the asar.

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
- Production bundle notes for packaging: the pdf.js worker (1.27 MB) is already emitted as an
  asset although nothing mounts the viewer yet (Vite emits `?url` assets while scanning the module
  graph); the renderer output is not minified with the current electron-vite configuration.
