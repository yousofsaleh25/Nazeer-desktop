// Built-app smoke test (Stage 1): run `npm run build` first (`npm run e2e` does).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const appDir = resolve(__dirname, "..");

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RENDERER_URL") env[key] = value;
  }
  return { ...env, ...extra };
}

test("each sandboxed preload is one self-contained file (no shared chunk)", () => {
  const dir = join(appDir, "out", "preload");
  const files = readdirSync(dir).filter((name) => name.endsWith(".js"));
  expect(files.sort()).toEqual(["index.js", "print.js"]);
  for (const name of files) {
    const code = readFileSync(join(dir, name), "utf8");
    expect(code, name).not.toMatch(/require\(\s*["']\.{1,2}\//);
  }
});

test("the built app loads over app://nazeer with the bridge and a CSP header", async () => {
  const userData = mkdtempSync(join(tmpdir(), "nazeer-e2e-"));
  const app = await electron.launch({
    args: [appDir],
    cwd: appDir,
    env: cleanEnv({ NAZEER_USER_DATA_DIR: userData }),
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toBe("app://nazeer/renderer/index.html");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("نظير");

    const bridge = await page.evaluate(async () => ({
      type: typeof window.nazeer,
      connection: await window.nazeer.engine.getConnection(),
      secure: window.isSecureContext,
      subtle: typeof crypto.subtle?.digest,
    }));
    expect(bridge).toEqual({ type: "object", connection: null, secure: true, subtle: "function" });

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
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
