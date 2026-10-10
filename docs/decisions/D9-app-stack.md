# D9 — App stack: Electron + Vite + React + TypeScript + Tailwind CSS

Status: accepted 2026-10-10 (operator: Electron + Vite + React + TypeScript; "I want to use
also tailwind css"). The Tailwind scope (UI + print page) and the data-root rule are
assumptions from the review, not operator statements.

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
