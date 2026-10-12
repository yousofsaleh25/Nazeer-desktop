// Screenshots of the running dev app for visual review (a tool, not a test). Starts
// `electron-vite dev` with a remote-debugging port and a throwaway profile, then drives
// routes × themes × languages over CDP with Playwright and writes full-page PNGs to
// ../runs/app_snaps/<label>/ (runs/ is gitignored). Renderer console errors are reported.
//
//   node scripts/snap.mjs [--routes /,/design] [--themes light,dark] [--langs ar,en]
//                         [--bilingual] [--label latest] [--port 9333] [--wait 400]
/* global document, location, window -- used inside page.evaluate callbacks (renderer) */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(appDir, "..");

function parseArgs(argv) {
  const out = {
    routes: ["/", "/design"],
    themes: ["light", "dark"],
    langs: ["ar", "en"],
    bilingual: false,
    label: "latest",
    port: 9333,
    /** ms to let a page settle after fonts load (images, PDF rendering) */
    wait: 400,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bilingual") out.bilingual = true;
    else if (arg === "--routes") out.routes = argv[(i += 1)].split(",");
    else if (arg === "--themes") out.themes = argv[(i += 1)].split(",");
    else if (arg === "--langs") out.langs = argv[(i += 1)].split(",");
    else if (arg === "--label") out.label = argv[(i += 1)];
    else if (arg === "--port") out.port = Number(argv[(i += 1)]);
    else if (arg === "--wait") out.wait = Number(argv[(i += 1)]);
    else throw new Error(`unknown argument ${arg}`);
  }
  return out;
}

async function waitFor(check, what, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const args = parseArgs(process.argv.slice(2));
const outDir = path.join(repoDir, "runs", "app_snaps", args.label);
mkdirSync(outDir, { recursive: true });
const userData = mkdtempSync(path.join(tmpdir(), "nazeer-snap-"));
const cli = path.join(appDir, "node_modules", "electron-vite", "bin", "electron-vite.js");
const dev = spawn(process.execPath, [cli, "dev", "--remoteDebuggingPort", String(args.port)], {
  cwd: appDir,
  env: { ...process.env, NAZEER_USER_DATA_DIR: userData },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
const devLog = [];
dev.stdout.on("data", (chunk) => devLog.push(String(chunk)));
dev.stderr.on("data", (chunk) => devLog.push(String(chunk)));

const errors = [];
const written = [];
try {
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${args.port}/json/version`)).ok,
    "the remote-debugging port",
  );
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.port}`);
  const page = await waitFor(
    async () =>
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().includes("/renderer/index.html")),
    "the renderer page",
  );
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning")
      errors.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`[pageerror] ${error.message}`));
  // the first load after a dependency change makes Vite re-optimise and reload: wait it out
  const mounted = () =>
    page.evaluate(() => (document.getElementById("root")?.childElementCount ?? 0) > 0);
  await waitFor(mounted, "React to mount");
  // operator routes render behind the engine gate: wait until main's supervisor reports the
  // engine ready (or fatal) once; it keeps running across the page reloads below. While a
  // licence is required and not active the engine never starts: the Activate screen is shown.
  const engineStatus = await waitFor(
    () =>
      page.evaluate(async () => {
        const license = await window.nazeer?.license.getStatus();
        if (license && license.required && license.state !== "active") return "licence inactive";
        const event = await window.nazeer?.engine.getStatus();
        return event && ["ready", "fatal"].includes(event.status) ? event.status : null;
      }),
    "the engine (ready or fatal) or the Activate screen",
    200_000,
  );
  console.log(`engine: ${engineStatus}`);
  for (const lang of args.langs) {
    for (const theme of args.themes) {
      for (const route of args.routes) {
        const slug = route === "/" ? "home" : route.replace(/^\//, "").replaceAll("/", "_");
        const name = `${slug}_${theme}_${lang}${args.bilingual ? "_both" : ""}.png`;
        for (let attempt = 1; ; attempt += 1) {
          try {
            await page.evaluate(
              ([prefs, hash]) => {
                localStorage.setItem("nazeer.ui.v1", JSON.stringify(prefs));
                location.hash = hash;
              },
              [{ lang, theme, bilingual: args.bilingual }, `#${route}`],
            );
            await page.reload({ waitUntil: "load" });
            await waitFor(mounted, "React to mount");
            await page.evaluate(() => document.fonts.ready);
            // scroll through once so lazy images load, then capture from the top (an autofocused
            // field would otherwise leave the page scrolled and the sticky header mid-page)
            await page.evaluate(async () => {
              const step = window.innerHeight;
              for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
                window.scrollTo(0, y);
                await new Promise((resolve) => setTimeout(resolve, 150));
              }
              window.scrollTo(0, 0);
            });
            await page.waitForTimeout(args.wait);
            await page.screenshot({ path: path.join(outDir, name), fullPage: true });
            break;
          } catch (error) {
            if (attempt >= 3) throw error; // a reload interrupted the shot: try again
          }
        }
        written.push(name);
      }
    }
  }
  await browser.close();
} catch (error) {
  console.error(error);
  console.error(devLog.join("").slice(-2000));
  process.exitCode = 1;
} finally {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(dev.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // already gone
    }
  } else {
    dev.kill();
  }
  rmSync(userData, { recursive: true, force: true });
}

console.log(`wrote ${written.length} screenshots to ${outDir}`);
for (const name of written) console.log(`  ${name}`);
console.log(
  errors.length
    ? `renderer console:\n  ${errors.join("\n  ")}`
    : "renderer console: no errors or warnings",
);
