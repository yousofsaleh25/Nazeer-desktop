// Production build ↔ its own engine (stub model): the packaged renderer origin app://nazeer
// reaches the engine on 127.0.0.1 with the token (fetch, <img ?token>, EventSource), WebCrypto
// hashes engine bytes, the supervisor restarts a killed engine, and quitting stops it. D9 records
// the result. Run `npm run build` first (`npm run e2e` does).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { EngineConnection } from "@shared/ipc";
import {
  BAG_004,
  DEV_SESSION_ID,
  devRoot,
  launchApp,
  waitForReady,
  waitPidGone,
  type LaunchedApp,
} from "./helpers/app";

test.describe.configure({ mode: "serial" });

let launched: LaunchedApp;
let page: Page;
let connection: EngineConnection;
let closed = false;
/** HTTP statuses this spec provokes on purpose (the browser logs each failed load) */
const provoked = new Set(["401"]);

function withToken(conn: EngineConnection, route: string): string {
  const url = new URL(route, conn.baseUrl);
  url.searchParams.set("token", conn.token);
  return url.toString();
}

test.beforeAll(async () => {
  test.skip(
    !existsSync(path.join(devRoot, "sessions", DEV_SESSION_ID)),
    `needs the dev data root session ${DEV_SESSION_ID} (runs\\dev_root)`,
  );
  launched = await launchApp({ seedSession: true });
  page = launched.page;
  connection = (await waitForReady(page)).connection;
});

test.afterAll(async () => {
  if (launched !== undefined && !closed) await launched.close();
});

test("fetch from app://nazeer reaches the engine with the token; without it, 401", async () => {
  const result = await page.evaluate(async (conn) => {
    const withHeader = await fetch(`${conn.baseUrl}/versions`, {
      headers: { "X-Nazeer-Token": conn.token },
      cache: "no-store",
    });
    const withoutToken = await fetch(`${conn.baseUrl}/versions`, { cache: "no-store" });
    const health = await fetch(`${conn.baseUrl}/health`, { cache: "no-store" });
    return {
      origin: location.origin,
      ok: withHeader.status,
      versions: (await withHeader.json()) as Record<string, unknown>,
      denied: withoutToken.status,
      deniedBody: (await withoutToken.json()) as { error: { code: string } },
      health: health.status,
    };
  }, connection);
  expect(result.origin).toBe("app://nazeer");
  expect(result.ok).toBe(200);
  expect(result.versions["engine_version"]).toBe(connection.engineVersion);
  expect(result.denied).toBe(401);
  expect(result.deniedBody.error.code).toBe("unauthorized");
  expect(result.health).toBe(200);
});

test("the app's own client renders /health on the About screen", async () => {
  const health = (await (await fetch(`${connection.baseUrl}/health`)).json()) as {
    run_id: string;
  };
  await page.evaluate(() => {
    location.hash = "#/about";
  });
  await expect(page.getByText(health.run_id)).toBeVisible();
  await expect(page.getByText("pyrealsense2")).toBeVisible();
});

test("<img ?token> loads an engine asset into a canvas that stays readable (CORS)", async () => {
  const route = `/sessions/${DEV_SESSION_ID}/assets/thumb.jpg`;
  const result = await page.evaluate(
    async ({ withTokenUrl, withoutTokenUrl }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = src;
        });
      const img = await load(withTokenUrl);
      const denied = await load(withoutTokenUrl);
      let readable = false;
      if (img !== null) {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        try {
          ctx.getImageData(0, 0, 1, 1);
          readable = true;
        } catch {
          readable = false;
        }
      }
      return {
        loaded: img !== null,
        size: img === null ? null : [img.naturalWidth, img.naturalHeight],
        readable,
        deniedWithoutToken: denied === null,
      };
    },
    {
      withTokenUrl: withToken(connection, route),
      withoutTokenUrl: new URL(route, connection.baseUrl).toString(),
    },
  );
  expect(result).toEqual({
    loaded: true,
    size: [320, 180],
    readable: true,
    deniedWithoutToken: true,
  });
});

test("WebCrypto SHA-256 of engine bytes equals the file's own SHA-256", async () => {
  const route = `/sessions/${DEV_SESSION_ID}/assets/rgb.png`;
  const result = await page.evaluate(
    async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      return { status: response.status, size: bytes.byteLength, hex };
    },
    withToken(connection, route),
  );
  const file = readFileSync(path.join(devRoot, "sessions", DEV_SESSION_ID, "rgb.png"));
  expect(result.status).toBe(200);
  expect(result.size).toBe(file.byteLength);
  expect(result.hex).toBe(createHash("sha256").update(file).digest("hex"));
});

test("EventSource: progress events from a stub walk on bag 004, then cancelled", async () => {
  test.skip(!existsSync(BAG_004), `bag 004 not found at ${BAG_004}`);
  const outcome = await page.evaluate(
    async ({ conn, bag }) => {
      const headers = { "X-Nazeer-Token": conn.token, "Content-Type": "application/json" };
      const start = await fetch(`${conn.baseUrl}/candidates/jobs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ bag_path: bag }),
      });
      const started = (await start.json()) as {
        job?: { job_id: string } | null;
        error?: { code: string; message: string };
      };
      if (start.status !== 202 || !started.job) {
        return {
          startStatus: start.status,
          startError: started.error ?? null,
          events: [] as string[],
          final: null,
        };
      }
      const jobId = started.job.job_id;
      const events: string[] = [];
      const url = new URL(`/candidates/jobs/${jobId}/events`, conn.baseUrl);
      url.searchParams.set("token", conn.token);
      const final = await new Promise<string>((resolve, reject) => {
        const source = new EventSource(url.toString());
        const timer = setTimeout(() => {
          source.close();
          reject(new Error(`no terminal event; saw ${events.join(",")}`));
        }, 90_000);
        let cancelSent = false;
        source.addEventListener("progress", () => {
          events.push("progress");
          if (!cancelSent) {
            cancelSent = true;
            void fetch(`${conn.baseUrl}/candidates/jobs/${jobId}/cancel`, {
              method: "POST",
              headers,
            });
          }
        });
        for (const name of ["done", "cancelled", "failed"]) {
          source.addEventListener(name, (event) => {
            events.push(name);
            clearTimeout(timer);
            source.close();
            resolve((event as MessageEvent<string>).data);
          });
        }
      });
      return {
        startStatus: start.status,
        startError: null,
        events,
        final: JSON.parse(final) as { state: string },
      };
    },
    { conn: connection, bag: BAG_004 },
  );
  // Windows Smart App Control can block the unsigned pyrealsense2 DLL (seen 2026-10-12 on the
  // dev laptop): the engine then cannot open any bag, so there is no job to stream. Only that
  // exact cause skips; any other failure to start fails the test.
  const blocked = /Application Control policy has blocked/.test(outcome.startError?.message ?? "");
  if (outcome.startStatus === 500 && blocked) provoked.add("500");
  test.skip(
    outcome.startStatus === 500 && blocked,
    `engine cannot load pyrealsense2 (Windows Application Control): ${outcome.startError?.message}`,
  );
  expect(outcome.startError).toBeNull();
  expect(outcome.startStatus).toBe(202);
  expect(outcome.events[0]).toBe("progress");
  expect(outcome.events.at(-1)).toBe("cancelled");
  expect(outcome.final?.state).toBe("cancelled");
});

test("a killed engine is restarted: new pid, port and token; the old token is refused", async () => {
  const before = connection;
  process.kill(before.pid);
  const { connection: after, event } = await waitForReady(page, {
    notPid: before.pid,
    timeoutMs: 90_000,
  });
  expect(event.restarts).toBe(1);
  expect(after.token).not.toBe(before.token);
  const statuses = await page.evaluate(
    async ({ next, oldToken }) => {
      const ok = await fetch(`${next.baseUrl}/versions`, {
        headers: { "X-Nazeer-Token": next.token },
      });
      const stale = await fetch(`${next.baseUrl}/versions`, {
        headers: { "X-Nazeer-Token": oldToken },
      });
      return [ok.status, stale.status];
    },
    { next: after, oldToken: before.token },
  );
  expect(statuses).toEqual([200, 401]);
  // the screen came back on the new engine
  await expect(page.getByText("pyrealsense2")).toBeVisible();
  connection = after;
});

test("no unexpected renderer errors; quitting stops the engine (shutdown, not kill)", async () => {
  // the only console errors are the failed loads this spec provoked on purpose
  const unexpected = launched.consoleErrors.filter(
    (text) => ![...provoked].some((status) => text.includes(`status of ${status}`)),
  );
  expect(unexpected).toEqual([]);

  const pid = connection.pid;
  const logFile = path.join(launched.userData, "logs", "app-engine-stderr.log");
  await launched.app.close();
  closed = true;
  expect(await waitPidGone(pid, 15_000)).toBe(true);
  const log = readFileSync(logFile, "utf8");
  expect(log).toContain("shutdown requested");
  expect(log).toContain("[supervisor] stopped");
  expect(log).not.toContain("killing the engine");
  expect(log).not.toContain(connection.token);
  rmSync(launched.userData, { recursive: true, force: true });
  rmSync(launched.dataRoot, { recursive: true, force: true });
});
