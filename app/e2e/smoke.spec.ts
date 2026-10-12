// Built-app smoke test: run `npm run build` first (`npm run e2e` does). The app spawns its own
// engine (stub model) on a throwaway data root.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { appDir, launchApp, waitForReady } from "./helpers/app";

test("each sandboxed preload is one self-contained file (no shared chunk)", () => {
  const dir = join(appDir, "out", "preload");
  const files = readdirSync(dir).filter((name) => name.endsWith(".js"));
  expect(files.sort()).toEqual(["index.js", "print.js"]);
  for (const name of files) {
    const code = readFileSync(join(dir, name), "utf8");
    expect(code, name).not.toMatch(/require\(\s*["']\.{1,2}\//);
  }
});

test("the built app loads over app://nazeer with the bridge, a CSP header and its engine", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toBe("app://nazeer/renderer/index.html");

    const { connection } = await waitForReady(page);
    expect(connection.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(connection.token).toMatch(/^[0-9a-f]{64}$/);
    expect(connection.stubModel).toBe(true);
    expect(connection.dataRoot.toLowerCase()).toBe(launched.dataRoot.toLowerCase());
    // the operator screen appears once the engine is ready
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("نظير");

    const bridge = await page.evaluate(async () => ({
      type: typeof window.nazeer,
      connection: await window.nazeer.engine.getConnection(),
      secure: window.isSecureContext,
      subtle: typeof crypto.subtle?.digest,
    }));
    expect(bridge).toMatchObject({ type: "object", secure: true, subtle: "function" });
    expect(bridge.connection).toEqual(connection);

    const csp = await page.evaluate(async () =>
      (await fetch(location.href)).headers.get("content-security-policy"),
    );
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain("unsafe-eval");

    // context isolation + no Node integration: nothing of Node reaches the page's world
    const nodeGlobals = await page.evaluate(() => [
      typeof (globalThis as Record<string, unknown>)["require"],
      typeof (globalThis as Record<string, unknown>)["process"],
      typeof (globalThis as Record<string, unknown>)["Buffer"],
    ]);
    expect(nodeGlobals).toEqual(["undefined", "undefined", "undefined"]);
    expect(launched.consoleErrors).toEqual([]);
  } finally {
    await launched.close();
  }
});
