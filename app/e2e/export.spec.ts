// Printing and sealing a report in the built app (ADR-D7): a copy of the dev data root's session
// (stub-model engine: the overlay, report model, PDF probes and attachments are all real) is
// reopened and finalized again (report model 1.1, overlay v2), its image approved on the Finalize
// screen, and printed from the Report screen — main lays the print page out in a hidden window,
// printToPDF, and the engine probes and seals it. "Save as" (D12): once the viewer has verified
// the sealed bytes the Save dialog opens by itself — answered here by the test switch with a folder
// whose name is Arabic — and the copy on disk is the sealed report byte for byte; History saves it
// again. Then the headless re-export (`--export`): refused while the app serves the data root,
// accepted once it is closed. Run `npm run build` first (`npm run e2e` does).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import type { EngineConnection } from "@shared/ipc";
import { sessionReportFileName } from "../src/shared/fileNames";
import {
  appDir,
  cleanEnv,
  DEV_SESSION_ID,
  devRoot,
  launchApp,
  waitForReady,
  type LaunchedApp,
} from "./helpers/app";
import { labels } from "./helpers/labels";

const t = labels("ar");

test.describe.configure({ mode: "serial" });

let launched: LaunchedApp;
let page: Page;
let connection: EngineConnection;
let closed = false;
let sessionDir: string;
/** where the Save dialog's test switch saves copies (a folder with an Arabic name) */
let saveDir: string;
/** the Electron executable (the `electron` package exports its path in Node) */
const electronPath = createRequire(__filename)("electron") as string;

type Json = Record<string, unknown>;

async function engine(method: string, route: string, body?: unknown): Promise<Json> {
  return page.evaluate(
    async ({ conn, method, route, body }) => {
      const response = await fetch(`${conn.baseUrl}${route}`, {
        method,
        headers: {
          "X-Nazeer-Token": conn.token,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
      return { status: response.status, ...((await response.json()) as Record<string, unknown>) };
    },
    { conn: connection, method, route, body },
  );
}

/** Run the built app headless: `electron . --export <session dir> --out <file>`. */
function headlessExport(): { code: number | null; result: Json; stderr: string } {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "nazeer-e2e-export-")), "result.json");
  const run = spawnSync(electronPath, [appDir, "--export", sessionDir, "--out", out], {
    cwd: appDir,
    env: cleanEnv({
      NAZEER_USER_DATA_DIR: mkdtempSync(path.join(tmpdir(), "nazeer-e2e-export-user-")),
      NAZEER_STUB_MODEL: "1",
    }),
    encoding: "utf8",
    timeout: 240_000,
  });
  const result = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as Json) : {};
  rmSync(path.dirname(out), { recursive: true, force: true });
  return { code: run.status, result, stderr: run.stderr };
}

test.beforeAll(async () => {
  test.skip(
    !existsSync(path.join(devRoot, "sessions", DEV_SESSION_ID)),
    `needs the dev data root session ${DEV_SESSION_ID} (runs\\dev_root)`,
  );
  saveDir = path.join(mkdtempSync(path.join(tmpdir(), "nazeer-e2e-save-")), "اختبار حفظ");
  mkdirSync(saveDir);
  launched = await launchApp({
    seedSession: true,
    env: { NAZEER_E2E_SAVE_DIALOG: `folder:${saveDir}` },
  });
  page = launched.page;
  connection = (await waitForReady(page)).connection;
  sessionDir = path.join(launched.dataRoot, "sessions", DEV_SESSION_ID);
});

test.afterAll(async () => {
  if (launched !== undefined && !closed) await launched.close();
  if (saveDir !== undefined) rmSync(path.dirname(saveDir), { recursive: true, force: true });
});

test("finalize again, approve on the engine's image, print: the engine seals the PDF", async () => {
  test.setTimeout(240_000);
  const id = DEV_SESSION_ID;
  const reopened = await engine("POST", `/sessions/${id}/reopen`);
  expect(reopened["status"]).toBe("open");
  const finalized = await engine("POST", `/sessions/${id}/finalize`, {
    revision: reopened["revision"],
  });
  expect(finalized["status"]).toBe("finalized");
  const outputs = finalized["outputs"] as Json;
  const overlay = outputs["overlay"] as Json;
  expect(overlay["version"]).toBe(2);

  // the approval: the Finalize screen verifies the overlay bytes with WebCrypto
  await page.evaluate((sid) => {
    location.hash = `#/sessions/${sid}/finalize`;
  }, id);
  const approve = page.getByRole("button", { name: "اعتماد هذه الصورة" });
  await expect(approve).toBeEnabled({ timeout: 60_000 });
  await approve.click();

  await page.evaluate((sid) => {
    location.hash = `#/sessions/${sid}/report`;
  }, id);
  const print = page.getByRole("button", { name: "اطبعه من جديد" });
  await expect(print).toBeEnabled({ timeout: 60_000 });
  await print.click();
  await expect(page.getByText("خُتم التقرير")).toBeVisible({ timeout: 180_000 });

  const sealed = await engine("GET", `/sessions/${id}`);
  expect(sealed["status"]).toBe("exported");
  const report = (sealed["outputs"] as Json)["report"] as Json;
  expect(report).toMatchObject({ version: 2, overlay_version: 2, stale: false });
  const manifestUrl = (sealed["outputs"] as Json)["manifest_url"] as string;
  const manifest = await engine("GET", manifestUrl);
  const probes = manifest["probes"] as Json;
  expect(probes["verdict"]).toBe("PASS");
  expect(probes["hard_failures"]).toEqual([]);
  const pixel = probes["pixel"] as Json;
  expect((pixel["match"] as Json)["max_abs_diff"]).toBe(0);
  const text = probes["text"] as Json;
  expect(text["ok"]).toBe(true);
  expect(text["n_missing"]).toBe(0);
  const fonts = probes["fonts"] as Json;
  expect(fonts["ok"]).toBe(true);
  expect(fonts["type3_present"]).toBe(false);
  expect(probes["attachments_ok"]).toBe(true);
  // the printer that made it: this app's Electron and Chromium
  expect(manifest["printer"]).toMatchObject({
    electron: expect.stringMatching(/^44\./),
    chromium: expect.stringMatching(/^\d+\./),
  });

  // the sign-off view shows the sealed PDF, its fingerprint checked
  await expect(page.getByText("البصمة مطابقة").first()).toBeVisible({ timeout: 60_000 });

  // D12: once the viewer verified the sealed bytes, the Save dialog opened by itself; the test
  // switch answered it with the save folder, and main wrote the copy under the default name
  const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const asText = (value: unknown) => (typeof value === "string" ? value : "");
  const name = sessionReportFileName({
    camelId: asText(sealed["camel_id"]),
    sessionId: id,
    createdAt: asText(sealed["created_at"]),
    version: 2,
  });
  expect(name.endsWith("_v2.pdf")).toBe(true);
  const copy = path.join(saveDir, name);
  await expect.poll(() => existsSync(copy), { timeout: 60_000 }).toBe(true);
  await expect(page.getByTestId("saved-copy")).toContainText(t("report.savedTo"));
  expect(sha256(copy)).toBe(report["sha256"]);
  expect(readdirSync(saveDir)).toEqual([name]); // the temp file was renamed over it

  // History saves the same sealed report again from its row
  await page.evaluate(() => {
    location.hash = "#/history";
  });
  const historyRow = page.locator(`tr[data-session="${id}"]`);
  const firstWritten = statSync(copy).mtimeMs;
  await historyRow.getByRole("button", { name: t("report.saveAs") }).click();
  const notice = page.getByTestId("history-save-copy");
  await expect(notice).toContainText(t("report.savedTo"), { timeout: 60_000 });
  // the notice names this report's copy at once (it was saved before): wait for the new copy to
  // replace it, then for the save to end, and only then look at the folder
  await expect
    .poll(() => statSync(copy).mtimeMs, { timeout: 60_000 })
    .toBeGreaterThan(firstWritten);
  await expect(notice.getByRole("button", { name: t("report.saveAs") })).toBeEnabled({
    timeout: 60_000,
  });
  expect(sha256(copy)).toBe(report["sha256"]);
  expect(readdirSync(saveDir)).toEqual([name]);
  expect(launched.consoleErrors).toEqual([]);
});

test("the headless re-export refuses while the app serves the data root", async () => {
  test.setTimeout(240_000);
  const run = headlessExport();
  expect(run.code, run.stderr).toBe(4);
  expect(run.result).toMatchObject({
    ok: false,
    session_id: DEV_SESSION_ID,
    error: { code: "engine_already_running" },
  });
  // the app's engine was not touched
  const health = await engine("GET", "/health");
  expect(health["pid"]).toBe(connection.pid);
});

test("once the app is closed, the headless re-export prints and seals it again", async () => {
  test.setTimeout(300_000);
  await launched.app.close();
  closed = true;
  const run = headlessExport();
  expect(run.code, `${run.stderr}\n${JSON.stringify(run.result)}`).toBe(0);
  expect(run.result).toMatchObject({ ok: true, verdict: "PASS", error: null });
  expect(run.result["report"]).toMatchObject({ version: 3, overlay_version: 2 });
  rmSync(launched.userData, { recursive: true, force: true });
  rmSync(launched.dataRoot, { recursive: true, force: true });
});
