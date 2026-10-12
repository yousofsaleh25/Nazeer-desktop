#!/usr/bin/env node
// The session store against a real engine (Stage 5): copies the dev data root's session into a
// throwaway data root, starts the engine there (stub model: no model load, the session's frame is
// already on disk), runs src/renderer/store/realEngine.test.ts against it, and stops the engine.
//
//   node scripts/store-real.mjs        (npm run test:store-real; needs ..\runs\dev_root)
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = path.resolve(APP_DIR, "..");
const SESSION_ID = "20261011_152956_e20a7c";
const SOURCE = path.join(REPO_DIR, "runs", "dev_root", "sessions", SESSION_ID);
const PYTHON = path.join(REPO_DIR, "engine", ".venv", "Scripts", "python.exe");

if (!existsSync(SOURCE)) {
  console.error(`store-real: ${SOURCE} is missing (the dev data root, CLAUDE.md)`);
  process.exit(2);
}
const root = mkdtempSync(path.join(tmpdir(), "nazeer-store-real-"));
cpSync(SOURCE, path.join(root, "sessions", SESSION_ID), { recursive: true });
const token = randomBytes(32).toString("hex");
const engine = spawn(
  PYTHON,
  [
    "-m",
    "nazeer_engine",
    "--data-root",
    root,
    "--port",
    "0",
    `--token=${token}`,
    "--stub-model",
    "--no-warmup",
  ],
  {
    cwd: path.join(REPO_DIR, "engine"),
    env: { ...process.env, NAZEER_ENGINE_DEV: "1", PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  },
);
let code = 1;
try {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no ready line within 120 s")), 120_000);
    createInterface({ input: engine.stdout }).on("line", (line) => {
      if (!line.startsWith("{")) return;
      const event = JSON.parse(line);
      clearTimeout(timer);
      if (event.event === "ready") resolve(event);
      else reject(new Error(`engine: ${line}`));
    });
    engine.on("exit", (exit) => reject(new Error(`engine exited (${exit}) before ready`)));
  });
  const baseUrl = `http://127.0.0.1:${ready.port}`;
  const vitest = spawnSync(
    process.execPath,
    [
      path.join(APP_DIR, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "src/renderer/store/realEngine.test.ts",
    ],
    {
      cwd: APP_DIR,
      env: { ...process.env, NAZEER_REAL_ENGINE: `${baseUrl}|${token}|${SESSION_ID}` },
      stdio: "inherit",
    },
  );
  code = vitest.status ?? 1;
  await fetch(`${baseUrl}/system/shutdown`, {
    method: "POST",
    headers: { "X-Nazeer-Token": token },
  });
  await new Promise((resolve) =>
    engine.exitCode === null ? engine.on("exit", resolve) : resolve(),
  );
} catch (error) {
  console.error(`store-real: ${error instanceof Error ? error.message : error}`);
  if (engine.exitCode === null) engine.kill();
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exitCode = code;
