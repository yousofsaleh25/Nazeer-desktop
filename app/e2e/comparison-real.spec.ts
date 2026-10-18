// The comparison report with the real model (D12 Stage 6; NAZEER_REAL=1): the built app and its
// real engine (best.pt, warmed up) walk bag 006; two sessions on two proposed frames are measured at
// positions read from each frame's own mask and finalized through the engine's API; then the English
// UI makes the comparison in both languages exactly as the fast spec does (History selection, print
// order, cover, an approval per image, print and seal, "Save as" into a folder named in Arabic, the
// Comparisons tab, a reopened camel). The saved copy is read back with pdf.js: A4 pages, only the
// Plex face, the ids in the text layer, every attachment byte-identical to the approved images and
// the printed comparison data. About 5 minutes; skipped without NAZEER_REAL=1, bag 006 or the model.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BAG_006, launchApp, repoDir, waitForReady, type LaunchedApp } from "./helpers/app";
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
import { Engine, useLanguage, type Json, type SessionView } from "./helpers/flow";
import { labels } from "./helpers/labels";

const REAL = process.env["NAZEER_REAL"] === "1";
const MODEL = path.join(repoDir, "engine", "models", "best.pt");
const PINNED_MODEL_SHA = "0e9ee2baada7c70531b66e0b98f7e1cf4dcf3ce7971c55bce69a7270ec3a4320";
const t = labels("en");
const COVER = {
  title: "مقارنة اختبار حقيقي",
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

/** What the run measured, in the reporter's output. */
function note(text: string): void {
  console.log(`    ${text}`);
}

test.beforeAll(async () => {
  test.skip(!REAL, "set NAZEER_REAL=1 to run the real-model comparison (bag 006 and best.pt)");
  test.skip(!existsSync(BAG_006), `needs bag 006 (${BAG_006})`);
  test.skip(!existsSync(MODEL), `needs the model (${MODEL})`);
  saveDir = path.join(mkdtempSync(path.join(tmpdir(), "nazeer-e2e-real-compare-")), "مقارنات");
  mkdirSync(saveDir);
  launched = await launchApp({
    stubModel: false,
    env: { NAZEER_E2E_SAVE_DIALOG: `folder:${saveDir}` },
  });
  page = launched.page;
  engine = new Engine((await waitForReady(page, { timeoutMs: 240_000 })).connection);
});

test.afterAll(async () => {
  if (launched !== undefined) await launched.close();
  if (saveDir !== "") rmSync(path.dirname(saveDir), { recursive: true, force: true });
});

test("setup: the real model walks bag 006; two finalized sessions on two proposed frames", async () => {
  test.setTimeout(900_000);
  const health = await engine.json<Json>("/health");
  expect(health["model"]).toMatchObject({ stub: false, sha256: PINNED_MODEL_SHA });
  await useLanguage(page, "en");
  const set = await walkBag(engine, BAG_006, 840_000);
  expect(set.candidates.length).toBeGreaterThanOrEqual(2);
  sessions = await finalizedSessions(page, engine, set, CAMELS);
  const frameOf = (s: SessionView) => ((s.frame as Json)["candidate"] as Json)["candidate_id"];
  expect(frameOf(sessions[0])).not.toBe(frameOf(sessions[1]));
  for (const session of sessions) {
    const shown = session.measurements.map((m) =>
      m.presentation.rejected
        ? `"${m.name}" rejected: ${String(m.rejection_reason)}`
        : `"${m.name}" ${m.presentation.value_text.en}`,
    );
    note(`${session.session_id} (${String(frameOf(session))}): ${shown.join("; ")}`);
  }
});

test("the comparison through the English UI, both languages: sealed, saved, read back with pdf.js", async () => {
  test.setTimeout(600_000);
  if (launched === undefined) throw new Error("not launched");
  const [a, b] = sessions;
  comparisonId = await createThroughUi(page, t, sessions, COVER, "both");
  await printAndSeal(page, t);
  const view = await checkSealed(engine, comparisonId, [b, a]);
  expect(view.language).toBe("both");
  expect(view.cover).toMatchObject(COVER);
  // every text the engine required (names, camel ids, the cover) was found in the text layer
  const manifest = await engine.json<Json>(view.outputs.manifest_url ?? "");
  const text = (manifest["probes"] as Json)["text"] as {
    ok: boolean;
    names: { name: string; ok: boolean }[];
  };
  expect(text.ok).toBe(true);
  for (const required of view.required_report_texts) {
    expect(text.names.find((n) => n.name === required)?.ok, required).toBe(true);
  }
  const bytes = await checkSavedCopy(page, t, view, saveDir, "en");
  const content = await checkPdfContent(engine, view, bytes);
  note(
    `${comparisonId}: ${content.pages} A4 pages, ${(bytes.byteLength / 2 ** 20).toFixed(1)} MB, ` +
      `${view.required_report_texts.length} required texts found; attachments ` +
      content.attachments.join(", "),
  );

  await page.evaluate(() => {
    location.hash = "#/history?tab=comparisons";
  });
  await expect(page.locator(`tr[data-comparison="${comparisonId}"]`)).toContainText(COVER.title, {
    timeout: 30_000,
  });
  expect(launched.consoleErrors).toEqual([]);
});

test("reopening a camel from History makes the comparison out of date, with its reason", async () => {
  test.setTimeout(120_000);
  if (launched === undefined) throw new Error("not launched");
  await reopenMakesStale(page, t, engine, comparisonId, sessions[0], "en");
  expect(launched.consoleErrors).toEqual([]);
});
