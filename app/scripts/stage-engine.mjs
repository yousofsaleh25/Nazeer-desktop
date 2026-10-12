#!/usr/bin/env node
// Stage the engine for the Windows installer (D11, Stage B). Builds app\dist-engine\:
//
//   python\                    the official embeddable CPython 3.11.9 (SHA-256 pinned, signed by
//                              the Python Software Foundation) + the Visual C++ runtime next to
//                              python.exe (app-local: the embeddable zip lacks msvcp140*.dll)
//   python\Lib\site-packages\  the runtime packages, copied from the tested venv (RECORD hashes)
//   nazeer_engine\             the engine package (bytecode precompiled, unchecked-hash)
//   models\best.pt             the pinned model (SHA-256 checked)
//   bundle-manifest.json       what went in: versions, sizes, hashes, the checks' results
//
// electron-builder copies it to <resources>\engine (electron-builder.yml), where the app runs
// python\python.exe -I -u -B -m nazeer_engine (src/main/engine/command.ts, imported here so the
// smoke runs the exact production command). Before the bundle is accepted: Authenticode
// signatures, a static DLL-closure check, the longest path, an import sweep of every runtime
// module, `--check`, a serve-mode start → /health → /versions → shutdown, and a check that none
// of it wrote into the bundle (a per-machine install folder is read-only). Work happens in
// dist-engine.tmp\, renamed to dist-engine\ only when everything passed; the smoke's logs stay
// in app\.cache\stage-engine\.
//
//   node scripts/stage-engine.mjs      (npm run stage:engine; part of npm run dist)
//   NAZEER_VC_CRT_DIR=<…\x64\Microsoft.VC143.CRT> overrides the Visual C++ runtime folder.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { buildEngineCommand, describeCommand } from "../src/main/engine/command.ts";
import { classifyImports, readPeImports, VC_RUNTIME } from "./lib/pe-imports.mjs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = path.resolve(APP_DIR, "..");
const ENGINE_DIR = path.join(REPO_DIR, "engine");
const VENV_PYTHON = path.join(ENGINE_DIR, ".venv", "Scripts", "python.exe");
const VENV_SITE = path.join(ENGINE_DIR, ".venv", "Lib", "site-packages");
const REQUIREMENTS = path.join(ENGINE_DIR, "requirements.txt");
const CONSTANTS_PY = path.join(ENGINE_DIR, "nazeer_engine", "constants.py");
const CACHE_DIR = path.join(APP_DIR, ".cache");
const DIST_ENGINE = path.join(APP_DIR, "dist-engine");
const WORK_ROOT = path.join(APP_DIR, "dist-engine.tmp");
const SYSTEM32 = path.join(process.env["SystemRoot"] ?? String.raw`C:\Windows`, "System32");

const PYTHON_VERSION = "3.11.9";
const PYTHON_ZIP = `python-${PYTHON_VERSION}-embed-amd64.zip`;
const PYTHON_ZIP_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/${PYTHON_ZIP}`;
// the file whose MD5 python.org publishes (6d9aa08531d48fcc261ba667e2df17c4, matched 2026-10-12)
const PYTHON_ZIP_SHA256 = "009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b";
const PYTHON_PTH = ["python311.zip", ".", String.raw`Lib\site-packages`, "..", "import site"];
const VC_CRT_DIR =
  process.env["NAZEER_VC_CRT_DIR"] ??
  String.raw`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Redist\MSVC\14.44.35112\x64\Microsoft.VC143.CRT`;
// The default per-user install puts the bundle under
// C:\Users\<name>\AppData\Local\Programs\Nazeer Desktop\resources\engine\ (85 characters with a
// 20-character user name); Windows paths stop at 259, so paths inside the bundle stay under this.
const MAX_BUNDLE_PATH = 170;
const SAC_BLOCK = "Application Control policy";

class StageError extends Error {}

const started = Date.now();
const seconds = (since) => `${((Date.now() - since) / 1000).toFixed(1)} s`;
function step(title) {
  process.stdout.write(`\n== ${title}\n`);
  return Date.now();
}
const info = (line) => process.stdout.write(`   ${line}\n`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  if (result.error) throw new StageError(`${command}: ${result.error.message}`);
  return result;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) files.push(path.join(entry.parentPath, entry.name));
  }
  return files;
}

function snapshot(dir) {
  const map = new Map();
  for (const file of walkFiles(dir)) {
    const stat = statSync(file);
    map.set(path.relative(dir, file), `${stat.size}:${stat.mtimeMs}`);
  }
  return map;
}

/** Authenticode status, signer and file version of each file (PowerShell, one call). */
function signatures(files) {
  if (files.length === 0) return [];
  // Windows PowerShell 5.1: ConvertFrom-Json emits a JSON array as one object (foreach unrolls
  // it) and -LiteralPath takes one path
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$paths = $env:NAZEER_SIG_PATHS | ConvertFrom-Json",
    "$out = foreach ($p in $paths) {",
    "  $s = Get-AuthenticodeSignature -LiteralPath $p",
    "  [pscustomobject]@{ path = $p; status = [string]$s.Status;",
    "    subject = $(if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '' });",
    "    version = (Get-Item -LiteralPath $p).VersionInfo.FileVersion } }",
    "ConvertTo-Json -InputObject @($out) -Compress",
  ].join("\n");
  const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, NAZEER_SIG_PATHS: JSON.stringify(files) },
  });
  if (result.status !== 0) {
    throw new StageError(`Get-AuthenticodeSignature failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function requireSigned(files, signerPattern, what) {
  const bad = signatures(files).filter(
    (s) => s.status !== "Valid" || !signerPattern.test(s.subject ?? ""),
  );
  if (bad.length > 0) {
    throw new StageError(
      `${what}: not validly signed as expected:\n` +
        bad.map((s) => `  ${s.path}: ${s.status} ${s.subject}`).join("\n"),
    );
  }
}

async function pythonZip() {
  const zip = path.join(CACHE_DIR, PYTHON_ZIP);
  if (existsSync(zip) && (await sha256File(zip)) === PYTHON_ZIP_SHA256) {
    info(`${PYTHON_ZIP} from app\\.cache (SHA-256 matches)`);
    return zip;
  }
  info(`downloading ${PYTHON_ZIP_URL}`);
  const response = await fetch(PYTHON_ZIP_URL);
  if (!response.ok) throw new StageError(`download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== PYTHON_ZIP_SHA256) {
    throw new StageError(`${PYTHON_ZIP}: SHA-256 ${digest}, expected ${PYTHON_ZIP_SHA256}`);
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(`${zip}.part`, bytes);
  renameSync(`${zip}.part`, zip);
  return zip;
}

function engineConstant(name) {
  const match = new RegExp(`^${name} = "([^"]+)"`, "m").exec(readFileSync(CONSTANTS_PY, "utf8"));
  if (match === null) throw new StageError(`${name} not found in ${CONSTANTS_PY}`);
  return match[1];
}

/** The engine's modules, for the import sweep: nazeer_engine and every submodule. */
function engineModules(bundle) {
  const root = path.join(bundle, "nazeer_engine");
  return walkFiles(root)
    .filter((file) => file.endsWith(".py"))
    .map((file) => {
      const parts = path.relative(bundle, file).slice(0, -3).split(path.sep);
      if (parts.at(-1) === "__init__") parts.pop();
      return parts.join(".");
    })
    .sort();
}

const SWEEP = `
import importlib, json, sys, time
for name in json.loads(sys.argv[1]):
    t = time.perf_counter()
    try:
        importlib.import_module(name)
        error = None
    except BaseException as exc:
        error = f"{type(exc).__name__}: {exc}"
    ms = round((time.perf_counter() - t) * 1000)
    print("@@sweep " + json.dumps({"module": name, "error": error, "ms": ms}), flush=True)
`;

/** The first JSON event line ({"event": …}) in an engine's stdout text. */
function engineEvent(stdout) {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event.event === "string") return event;
    } catch {
      // not the contract line
    }
  }
  return null;
}

async function serveSmoke(command, stderrLog) {
  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    env: command.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const lines = createInterface({ input: child.stdout });
  let ready;
  try {
    ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new StageError("no ready line within 240 s")), 240_000);
      lines.on("line", (line) => {
        const event = engineEvent(line);
        if (event === null) return;
        clearTimeout(timer);
        if (event.event === "ready") resolve(event);
        else reject(new StageError(`engine fatal: ${JSON.stringify(event)}`));
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new StageError(`engine exited (${code}) before its ready line`));
      });
    });
  } catch (error) {
    if (child.exitCode === null) child.kill(); // never leave an engine holding the work folder
    throw error;
  } finally {
    writeFileSync(stderrLog, Buffer.concat(stderr));
  }
  const base = `http://127.0.0.1:${ready.port}`;
  const token = command.args.find((a) => a.startsWith("--token=")).slice("--token=".length);
  const headers = { "X-Nazeer-Token": token };
  try {
    const health = await fetch(`${base}/health`).then((r) => r.json());
    const versions = await fetch(`${base}/versions`, { headers }).then((r) => r.json());
    const unauthorized = (await fetch(`${base}/versions`)).status;
    const shutdown = (await fetch(`${base}/system/shutdown`, { method: "POST", headers })).status;
    const code = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 30_000)),
    ]);
    return { ready, health, versions, unauthorized, shutdown, code, pid: child.pid };
  } finally {
    if (child.exitCode === null) child.kill();
    writeFileSync(stderrLog, Buffer.concat(stderr));
  }
}

function findLibraryVersions(value) {
  if (value === null || typeof value !== "object") return null;
  if (typeof value.numpy === "string" && typeof value.torch === "string") return value;
  for (const child of Object.values(value)) {
    const found = findLibraryVersions(child);
    if (found !== null) return found;
  }
  return null;
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new StageError("the engine bundle is built on Windows x64");
  }
  for (const required of [VENV_PYTHON, REQUIREMENTS, CONSTANTS_PY, VC_CRT_DIR]) {
    if (!existsSync(required)) throw new StageError(`missing: ${required}`);
  }
  rmSync(WORK_ROOT, { recursive: true, force: true });
  const bundle = path.join(WORK_ROOT, "engine");
  const pythonDir = path.join(bundle, "python");
  const sitePackages = path.join(pythonDir, "Lib", "site-packages");
  const python = path.join(pythonDir, "python.exe");
  // the smoke's logs outlive the work folder: app\.cache\stage-engine\ (gitignored)
  const logs = path.join(CACHE_DIR, "stage-engine");
  rmSync(logs, { recursive: true, force: true });
  mkdirSync(pythonDir, { recursive: true });
  mkdirSync(logs, { recursive: true });
  const manifest = { schema: 1, stagedBy: "app/scripts/stage-engine.mjs" };

  let t = step(`interpreter: embeddable CPython ${PYTHON_VERSION}`);
  const zip = await pythonZip();
  const tar = run(path.join(SYSTEM32, "tar.exe"), ["-xf", zip, "-C", pythonDir]);
  if (tar.status !== 0) throw new StageError(`tar failed: ${tar.stderr}`);
  const zipBinaries = readdirSync(pythonDir)
    .filter((n) => /\.(exe|dll|pyd)$/i.test(n))
    .map((n) => path.join(pythonDir, n));
  const pythonBinaries = zipBinaries.filter((f) => !VC_RUNTIME.test(path.basename(f)));
  requireSigned(pythonBinaries, /Python Software Foundation/, "embeddable zip");
  writeFileSync(path.join(pythonDir, "python311._pth"), `${PYTHON_PTH.join("\r\n")}\r\n`);
  info(`${pythonBinaries.length} binaries signed by the Python Software Foundation; ${seconds(t)}`);
  manifest.python = { version: PYTHON_VERSION, zip: PYTHON_ZIP, sha256: PYTHON_ZIP_SHA256 };

  t = step("Visual C++ runtime (app-local)");
  const crt = readdirSync(VC_CRT_DIR).filter((n) => n.toLowerCase().endsWith(".dll"));
  for (const name of crt) copyFileSync(path.join(VC_CRT_DIR, name), path.join(pythonDir, name));
  const crtSigned = signatures(crt.map((n) => path.join(pythonDir, n)));
  const crtBad = crtSigned.filter((s) => s.status !== "Valid" || !/Microsoft/.test(s.subject));
  if (crtBad.length > 0) throw new StageError(`unsigned VC++ runtime: ${JSON.stringify(crtBad)}`);
  const crtVersions = [...new Set(crtSigned.map((s) => s.version))];
  info(`${crt.length} DLLs, version ${crtVersions.join(", ")}, signed by Microsoft; ${seconds(t)}`);
  manifest.vcRuntime = {
    source: VC_CRT_DIR,
    files: crtSigned.map((s) => ({ name: path.basename(s.path), version: s.version })),
  };

  t = step("runtime packages from the engine venv");
  const bundled = run(VENV_PYTHON, [
    "-I",
    path.join(APP_DIR, "scripts", "engine_bundle.py"),
    "--requirements",
    REQUIREMENTS,
    "--dest",
    sitePackages,
  ]);
  if (bundled.status !== 0) throw new StageError(`engine_bundle.py failed:\n${bundled.stderr}`);
  const packages = JSON.parse(bundled.stdout);
  info(
    `${packages.distributions.length} distributions, ${packages.files} files, ` +
      `${(packages.bytes / 1e6).toFixed(1)} MB (pruned ${(packages.pruned_bytes / 1e6).toFixed(1)} MB: ` +
      `${packages.pruned_prefixes.join(", ")}); test pins left out: ${packages.test_pins_left_out.join(", ")}`,
  );
  for (const [name, why] of Object.entries(packages.requirements_left_out)) {
    info(`left out on purpose: ${name} (${why.required_by.join("; ")}): ${why.reason}`);
  }
  info(seconds(t));
  manifest.packages = packages.distributions.map(({ name, version, files, bytes }) => ({
    name,
    version,
    files,
    bytes,
  }));
  manifest.requirementsLeftOut = packages.requirements_left_out;
  manifest.testPinsLeftOut = packages.test_pins_left_out;
  manifest.pruned = { prefixes: packages.pruned_prefixes, bytes: packages.pruned_bytes };

  t = step("engine package and model");
  cpSync(path.join(ENGINE_DIR, "nazeer_engine"), path.join(bundle, "nazeer_engine"), {
    recursive: true,
    filter: (src) => path.basename(src) !== "__pycache__" && !src.endsWith(".pyc"),
  });
  const modelSha = engineConstant("MODEL_SHA256_PINNED");
  const modelFile = engineConstant("MODEL_FILE_DEFAULT");
  mkdirSync(path.join(bundle, "models"));
  copyFileSync(path.join(ENGINE_DIR, "models", modelFile), path.join(bundle, "models", modelFile));
  const modelDigest = await sha256File(path.join(bundle, "models", modelFile));
  if (modelDigest !== modelSha) {
    throw new StageError(`models\\${modelFile}: SHA-256 ${modelDigest}, pinned ${modelSha}`);
  }
  const engineVersion = engineConstant("ENGINE_VERSION");
  info(`nazeer_engine ${engineVersion}; models\\${modelFile} SHA-256 = pinned; ${seconds(t)}`);
  manifest.engine = { version: engineVersion };
  manifest.model = { file: `models/${modelFile}`, sha256: modelSha };

  t = step("precompile (embedded interpreter, unchecked-hash .pyc)");
  const compiled = run(python, [
    "-I",
    "-m",
    "compileall",
    "-q",
    "-j",
    "0",
    "--invalidation-mode",
    "unchecked-hash",
    sitePackages,
    path.join(bundle, "nazeer_engine"),
  ]);
  // Some packages ship modules for newer Pythons (torch's py312_intrinsics.py) that never import
  // on 3.11; pip's install-time compile skipped them too. A failure is accepted only when the
  // tested venv has no bytecode for that file either; the engine's own modules must all compile.
  const output = `${compiled.stdout}${compiled.stderr}`;
  const uncompiled = [...output.matchAll(/\*\*\* Error compiling '(.+?)'\.\.\./g)].map((m) =>
    m[1].replace(/\\\\/g, "\\"),
  );
  if (compiled.status !== 0 && uncompiled.length === 0) {
    throw new StageError(`compileall failed:\n${output.slice(-4000)}`);
  }
  const unexpected = uncompiled.filter((file) => {
    const rel = path.relative(sitePackages, file);
    if (rel.startsWith("..")) return true;
    const stem = path.basename(rel, ".py");
    return existsSync(
      path.join(VENV_SITE, path.dirname(rel), "__pycache__", `${stem}.cpython-311.pyc`),
    );
  });
  if (unexpected.length > 0) {
    throw new StageError(`compileall failed:\n${output.slice(-4000)}`);
  }
  for (const file of uncompiled) {
    info(`not compiled (as in the venv: never imported on 3.11): ${path.relative(bundle, file)}`);
  }
  info(seconds(t));
  manifest.uncompiled = uncompiled.map((file) => path.relative(bundle, file));

  t = step("DLL closure (static import tables)");
  const files = walkFiles(bundle);
  const bundleNames = new Set(files.map((f) => path.basename(f).toLowerCase()));
  const tables = new Map();
  const foreign = [];
  for (const file of files.filter((f) => /\.(dll|pyd|exe)$/i.test(f))) {
    const table = readPeImports(file);
    if (table.machine !== "x64") foreign.push(`${path.relative(bundle, file)} (${table.machine})`);
    tables.set(path.relative(bundle, file), table);
  }
  const closure = classifyImports(tables, bundleNames, (name) =>
    existsSync(path.join(SYSTEM32, name)),
  );
  if (closure.missing.length > 0) {
    throw new StageError(
      "DLLs neither in the bundle nor part of Windows:\n" +
        closure.missing
          .map(
            (m) =>
              `  ${m.file} → ${m.dll}${m.delay ? " (delay-load)" : ""}${m.vcRuntime ? " (VC++ runtime)" : ""}`,
          )
          .join("\n"),
    );
  }
  const windowsSigned = signatures(closure.windows.map((n) => path.join(SYSTEM32, n)));
  const notWindows = windowsSigned.filter(
    (s) => s.status !== "Valid" || !/O=Microsoft Corporation/.test(s.subject),
  );
  if (notWindows.length > 0) {
    throw new StageError(
      "imported from System32 but not signed by Microsoft (not part of Windows):\n" +
        notWindows.map((s) => `  ${s.path}: ${s.status} ${s.subject}`).join("\n"),
    );
  }
  info(
    `${tables.size} PE files; ${closure.bundled.length} DLL names resolved in the bundle, ` +
      `${closure.windows.length} Windows DLLs (all Microsoft-signed): ${closure.windows.join(" ")}`,
  );
  if (foreign.length > 0)
    info(`not x64 (never loaded by the 64-bit engine): ${foreign.join(", ")}`);
  info(seconds(t));
  manifest.dllClosure = { peFiles: tables.size, windowsDlls: closure.windows, notX64: foreign };

  step("path lengths");
  const longest = files
    .map((f) => path.relative(bundle, f))
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
  for (const rel of longest) info(`${rel.length} characters: engine\\${rel}`);
  if ((longest[0]?.length ?? 0) > MAX_BUNDLE_PATH) {
    throw new StageError(`a bundle path is longer than ${MAX_BUNDLE_PATH} characters`);
  }
  manifest.longestPath = { chars: longest[0]?.length ?? 0, path: longest[0] ?? null };

  const before = snapshot(bundle);
  const dataRoot = mkdtempSync(path.join(tmpdir(), "nazeer-stage-"));
  const command = buildEngineCommand({
    production: true,
    appDir: APP_DIR,
    resourcesPath: WORK_ROOT,
    dataRoot,
    token: randomBytes(32).toString("hex"),
    corsOrigins: ["app://nazeer"],
    env: process.env,
  });
  if (command.command !== python) throw new StageError(`unexpected command ${command.command}`);

  t = step("smoke: import every runtime module (embedded interpreter, -I)");
  const thirdParty = [...new Set(packages.distributions.flatMap((d) => d.top_level))].sort();
  const modules = [...thirdParty, ...engineModules(bundle)];
  // what the engine's apply_offline_env sets up; the folders must exist (ultralytics falls back
  // to the current folder, here the bundle, when its config folder's parent is missing)
  const sweepEnv = {
    ...command.env,
    MPLCONFIGDIR: path.join(dataRoot, "mpl"),
    YOLO_CONFIG_DIR: path.join(dataRoot, "ultralytics"),
    YOLO_OFFLINE: "1",
  };
  mkdirSync(sweepEnv.MPLCONFIGDIR, { recursive: true });
  mkdirSync(sweepEnv.YOLO_CONFIG_DIR, { recursive: true });
  const sweep = run(python, ["-I", "-c", SWEEP, JSON.stringify(modules)], {
    cwd: bundle,
    env: sweepEnv,
    timeout: 600_000,
  });
  const results = sweep.stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith("@@sweep "))
    .map((l) => JSON.parse(l.slice("@@sweep ".length)));
  writeFileSync(path.join(logs, "import-sweep.json"), JSON.stringify(results, null, 1));
  if (results.length !== modules.length) {
    throw new StageError(
      `the import sweep stopped after ${results.length} of ${modules.length} modules ` +
        `(exit ${sweep.status}):\n${sweep.stderr.slice(-3000)}`,
    );
  }
  const blocked = results.filter((r) => r.error?.includes(SAC_BLOCK));
  const failed = results.filter((r) => r.error !== null && !r.error.includes(SAC_BLOCK));
  const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 4);
  info(
    `${results.length} modules (${thirdParty.length} third-party top-level, ` +
      `${modules.length - thirdParty.length} engine): ${results.length - blocked.length - failed.length} ok; ` +
      `slowest ${slowest.map((r) => `${r.module} ${r.ms} ms`).join(", ")}`,
  );
  for (const r of blocked)
    info(`BLOCKED by Smart App Control on this machine: ${r.module}: ${r.error}`);
  if (failed.length > 0) {
    throw new StageError(
      "modules that do not import:\n" + failed.map((r) => `  ${r.module}: ${r.error}`).join("\n"),
    );
  }
  info(seconds(t));

  t = step("smoke: --check (model load + warm-up, Arabic stack)");
  const check = run(command.command, [...command.args, "--check"], {
    cwd: command.cwd,
    env: command.env,
    timeout: 300_000,
  });
  writeFileSync(path.join(logs, "check.stderr.log"), check.stderr ?? "");
  const checkEvent = engineEvent(check.stdout ?? "");
  if (check.status !== 0 || checkEvent?.event !== "ready" || checkEvent.check !== true) {
    throw new StageError(
      `--check failed (exit ${check.status}): ${JSON.stringify(checkEvent)}\n${(check.stderr ?? "").slice(-3000)}`,
    );
  }
  if (checkEvent.model_sha256 !== modelSha || checkEvent.stub_model !== false) {
    throw new StageError(`--check loaded the wrong model: ${JSON.stringify(checkEvent)}`);
  }
  info(
    `ready (check): model ${checkEvent.model_file}, warm-up ${checkEvent.warmup_ms} ms, ` +
      `arabic_stack_ok ${checkEvent.arabic_stack_ok}; ${seconds(t)}`,
  );

  t = step("smoke: serve (the production command) → /health → /versions → shutdown");
  info(describeCommand(command));
  const served = await serveSmoke(command, path.join(logs, "serve.stderr.log"));
  const libraries = findLibraryVersions(served.versions);
  const problems = [];
  if (served.ready.pid !== served.pid) {
    problems.push(`ready-line pid ${served.ready.pid} ≠ spawned pid ${served.pid}`);
  }
  if (served.health?.pid !== served.ready.pid) problems.push("/health answered for another pid");
  if (served.ready.token_required !== true) problems.push("token not required");
  if (served.unauthorized !== 401)
    problems.push(`/versions without the token: ${served.unauthorized}`);
  if (served.shutdown !== 202) problems.push(`shutdown answered ${served.shutdown}`);
  if (served.code !== 0) problems.push(`engine exit ${served.code}`);
  if (libraries === null) problems.push("/versions has no library versions");
  else {
    for (const pkg of packages.distributions) {
      const key = pkg.name.toLowerCase().replace(/-/g, "_");
      if (key in libraries && libraries[key] !== pkg.version) {
        problems.push(`/versions ${key} = ${libraries[key]}, bundle has ${pkg.version}`);
      }
    }
    const missing = Object.entries(libraries).filter(([, v]) => v === "NOT INSTALLED");
    if (missing.length > 0) problems.push(`/versions: not installed: ${missing.map(([k]) => k)}`);
  }
  if (problems.length > 0) throw new StageError(`serve smoke: ${problems.join("; ")}`);
  info(
    `ready on port ${served.ready.port}, pid ${served.pid} (= the spawned process), ` +
      `arabic_stack_ok ${served.ready.arabic_stack_ok}, /versions python ${libraries.python}, ` +
      `torch ${libraries.torch}, exit ${served.code}; ${seconds(t)}`,
  );
  rmSync(dataRoot, { recursive: true, force: true });

  step("nothing written into the bundle by the smoke");
  const after = snapshot(bundle);
  const changed = [...after.keys()].filter((k) => before.get(k) !== after.get(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  if (changed.length + removed.length > 0) {
    throw new StageError(
      `the smoke changed the bundle:\n${[...changed, ...removed].slice(0, 20).join("\n")}`,
    );
  }
  info(`${after.size} files unchanged`);
  manifest.smoke = {
    modules: results.length,
    sacBlocked: blocked.map((r) => r.module),
    warmupMs: checkEvent.warmup_ms,
    arabicStackOk: served.ready.arabic_stack_ok,
  };

  step("dist-engine");
  let bytes = 0;
  for (const file of walkFiles(bundle)) bytes += statSync(file).size;
  manifest.totals = { files: after.size + 1, bytes };
  manifest.stagedAt = new Date().toISOString();
  writeFileSync(
    path.join(bundle, "bundle-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  rmSync(DIST_ENGINE, { recursive: true, force: true });
  renameSync(bundle, DIST_ENGINE);
  rmSync(WORK_ROOT, { recursive: true, force: true });
  info(
    `${DIST_ENGINE}: ${after.size + 1} files, ${(bytes / 1e6).toFixed(1)} MB; total ${seconds(started)}`,
  );
}

main().catch((error) => {
  const message = error instanceof StageError ? error.message : (error?.stack ?? String(error));
  process.stderr.write(`\nstage-engine FAILED: ${message}\n(work folder kept: ${WORK_ROOT})\n`);
  process.exitCode = 1;
});
