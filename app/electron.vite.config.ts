import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const src = resolve(__dirname, "src");
const shared = resolve(src, "shared");

export default defineConfig({
  main: {
    resolve: { alias: { "@shared": shared } },
    // builds made for packaging (`npm run dist` sets NAZEER_DIST=1) are production even when the
    // executable is renamed: licence required, development switches ignored (runtime.ts, D11)
    define: { __NAZEER_DIST__: JSON.stringify(process.env["NAZEER_DIST"] === "1") },
    build: {
      rollupOptions: { input: { index: resolve(src, "main/index.ts") } },
    },
  },
  preload: {
    resolve: { alias: { "@shared": shared } },
    build: {
      // A sandboxed preload can only require electron/events/timers/url, so each preload must be
      // one self-contained file: no externalised dependency, and no runtime module shared by both
      // entries (Rollup would split it into a chunk; type-only imports are fine). electron-vite's
      // `isolatedEntries` would guarantee this but its 5.0.0 reporter crashes when stdout is not
      // a TTY. e2e/smoke.spec.ts fails on any chunk require. D9.
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(src, "preload/index.ts"),
          print: resolve(src, "preload/print.ts"),
        },
      },
    },
  },
  renderer: {
    // root = src/ so both pages live under one root: /renderer/index.html and /print/print.html
    root: src,
    resolve: {
      alias: {
        "@": resolve(src, "renderer"),
        "@shared": shared,
        "@print": resolve(src, "print"),
      },
    },
    plugins: [react(), tailwindcss()],
    // dev only: the /design gallery shows the dev data root's real frame, overlay and PDF
    // (runs/dev_root, gitignored) through /@fs/; the app itself gets assets from the engine
    server: { fs: { allow: [__dirname, resolve(__dirname, "../runs")] } },
    build: {
      rollupOptions: {
        input: {
          index: resolve(src, "renderer/index.html"),
          print: resolve(src, "print/print.html"),
        },
      },
    },
  },
});
