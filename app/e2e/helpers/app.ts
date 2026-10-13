/**
 * Launching the built app for e2e: a throwaway userData, a throwaway data root (optionally seeded
 * with a session from the dev data root), the stub-model engine (fast start, no YOLO) unless a spec
 * asks for the real model, and helpers to wait for the supervisor's ready state and to collect
 * renderer console errors.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import type { EngineConnection, EngineStatusEvent } from "@shared/ipc";

export const appDir = path.resolve(__dirname, "..", "..");
export const repoDir = path.resolve(appDir, "..");
export const devRoot = path.join(repoDir, "runs", "dev_root");
/** the session real_run exported into the dev data root (copied, never modified) */
export const DEV_SESSION_ID = "20261011_152956_e20a7c";
export const BAG_004 = path.join(repoDir, "data", ".bag", "20260414_180708-004.bag");
export const BAG_006 = path.join(repoDir, "data", ".bag", "20260414_175757-006.bag");

export function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key === "ELECTRON_RENDERER_URL") continue;
    if (key.toUpperCase().startsWith("NAZEER_")) continue; // only what the test sets
    env[key] = value;
  }
  return { ...env, ...extra };
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
  dataRoot: string;
  consoleErrors: string[];
  /** quit the app (the real quit sequence) and delete the temp folders it created */
  close(): Promise<void>;
}

export interface LaunchOptions {
  seedSession?: boolean;
  /** false: the real model (engine/models/best.pt, warmed up) instead of the stub */
  stubModel?: boolean;
  env?: Record<string, string>;
  /** reuse these folders (a relaunch on the same profile); they are not deleted on close */
  userData?: string;
  dataRoot?: string;
}

export async function launchApp({
  seedSession = false,
  stubModel = true,
  env = {},
  userData: givenUserData,
  dataRoot: givenDataRoot,
}: LaunchOptions = {}): Promise<LaunchedApp> {
  const userData = givenUserData ?? mkdtempSync(path.join(tmpdir(), "nazeer-e2e-user-"));
  const dataRoot = givenDataRoot ?? mkdtempSync(path.join(tmpdir(), "nazeer-e2e-root-"));
  if (seedSession) {
    const source = path.join(devRoot, "sessions", DEV_SESSION_ID);
    if (!existsSync(source)) throw new Error(`dev session missing: ${source}`);
    mkdirSync(path.join(dataRoot, "sessions"), { recursive: true });
    cpSync(source, path.join(dataRoot, "sessions", DEV_SESSION_ID), { recursive: true });
  }
  const app = await electron.launch({
    args: [appDir],
    cwd: appDir,
    env: cleanEnv({
      NAZEER_USER_DATA_DIR: userData,
      NAZEER_DATA_ROOT: dataRoot,
      ...(stubModel ? { NAZEER_STUB_MODEL: "1" } : {}),
      ...env,
    }),
  });
  const page = await app.firstWindow();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  return {
    app,
    page,
    userData,
    dataRoot,
    consoleErrors,
    close: async () => {
      await app.close();
      if (givenUserData === undefined) rmSync(userData, { recursive: true, force: true });
      if (givenDataRoot === undefined) rmSync(dataRoot, { recursive: true, force: true });
    },
  };
}

/** Poll the supervisor's status through the bridge until ready (or fail on its fatal error). */
export async function waitForReady(
  page: Page,
  { timeoutMs = 120_000, notPid }: { timeoutMs?: number; notPid?: number } = {},
): Promise<{ connection: EngineConnection; event: EngineStatusEvent }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const event = await page.evaluate(() => window.nazeer.engine.getStatus());
    if (event.status === "fatal") {
      throw new Error(`engine fatal: ${JSON.stringify(event.fatal)}`);
    }
    const connection = event.connection;
    if (event.status === "ready" && connection !== null && connection.pid !== notPid) {
      return { connection, event };
    }
    if (Date.now() > deadline) throw new Error(`engine not ready: ${JSON.stringify(event)}`);
    await page.waitForTimeout(250);
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function waitPidGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isPidAlive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}
