#!/usr/bin/env node
// The D11 clean-PC checklist in Windows Sandbox, repeatable (operator, 2026-10-12): a clean,
// disposable copy of this laptop's Windows, without the development tools, the Visual C++ runtime
// or anything installed here, receives the installer the way a customer does.
//
//   1. preconditions: the Windows Sandbox feature is on, no sandbox is running, the installer exists
//   2. keys for the check, issued here with the vendor key (a 3-day trial, an expired key, a
//      tampered key) into each run's folder; the private key never enters the sandbox
//   3. per run, a .wsb configuration: the run's io folder (read-write), the installer's folder,
//      this Node, playwright-core, scripts\sandbox\ and the bag's folder (read-only), memory 8 GB,
//      clipboard and printers off; the logon command runs scripts\sandbox\sandbox-run.ps1
//        full     network on: Mark of the Web + SmartScreen, the language dialog, the Arabic
//                 pages, a per-user install, icons; the app (Activate, keys, About, the bag,
//                 print and seal, close, relaunch); the GUI uninstall; an all-users install; a
//                 standard Windows user with an Arabic name on it
//        offline  network off: a silent per-user install, the app (with the bag and the print),
//                 a silent uninstall
//   4. start WindowsSandbox.exe with it, wait for io\done.json, wait for the sandbox to close
//   5. summarise every check by D11 item, overall and per run: summary.md and summary.json in the
//      run folder
//
// Keep the Sandbox window open and visible while it runs (its screenshots are of that screen).
//
//   node scripts/sandbox-check.mjs [--installer <exe>] [--bag <bag> | --no-bag]
//                                  [--modes full,offline] [--timeout-min 75] [--dry-run]
//   node scripts/sandbox-check.mjs --summarize <run folder>
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = path.resolve(APP_DIR, "..");
const GENERATOR = path.join(REPO_DIR, "tools", "generate-license.mjs");
const PRODUCT = "Nazeer Desktop";
const VERSION = JSON.parse(readFileSync(path.join(APP_DIR, "package.json"), "utf8")).version;
const SANDBOX_EXE = path.join(
  process.env["SystemRoot"] ?? "C:\\Windows",
  "System32",
  "WindowsSandbox.exe",
);

/** The D11 checklist items, in its words (docs/decisions/D11-licensing-and-installer.md). */
export const ITEMS = {
  1: "Copy the installer: SmartScreen, the language dialog (Arabic), the pages, the icons",
  2: "Install with the defaults (only for me); how long it takes",
  3: "First start: the Activate screen in Arabic and English",
  4: "Tampered and expired keys refused with their reasons; the trial key opens the app",
  5: "About: the licence (trial, end date), the engine (best.pt), the Arabic stack",
  6: "Closing the window ends the app and the engine",
  7: "Second start: no Activate screen",
  8: "Uninstall: the program goes, the profile (licence, sessions, logs) stays",
  9: "Anyone who uses this computer: installs under Program Files; the engine starts",
  10: "An Arabic user name, no VC++ runtime, Windows N, no network",
  11: "Screenshots and logs",
  bag: "Beyond the checklist: a bag, the frame search, print and seal on a clean Windows",
};

function parseArgs(argv) {
  const out = {
    installer: path.join(APP_DIR, "release", `${PRODUCT} Setup ${VERSION}.exe`),
    bag: path.join(REPO_DIR, "data", ".bag", "20260414_180708-004.bag"),
    modes: ["full", "offline"],
    timeoutMin: 75,
    dryRun: false,
    summarize: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === "--installer") out.installer = path.resolve(value());
    else if (arg === "--bag") out.bag = path.resolve(value());
    else if (arg === "--no-bag") out.bag = null;
    else if (arg === "--modes")
      out.modes = value()
        .split(",")
        .map((m) => m.trim());
    else if (arg === "--timeout-min") out.timeoutMin = Number(value());
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--summarize") out.summarize = path.resolve(value());
    else throw new Error(`unknown argument ${arg}`);
  }
  for (const mode of out.modes) {
    if (mode !== "full" && mode !== "offline") throw new Error(`unknown mode ${mode}`);
  }
  return out;
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
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: result.stderr ?? "" };
}

function sandboxFeatureState() {
  const r = powershell(
    "(Get-CimInstance Win32_OptionalFeature -Filter \"Name='Containers-DisposableClientVM'\").InstallState",
  );
  return r.ok ? Number(r.out) : null;
}

function sandboxRunning() {
  const r = powershell(
    "@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'WindowsSandbox*' }).Count",
  );
  return r.ok && Number(r.out) > 0;
}

function generate(...args) {
  const result = spawnSync(process.execPath, [GENERATOR, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`generate-license ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function issueKeys() {
  const trial = generate("--days", "3");
  const expired = generate("--expires", new Date(Date.now() - 86_400_000).toISOString());
  const other = generate("--days", "3");
  const middle = Math.floor(other.length / 2);
  const tampered =
    other.slice(0, middle) + (other[middle] === "A" ? "B" : "A") + other.slice(middle + 1);
  return { trial, expired, tampered };
}

const xml = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The Windows Sandbox configuration of one run. */
export function wsbConfig({ mode, io, installer, node, playwright, scripts, bag }) {
  const map = (host, inside, readOnly) =>
    `    <MappedFolder><HostFolder>${xml(host)}</HostFolder><SandboxFolder>${xml(inside)}</SandboxFolder><ReadOnly>${readOnly}</ReadOnly></MappedFolder>`;
  const folders = [
    map(io, "C:\\nz\\io", false),
    map(path.dirname(installer), "C:\\nz\\installer", true),
    map(node, "C:\\nz\\node", true),
    map(playwright, "C:\\nz\\pw", true),
    map(scripts, "C:\\nz\\scripts", true),
  ];
  if (bag !== null) folders.push(map(path.dirname(bag), "C:\\nz\\bags", true));
  const command =
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\nz\\scripts\\sandbox-run.ps1" +
    ` -Mode ${mode} -InstallerName "${path.basename(installer)}"` +
    (bag === null ? "" : ` -BagName "${path.basename(bag)}"`);
  return [
    "<Configuration>",
    // software rendering inside: with the host's GPU shared, the sandbox's dwm.exe kept crashing in
    // udwm.dll on this laptop (Intel + NVIDIA, external monitors) and no logon completed (2026-10-13);
    // a customer's PC is not assumed to share a GPU either
    "  <VGpu>Disable</VGpu>",
    `  <Networking>${mode === "offline" ? "Disable" : "Enable"}</Networking>`,
    "  <MemoryInMB>8192</MemoryInMB>",
    "  <ClipboardRedirection>Disable</ClipboardRedirection>",
    "  <PrinterRedirection>Disable</PrinterRedirection>",
    "  <AudioInput>Disable</AudioInput>",
    "  <VideoInput>Disable</VideoInput>",
    "  <MappedFolders>",
    ...folders,
    "  </MappedFolders>",
    "  <LogonCommand>",
    `    <Command>${xml(command)}</Command>`,
    "  </LogonCommand>",
    "</Configuration>",
    "",
  ].join("\n");
}

function readJson(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

/** A list from a JSON value: Windows PowerShell 5.1 can write a one-entry list as a bare object. */
export function asList(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

/** Every check of one run, with the D11 item it belongs to. */
function runChecks(io, mode) {
  const checks = [];
  for (const entry of asList(readJson(path.join(io, "results.json")))) {
    checks.push({ mode, source: "sandbox", ...entry });
  }
  for (const name of existsSync(io) ? readdirSync(io) : []) {
    const match = /^app-(.+)\.json$/.exec(name);
    if (match === null) continue;
    const app = readJson(path.join(io, name));
    for (const entry of asList(app?.results)) checks.push({ mode, source: match[1], ...entry });
  }
  const shots = existsSync(path.join(io, "shots")) ? readdirSync(path.join(io, "shots")).length : 0;
  const logs = existsSync(path.join(io, "logs")) ? readdirSync(path.join(io, "logs")).length : 0;
  checks.push({
    mode,
    source: "host",
    item: "11",
    name: "screenshots and logs collected",
    ok: shots > 0 && logs > 0,
    detail: `${shots} screenshots, ${logs} log folders in ${io}`,
  });
  return checks;
}

/** One verdict per D11 item: fail when any check failed, pass when every check passed. */
export function verdicts(checks) {
  const out = {};
  for (const key of Object.keys(ITEMS)) {
    const mine = checks.filter((c) => String(c.item) === key);
    const judged = mine.filter((c) => c.ok === true || c.ok === false);
    let status = "not run";
    if (judged.some((c) => c.ok === false)) status = "FAIL";
    else if (judged.length > 0) status = "pass";
    else if (mine.length > 0) status = "noted";
    out[key] = { status, checks: mine };
  }
  const extra = checks.filter((c) => !(String(c.item) in ITEMS));
  if (extra.length > 0) {
    out["run"] = { status: extra.some((c) => c.ok === false) ? "FAIL" : "pass", checks: extra };
  }
  return out;
}

/**
 * The summary: each run's facts, then one row per D11 item with its verdict overall and in each run
 * (an item that passed offline but failed with the network on is FAIL overall, and shows where).
 */
export function summaryMarkdown(name, modes, facts, checks) {
  const byItem = verdicts(checks);
  const byMode = Object.fromEntries(
    modes.map((mode) => [mode, verdicts(checks.filter((c) => c.mode === mode))]),
  );
  const lines = [`# Clean-PC check in Windows Sandbox (${name})`, ""];
  for (const mode of modes) {
    const f = facts[mode];
    lines.push(
      f === null || f === undefined
        ? `- **${mode}**: no facts recorded (the run did not start or did not finish)`
        : `- **${mode}**: ${f.os} ${f.displayVersion ?? ""} (build ${f.build}, ${f.edition}), user ${f.user}, ` +
            `network ping ${f.network?.ping}, Smart App Control ${f.smartAppControl ?? "n/a"}, ` +
            `SmartScreen ${JSON.stringify(f.smartScreen ?? null)}, ` +
            `VC++ in System32 ${JSON.stringify(f.vcRuntimeInSystem32)}`,
    );
  }
  lines.push(
    "",
    `| # | D11 item | Result | ${modes.join(" | ")} | Details |`,
    `|---|---|---|${modes.map(() => "---|").join("")}---|`,
  );
  for (const [key, verdict] of Object.entries(byItem)) {
    const details = verdict.checks
      .map(
        (c) =>
          `${c.ok === true ? "✓" : c.ok === false ? "✗" : "·"} [${c.mode}/${c.source}] ${c.name}${c.detail ? `: ${c.detail}` : ""}`,
      )
      .join("<br>")
      .replace(/\|/g, "\\|");
    const perMode = modes.map((mode) => byMode[mode]?.[key]?.status ?? "not run");
    lines.push(
      `| ${key} | ${ITEMS[key] ?? "other checks"} | ${verdict.status} | ${perMode.join(" | ")} | ${details} |`,
    );
  }
  return { markdown: `${lines.join("\n")}\n`, byItem };
}

function summarize(runDir, modes) {
  const checks = [];
  const facts = {};
  for (const mode of modes) {
    const io = path.join(runDir, mode, "io");
    facts[mode] = readJson(path.join(io, "facts.json"));
    checks.push(...runChecks(io, mode));
  }
  const { markdown: md, byItem } = summaryMarkdown(path.basename(runDir), modes, facts, checks);
  writeFileSync(path.join(runDir, "summary.md"), md, "utf8");
  writeFileSync(
    path.join(runDir, "summary.json"),
    JSON.stringify({ facts, items: byItem }, null, 2),
    "utf8",
  );
  process.stdout.write(md);
  return Object.values(byItem).every((v) => v.status !== "FAIL");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runOne(runDir, mode, args, keys) {
  const base = path.join(runDir, mode);
  const io = path.join(base, "io");
  mkdirSync(io, { recursive: true });
  writeFileSync(path.join(io, "keys.json"), JSON.stringify(keys, null, 2), "utf8");
  const require = createRequire(path.join(APP_DIR, "package.json"));
  const config = wsbConfig({
    mode,
    io,
    installer: args.installer,
    node: path.dirname(process.execPath),
    playwright: path.dirname(require.resolve("playwright-core/package.json")),
    scripts: path.join(APP_DIR, "scripts", "sandbox"),
    bag: args.bag,
  });
  const wsb = path.join(base, `nazeer-${mode}.wsb`);
  writeFileSync(wsb, config, "utf8");
  process.stdout.write(`${mode}: ${wsb}\n`);
  if (args.dryRun) return;

  const started = Date.now();
  spawn(SANDBOX_EXE, [wsb], { detached: true, stdio: "ignore" }).unref();
  const deadline = started + args.timeoutMin * 60_000;
  while (!existsSync(path.join(io, "done.json"))) {
    if (Date.now() > deadline) {
      process.stdout.write(`${mode}: no done.json after ${args.timeoutMin} min\n`);
      break;
    }
    await sleep(10_000);
  }
  // the run shuts its Windows down: wait for the sandbox to close (or close it)
  const closeBy = Date.now() + 180_000;
  while (sandboxRunning() && Date.now() < closeBy) await sleep(5_000);
  if (sandboxRunning()) {
    powershell(
      "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'WindowsSandbox*' } | Stop-Process -Force",
    );
    await sleep(10_000);
  }
  process.stdout.write(`${mode}: ${((Date.now() - started) / 60_000).toFixed(1)} min\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.summarize !== null) {
    const modes = ["full", "offline"].filter((m) => existsSync(path.join(args.summarize, m)));
    process.exitCode = summarize(args.summarize, modes) ? 0 : 1;
    return;
  }
  if (!existsSync(args.installer))
    throw new Error(`no installer at ${args.installer} (npm run dist)`);
  if (args.bag !== null && !existsSync(args.bag))
    throw new Error(`no bag at ${args.bag} (or --no-bag)`);
  if (!args.dryRun) {
    if (!existsSync(SANDBOX_EXE))
      throw new Error(`Windows Sandbox is not installed (${SANDBOX_EXE})`);
    const state = sandboxFeatureState();
    if (state !== 1) {
      throw new Error(
        `the Windows Sandbox feature is not on (InstallState ${state}); it needs administrator ` +
          "rights and a restart: Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All",
      );
    }
    if (sandboxRunning()) throw new Error("a Windows Sandbox is already running: close it first");
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "Z");
  const runDir = path.join(REPO_DIR, "runs", `sandbox_check_${stamp}`);
  mkdirSync(runDir, { recursive: true });
  const keys = issueKeys();
  process.stdout.write(`run folder ${runDir}\ninstaller ${args.installer}\n`);
  for (const mode of args.modes) await runOne(runDir, mode, args, keys);
  if (args.dryRun) return;
  process.exitCode = summarize(runDir, args.modes) ? 0 : 1;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
