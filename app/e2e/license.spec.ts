// The licence gate end to end (D11) on the built app: keys made by the real generator
// (tools/generate-license.mjs) with a throwaway key pair, the app pointed at its public key
// (NAZEER_LICENSE_PUBLIC_KEY, development builds only) and told to require a licence
// (NAZEER_LICENSE_ENFORCE=1). Run `npm run build` first (`npm run e2e` does).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, repoDir, waitForReady } from "./helpers/app";

test.describe.configure({ mode: "serial" });

const generator = path.join(repoDir, "tools", "generate-license.mjs");
let work: string;
let keyDir: string;
let publicKeyOut: string;
let userData: string;
let dataRoot: string;

function generate(...args: string[]): string {
  const result = spawnSync(
    process.execPath,
    [generator, ...args, "--key-dir", keyDir, "--public-key-out", publicKeyOut],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`generator failed: ${result.stderr}`);
  return result.stdout.trim();
}

function licensedEnv(): Record<string, string> {
  return {
    NAZEER_LICENSE_ENFORCE: "1",
    NAZEER_LICENSE_PUBLIC_KEY: path.join(keyDir, "public-key.pem"),
  };
}

async function tryKey(page: Page, key: string) {
  const field = page.getByRole("textbox");
  await field.fill(key);
  await page.getByRole("button", { name: /Activate/ }).click();
}

function supervisorLog(): string {
  return readFileSync(path.join(userData, "logs", "app-engine-stderr.log"), "utf8");
}

test.beforeAll(() => {
  work = mkdtempSync(path.join(tmpdir(), "nazeer-e2e-license-"));
  keyDir = path.join(work, "keys");
  publicKeyOut = path.join(work, "publicKey.ts");
  userData = path.join(work, "profile");
  dataRoot = path.join(work, "data-root");
  generate("--init");
});

test.afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

test("first run: the Activate screen comes first, no engine runs, and each bad key says why", async () => {
  const launched = await launchApp({ env: licensedEnv(), userData, dataRoot });
  try {
    const { page } = launched;
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toContainText("Activate Nazeer");
    await expect(title).toContainText("تفعيل نظير");
    const engine = await page.evaluate(() => window.nazeer.engine.getStatus());
    expect(engine).toMatchObject({ seq: 0, status: "starting", connection: null });
    expect(supervisorLog()).toContain("engine waits for a licence");
    expect(supervisorLog()).not.toContain("start #1");

    const alert = page.getByRole("alert");
    await tryKey(page, "hello");
    await expect(alert).toContainText("This is not a valid licence key");
    await expect(alert).toContainText("هذا ليس مفتاح ترخيص صالحًا");

    const good = generate("--days", "1");
    const middle = Math.floor(good.length / 2);
    const tampered =
      good.slice(0, middle) + (good[middle] === "A" ? "B" : "A") + good.slice(middle + 1);
    await tryKey(page, tampered);
    await expect(alert).toContainText("was not issued for Nazeer");
    await expect(alert).toContainText("لم يُصدر هذا المفتاح لنظير");

    await tryKey(page, generate("--expires", "2026-01-01T00:00:00Z"));
    await expect(alert).toContainText("This licence key has expired");
    await expect(alert).toContainText("انتهت صلاحية مفتاح الترخيص هذا");
    await expect(alert).toContainText("2026-01-01");
    expect(supervisorLog()).not.toContain("start #1");

    // a --days 1 key: accepted, stored, and the engine starts
    await tryKey(page, `${good.slice(0, 50)}\n${good.slice(50)}`);
    await waitForReady(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("نظير");
    expect(supervisorLog()).toContain("start #1");
    const marker = JSON.parse(readFileSync(path.join(userData, "app-license.json"), "utf8")) as {
      key: string;
    };
    expect(marker.key).toBe(good);
  } finally {
    await launched.close();
  }
});

test("relaunch on the same profile: the stored key is verified again, no Activate screen", async () => {
  const launched = await launchApp({ env: licensedEnv(), userData, dataRoot });
  try {
    await waitForReady(launched.page);
    await expect(launched.page.getByRole("heading", { level: 1 })).toHaveText("نظير");
  } finally {
    await launched.close();
  }
});

test("a stored trial that has ended opens the Activate screen with its date", async () => {
  const expired = generate("--expires", "2026-02-01T08:00:00Z");
  writeFileSync(
    path.join(userData, "app-license.json"),
    JSON.stringify({ v: 1, key: expired, activatedAt: "2026-01-31T08:00:00.000Z" }),
    "utf8",
  );
  const launched = await launchApp({ env: licensedEnv(), userData, dataRoot });
  try {
    const { page } = launched;
    await expect(page.getByText("The trial has ended. Enter a new key to continue.")).toBeVisible();
    await expect(
      page.getByText("انتهت الفترة التجريبية. أدخل مفتاحًا جديدًا للمتابعة."),
    ).toBeVisible();
    await expect(page.getByText(/2026-02-01/)).toBeVisible();
    const engine = await page.evaluate(() => window.nazeer.engine.getStatus());
    expect(engine.status).toBe("starting");
  } finally {
    await launched.close();
  }
});
