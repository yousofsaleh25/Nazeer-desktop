// The comparison report through the built app (D12 Stage 6), fast: the stub-model engine with
// `--stub-mask ellipse` walks the real bag 004; two sessions on two proposed frames are measured and
// finalized through the engine's API, then the Arabic UI does what the operator does: tick both
// camels in History, put them in print order, fill the cover, approve each image on the engine's
// full image, create, print and seal; the Save dialog (answered by the test switch with a folder
// named in Arabic) writes the sealed PDF byte for byte under the default Arabic name; the
// Comparisons tab lists it; reopening one camel from History turns it out of date with that camel's
// reason. Run `npm run build` first (`npm run e2e` does). Skipped when bag 004 is absent.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BAG_004, launchApp, waitForReady, type LaunchedApp } from "./helpers/app";
import {
  CAMELS,
  checkPdfContent,
  checkSavedCopy,
  checkSealed,
  createThroughUi,
  finalizedSessions,
  printAndSeal,
  reopenMakesStale,
  walkBag,
} from "./helpers/comparison";
import { Engine, type Json, type SessionView } from "./helpers/flow";
import { labels } from "./helpers/labels";

const t = labels("ar");
const COVER = {
  title: "مقارنة اختبار سريع",
  event: "مزاين الإبل - تشغيل تجريبي",
  judge: "حكم الاختبار",
  council: "مجلس حكام الاختبار",
};

test.describe.configure({ mode: "serial" });

let launched: LaunchedApp | undefined;
let page: Page;
let engine: Engine;
let saveDir = "";
let sessions: [SessionView, SessionView];
let comparisonId = "";

test.beforeAll(async () => {
  test.skip(!existsSync(BAG_004), `needs bag 004 (${BAG_004})`);
  saveDir = path.join(mkdtempSync(path.join(tmpdir(), "nazeer-e2e-compare-")), "اختبار مقارنة");
  mkdirSync(saveDir);
  launched = await launchApp({
    env: { NAZEER_STUB_MASK: "ellipse", NAZEER_E2E_SAVE_DIALOG: `folder:${saveDir}` },
  });
  page = launched.page;
  engine = new Engine((await waitForReady(page)).connection);
});

test.afterAll(async () => {
  if (launched !== undefined) await launched.close();
  if (saveDir !== "") rmSync(path.dirname(saveDir), { recursive: true, force: true });
});

test("setup: two finalized sessions on two proposed frames of bag 004", async () => {
  test.setTimeout(300_000);
  expect(engine.conn).toMatchObject({ stubModel: true, modelFile: "stub-ellipse" });
  const set = await walkBag(engine, BAG_004, 240_000);
  expect(set.candidates.length).toBeGreaterThanOrEqual(2);
  sessions = await finalizedSessions(page, engine, set, CAMELS);
  const frameOf = (s: SessionView) => ((s.frame as Json)["candidate"] as Json)["candidate_id"];
  expect(frameOf(sessions[0])).not.toBe(frameOf(sessions[1]));
});

test("History → Compare → order, cover, approvals → print and seal → Save as → Comparisons tab", async () => {
  test.setTimeout(360_000);
  if (launched === undefined) throw new Error("not launched");
  const [a, b] = sessions;
  comparisonId = await createThroughUi(page, t, sessions, COVER, "ar");
  await printAndSeal(page, t);
  const view = await checkSealed(engine, comparisonId, [b, a]);
  expect(view.language).toBe("ar");
  expect(view.cover).toMatchObject(COVER);
  const bytes = await checkSavedCopy(page, t, view, saveDir, "ar");
  await checkPdfContent(engine, view, bytes);

  await page.evaluate(() => {
    location.hash = "#/history?tab=comparisons";
  });
  const listed = page.locator(`tr[data-comparison="${comparisonId}"]`);
  await expect(listed).toContainText(COVER.title, { timeout: 30_000 });
  await expect(listed).not.toContainText(t("comparisons.stale"));
  // the camels in print order: #1 camel B, #2 camel A
  const chips = await listed.locator("ol li").allTextContents();
  expect(chips).toHaveLength(2);
  expect(chips[0]).toContain(CAMELS[1].camelId);
  expect(chips[1]).toContain(CAMELS[0].camelId);
  expect(launched.consoleErrors).toEqual([]);
});

test("reopening a camel from History makes the comparison out of date, with its reason", async () => {
  test.setTimeout(120_000);
  if (launched === undefined) throw new Error("not launched");
  await reopenMakesStale(page, t, engine, comparisonId, sessions[0], "ar");
  expect(launched.consoleErrors).toEqual([]);
});
