#!/usr/bin/env node
// Install-and-run check of the Windows installer (D11, Stage B), for a machine where Smart App
// Control lets the unsigned installer and app run:
//
//   1. the installer exists; no installed copy (HKCU uninstall entry); %APPDATA%\Nazeer Desktop
//      absent, or moved aside with --move-profile-aside (restored at the end)
//   2. silent per-user install into a temporary folder (/S /currentuser /D=<dir>)
//   3. first launch, with development switches set that production must ignore (NAZEER_STUB_MODEL,
//      NAZEER_DATA_ROOT, NAZEER_USER_DATA_DIR, ELECTRON_RENDERER_URL) and ELECTRON_RUN_AS_NODE=1
//      (the RunAsNode fuse is off, so the app starts normally): the Activate screen, no engine;
//      malformed, tampered and expired keys show their reasons in Arabic and English; a fresh
//      --days 1 key starts the engine with the real model on the profile's data root; About
//   4. closing the window (the quit handshake) stops the app and the engine
//   5. relaunch: no Activate screen (the stored key verifies again)
//   6. a copy of the executable renamed electron.exe still requires the licence (the dist flag)
//   7. silent uninstall: the uninstall entry and the program files are gone
//
// Keys are issued with the vendor key (tools/generate-license.mjs, %USERPROFILE%\.nazeer-license);
// on a machine without it pass --trial-key and --expired-key. Screenshots go to
// runs\app_snaps\<label>\. Exit 0 only when every check passed.
//
//   node scripts/packaged-smoke.mjs [--installer <exe>] [--move-profile-aside] [--keep-install]
//                                   [--trial-key <key> --expired-key <key>] [--label stageB_packaged]
/* global document, location, window -- used inside page.evaluate callbacks (renderer) */
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = path.resolve(APP_DIR, "..");
const GENERATOR = path.join(REPO_DIR, "tools", "generate-license.mjs");
const PRODUCT = "Nazeer Desktop";
const VERSION = JSON.parse(readFileSync(path.join(APP_DIR, "package.json"), "utf8")).version;
const PROFILE = path.join(process.env["APPDATA"] ?? "", PRODUCT);
const MODEL_SHA256 = /^MODEL_SHA256_PINNED = "([0-9a-f]{64})"/m.exec(
  readFileSync(path.join(REPO_DIR, "engine", "nazeer_engine", "constants.py"), "utf8"),
)?.[1];

function parseArgs(argv) {
  const out = {
    installer: path.join(APP_DIR, "release", `${PRODUCT} Setup ${VERSION}.exe`),
    moveProfileAside: false,
    keepInstall: false,
    trialKey: null,
    expiredKey: null,
    label: "stageB_packaged",
    port: 9334,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === "--installer") out.installer = path.resolve(value());
    else if (arg === "--move-profile-aside") out.moveProfileAside = true;
    else if (arg === "--keep-install") out.keepInstall = true;
    else if (arg === "--trial-key") out.trialKey = value();
    else if (arg === "--expired-key") out.expiredKey = value();
    else if (arg === "--label") out.label = value();
    else if (arg === "--port") out.port = Number(value());
    else throw new Error(`unknown argument ${arg}`);
  }
  return out;
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}\n`);
  return ok;
}
const note = (line) => process.stdout.write(`      ${line}\n`);

async function waitFor(probe, what, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function powershell(script) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.status !== 0) throw new Error(`powershell failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** The HKCU uninstall entry of an installed Nazeer Desktop, or null. */
function uninstallEntry() {
  const out = powershell(
    [
      "$e = Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' |",
      "  ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |",
      `  Where-Object { $_.DisplayName -like '${PRODUCT}*' } | Select-Object -First 1`,
      "if ($e) { $e | Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation,",
      "  UninstallString, PSChildName | ConvertTo-Json -Compress } else { 'null' }",
    ].join("\n"),
  );
  return JSON.parse(out);
}

function generate(...args) {
  const result = spawnSync(process.execPath, [GENERATOR, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`generate-license ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function folderBytes(dir) {
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) bytes += statSync(path.join(entry.parentPath, entry.name)).size;
  }
  return bytes;
}

async function launch(exe, port, env) {
  const child = spawn(exe, [`--remote-debugging-port=${port}`], { env, stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  child.on("error", () => {});
  try {
    await waitFor(
      async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok,
      "the app's remote-debugging port",
      90_000,
    );
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = await waitFor(
      async () =>
        browser
          .contexts()
          .flatMap((c) => c.pages())
          .find((p) => p.url().includes("/renderer/index.html")),
      "the renderer page",
      60_000,
    );
    await waitFor(
      () => page.evaluate(() => (document.getElementById("root")?.childElementCount ?? 0) > 0),
      "React to mount",
      60_000,
    );
    return { child, exited, browser, page };
  } catch (error) {
    // an app that never came up must not keep the install folder locked for the uninstall
    child.kill();
    throw error;
  }
}

async function close(app) {
  await app.page.evaluate(() => window.close()).catch(() => {});
  const code = await Promise.race([
    app.exited,
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 45_000)),
  ]);
  await app.browser.close().catch(() => {});
  if (code === "timeout") app.child.kill();
  return code;
}

async function engineReady(page, timeoutMs = 240_000) {
  return waitFor(
    () =>
      page.evaluate(async () => {
        const event = await window.nazeer.engine.getStatus();
        if (event.status === "fatal") return { fatal: event };
        return event.status === "ready" ? event : null;
      }),
    "the engine (ready or fatal)",
    timeoutMs,
  );
}

async function tryKey(page, key) {
  await page.getByRole("textbox").fill(key);
  await page.getByRole("button", { name: /Activate/ }).click();
}

async function alertHas(page, english, arabic) {
  const alert = page.getByRole("alert");
  await waitFor(
    async () => {
      const text = await alert.innerText({ timeout: 1000 });
      return text.includes(english) && text.includes(arabic);
    },
    `the reason "${english}"`,
    10_000,
  );
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shots = path.join(REPO_DIR, "runs", "app_snaps", args.label);
  mkdirSync(shots, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), "nazeer-smoke-"));
  const installDir = path.join(work, "app");
  const decoyData = path.join(work, "decoy-data-root");
  const decoyProfile = path.join(work, "decoy-profile");
  mkdirSync(decoyData);
  mkdirSync(decoyProfile);
  let movedProfile = null;
  // true only once PROFILE is the smoke's own (absent at the start, or the original moved aside):
  // the clean-up never deletes a profile it did not create
  let ownsProfile = false;
  let installed = false;
  const env = {
    ...process.env,
    NAZEER_STUB_MODEL: "1",
    NAZEER_ENGINE_NO_WARMUP: "1",
    NAZEER_DATA_ROOT: decoyData,
    NAZEER_USER_DATA_DIR: decoyProfile,
    NAZEER_LICENSE_ENFORCE: "0",
    ELECTRON_RENDERER_URL: "http://127.0.0.1:9/",
    ELECTRON_RUN_AS_NODE: "1",
  };

  try {
    // 1. preconditions
    if (!check("installer present", existsSync(args.installer), args.installer)) return;
    note(`${(statSync(args.installer).size / 1e6).toFixed(1)} MB`);
    if (!check("no installed copy", uninstallEntry() === null, "HKCU uninstall entry")) return;
    if (existsSync(PROFILE)) {
      if (!args.moveProfileAside) {
        check("profile folder absent", false, `${PROFILE} exists: pass --move-profile-aside`);
        return;
      }
      movedProfile = `${PROFILE}.smoke-backup-${new Date().toISOString().replace(/[-:.]/g, "")}`;
      renameSync(PROFILE, movedProfile);
      note(`moved ${PROFILE} aside to ${movedProfile}`);
    }
    ownsProfile = true;
    const trial = args.trialKey ?? generate("--days", "1");
    const expired =
      args.expiredKey ?? generate("--expires", new Date(Date.now() - 86_400_000).toISOString());
    const other = args.trialKey ?? generate("--days", "1");
    const middle = Math.floor(other.length / 2);
    const tampered =
      other.slice(0, middle) + (other[middle] === "A" ? "B" : "A") + other.slice(middle + 1);

    // 2. install
    let t = Date.now();
    const setup = spawnSync(args.installer, ["/S", "/currentuser", `/D=${installDir}`], {
      windowsHide: true,
      timeout: 900_000,
    });
    installed = true;
    const exe = path.join(installDir, `${PRODUCT}.exe`);
    check(
      "silent per-user install",
      setup.status === 0 && existsSync(exe),
      `exit ${setup.status ?? setup.error?.message}, ${((Date.now() - t) / 1000).toFixed(0)} s`,
    );
    if (!existsSync(exe)) return;
    note(`installed ${(folderBytes(installDir) / 1e6).toFixed(0)} MB in ${installDir}`);
    const entry = uninstallEntry();
    check(
      "uninstall entry registered",
      entry?.DisplayVersion === VERSION,
      entry ? `${entry.DisplayName} ${entry.DisplayVersion}` : "missing",
    );
    for (const rel of [
      path.join("resources", "app.asar"),
      path.join("resources", "engine", "python", "python.exe"),
      path.join("resources", "engine", "models", "best.pt"),
    ]) {
      check(`installed ${rel}`, existsSync(path.join(installDir, rel)));
    }
    check(
      "no default_app.asar",
      !existsSync(path.join(installDir, "resources", "default_app.asar")),
    );

    // 3. first launch: the Activate screen, then the three reasons, then a good key
    t = Date.now();
    let app = await launch(exe, args.port, env);
    note(`window up in ${((Date.now() - t) / 1000).toFixed(1)} s (ELECTRON_RUN_AS_NODE=1 ignored)`);
    const { page } = app;
    const heading = await waitFor(
      async () => {
        const text = await page.getByRole("heading", { level: 1 }).innerText({ timeout: 1000 });
        return text.includes("Activate Nazeer") ? text : null;
      },
      "the Activate screen",
      30_000,
    ).catch(() => "(no Activate screen within 30 s)");
    check(
      "Activate screen first, in Arabic and English",
      heading.includes("Activate Nazeer") && heading.includes("تفعيل نظير"),
      heading.replace(/\s+/g, " "),
    );
    const license = await page.evaluate(() => window.nazeer.license.getStatus());
    check(
      "licence required (production ignores NAZEER_LICENSE_ENFORCE=0)",
      license.required === true && license.state === "inactive",
      JSON.stringify({ required: license.required, state: license.state }),
    );
    const before = await page.evaluate(() => window.nazeer.engine.getStatus());
    check("no engine before activation", before.connection === null, before.status);
    await page.screenshot({ path: path.join(shots, "activate.png") });

    await tryKey(page, "hello");
    check(
      "malformed key: reason shown",
      await alertHas(page, "This is not a valid licence key", "هذا ليس مفتاح ترخيص صالحًا"),
    );
    await tryKey(page, tampered);
    check(
      "tampered key: reason shown",
      await alertHas(page, "was not issued for Nazeer", "لم يُصدر هذا المفتاح لنظير"),
    );
    await tryKey(page, expired);
    check(
      "expired key: reason shown",
      await alertHas(page, "This licence key has expired", "انتهت صلاحية مفتاح الترخيص هذا"),
    );
    await page.screenshot({ path: path.join(shots, "activate_expired.png") });

    t = Date.now();
    await tryKey(page, trial);
    const ready = await engineReady(page);
    if (ready.fatal) {
      check("engine ready after activation", false, JSON.stringify(ready.fatal));
      await close(app);
      return;
    }
    const connection = ready.connection;
    check(
      "engine ready after activation (real model)",
      connection.stubModel === false && connection.modelSha256 === MODEL_SHA256,
      `${((Date.now() - t) / 1000).toFixed(1)} s, model ${connection.modelFile}, warm-up ` +
        `${connection.warmupMs} ms, Arabic stack ${connection.arabicStackOk ? "ok" : "MISSING"}`,
    );
    check(
      "data root = the profile (NAZEER_DATA_ROOT and NAZEER_USER_DATA_DIR ignored)",
      connection.dataRoot.toLowerCase() === PROFILE.toLowerCase(),
      connection.dataRoot,
    );
    check(
      "licence marker written",
      existsSync(path.join(PROFILE, "app-license.json")),
      path.join(PROFILE, "app-license.json"),
    );
    await page.screenshot({ path: path.join(shots, "home.png") });
    await page.evaluate(() => {
      location.hash = "#/about";
    });
    await waitFor(
      async () =>
        (await page.getByText("Licence").count()) + (await page.getByText("الترخيص").count()),
      "About",
      20_000,
    );
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(shots, "about.png"), fullPage: true });

    // 4. quit through the window
    const enginePid = connection.pid;
    const code = await close(app);
    const engineGone = await waitFor(
      async () => !isPidAlive(enginePid),
      "the engine to stop",
      30_000,
    )
      .then(() => true)
      .catch(() => false);
    const log = readFileSync(path.join(PROFILE, "logs", "app-engine-stderr.log"), "utf8");
    check(
      "closing the window stops the app and the engine",
      code === 0 && engineGone && /\bstopped\b/.test(log),
      `app exit ${code}, engine pid ${enginePid} ${engineGone ? "gone" : "STILL RUNNING"}`,
    );

    // 5. relaunch: the stored key verifies again
    app = await launch(exe, args.port, env);
    const again = await app.page.evaluate(() => window.nazeer.license.getStatus());
    const readyAgain = await engineReady(app.page);
    check(
      "relaunch: no Activate screen, engine ready",
      again.state === "active" && !readyAgain.fatal,
      `licence ${again.state}, ${again.license?.kind} until ${again.license?.expires}`,
    );
    check("relaunch closes cleanly", (await close(app)) === 0);

    // 6. renamed executable: still production
    const renamed = path.join(installDir, "electron.exe");
    copyFileSync(exe, renamed);
    app = await launch(renamed, args.port, env);
    const renamedStatus = await app.page.evaluate(() => window.nazeer.license.getStatus());
    const renamedReady = await engineReady(app.page);
    check(
      "renamed to electron.exe: licence still required",
      renamedStatus.required === true,
      JSON.stringify({ required: renamedStatus.required, state: renamedStatus.state }),
    );
    const renamedEngine = renamedReady.connection?.pid;
    const renamedCode = await close(app);
    const renamedGone = await waitFor(
      async () => renamedEngine === undefined || !isPidAlive(renamedEngine),
      "the engine to stop",
      30_000,
    )
      .then(() => true)
      .catch(() => false);
    check(
      "renamed copy closes with its engine",
      renamedCode === 0 && renamedGone,
      `exit ${renamedCode}`,
    );
    rmSync(renamed, { force: true, maxRetries: 10, retryDelay: 500 });

    check(
      "decoy development folders untouched",
      readdirSync(decoyData).length === 0 && readdirSync(decoyProfile).length === 0,
    );
  } finally {
    // 7. uninstall and restore
    if (installed && !args.keepInstall && existsSync(installDir)) {
      const uninstaller = path.join(installDir, `Uninstall ${PRODUCT}.exe`);
      const removed = spawnSync(uninstaller, ["/S", `_?=${installDir}`], {
        windowsHide: true,
        timeout: 600_000,
      });
      const entry = uninstallEntry();
      check(
        "silent uninstall",
        removed.status === 0 &&
          entry === null &&
          !existsSync(path.join(installDir, `${PRODUCT}.exe`)),
        `exit ${removed.status}, uninstall entry ${entry === null ? "removed" : "STILL PRESENT"}`,
      );
    }
    if (!args.keepInstall) rmSync(work, { recursive: true, force: true });
    // the smoke's own profile goes (kept with --keep-install unless an original must come back)
    if (ownsProfile && (movedProfile !== null || !args.keepInstall)) {
      rmSync(PROFILE, { recursive: true, force: true });
    }
    if (movedProfile !== null) {
      renameSync(movedProfile, PROFILE);
      note(`restored ${PROFILE}`);
    }
  }
}

main()
  .catch((error) => check("smoke ran to the end", false, error?.stack ?? String(error)))
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    process.stdout.write(
      `\n${results.length - failed.length}/${results.length} checks passed` +
        `${failed.length ? `; failed: ${failed.map((r) => r.name).join("; ")}` : ""}\n`,
    );
    process.exitCode = failed.length === 0 && results.length > 0 ? 0 : 1;
  });
