// The whole operator flow in the built app, fast (plan Stage 8a): the stub-model engine with
// `--stub-mask ellipse` (the same centred ellipse in every frame, no YOLO) walks the real bag 004,
// and the test drives the UI in Arabic like an operator: open the recording (the OS dialog answered
// in main), search it, pick a proposed frame, four named measurements (the keyboard crosshair, the
// mouse, and the keyboard with the mouse resting on the canvas), finalize, approve on the engine's
// image, print; the engine seals the PDF. Run
// `npm run build` first (`npm run e2e` does). Skipped when bag 004 is absent.
import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { BAG_004, launchApp, waitForReady, type LaunchedApp } from "./helpers/app";
import {
  chooseTool,
  clickAt,
  Engine,
  finalizeAndApprove,
  findFrames,
  framePoints,
  hoverAt,
  nameIt,
  need,
  openBagWithDialog,
  printAndWaitSealed,
  startSession,
  waitAllSaved,
  type CandidateSet,
  type Json,
  type Point,
} from "./helpers/flow";
import { labels } from "./helpers/labels";

const t = labels("ar");
const CAMEL_ID = "ناقة-اختبار-سريع";

test.describe.configure({ mode: "serial" });

let launched: LaunchedApp | undefined;
let page: Page;
let engine: Engine;

test.beforeAll(async () => {
  test.skip(!existsSync(BAG_004), `needs bag 004 (${BAG_004})`);
  launched = await launchApp({ env: { NAZEER_STUB_MASK: "ellipse" } });
  page = launched.page;
  engine = new Engine((await waitForReady(page)).connection);
});

test.afterAll(async () => {
  if (launched !== undefined) await launched.close();
});

test("bag 004 to a sealed PDF through the UI: frames, session, measurements, approval, print", async () => {
  test.setTimeout(360_000);
  if (launched === undefined) throw new Error("not launched");
  expect(engine.conn).toMatchObject({ stubModel: true, modelFile: "stub-ellipse" });

  // open the recording and search it
  await openBagWithDialog(launched.app, page, t, BAG_004);
  const { fingerprint, paramsHash } = await findFrames(page, t, 180_000);
  const set = await engine.json<CandidateSet>(`/candidates/${fingerprint}/${paramsHash}`);
  expect(set.model).toMatchObject({ file: "stub-ellipse", sha256: "stub-ellipse", stub: true });
  expect(set.candidates.length).toBeGreaterThan(0);
  expect(await page.getByRole("article").count()).toBe(set.candidates.length);

  // pick a frame and start the session
  const sessionId = await startSession(page, t, null, CAMEL_ID, "e2e");
  const created = await engine.session(sessionId);
  expect(created).toMatchObject({ revision: 0, camel_id: CAMEL_ID, status: "open" });
  const points = await framePoints(page, engine, created);

  // 1. a 2D distance with the keyboard crosshair (Enter shows it in the middle of the frame)
  await chooseTool(page, t, "1");
  await page.mouse.move(5, 5);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 12; i += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Enter");
  await nameIt(page, t, "عرض الصدر");
  // 2. a 3D distance with the mouse
  await chooseTool(page, t, "2");
  await clickAt(page, points.left);
  await clickAt(page, points.right);
  await nameIt(page, t, "طول الجسم");
  // 3. a 3D curve along the back; a double-click finishes it
  await chooseTool(page, t, "4");
  for (const point of points.back.slice(0, -1)) await clickAt(page, point);
  const last = points.back.at(-1);
  if (last === undefined) throw new Error("no back points");
  await clickAt(page, last, { double: true });
  await nameIt(page, t, "خط الظهر");
  await page.keyboard.press("Escape");
  // 4. the keyboard with the mouse resting on the canvas: the crosshair is where the mouse stopped,
  //    Enter places there, the arrows move it from there, and the resting mouse never takes it back
  //    while the layout changes under it (the in-progress line, the name prompt, the list)
  await chooseTool(page, t, "1");
  await hoverAt(page, points.centre);
  await page.getByRole("application", { name: t("measure.canvasLabel") }).focus();
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await nameIt(page, t, "عرض الرقبة");
  await page.keyboard.press("Escape");
  await waitAllSaved(page, 4);

  const saved = await engine.session(sessionId);
  expect(saved.measurements.map((m) => [m.name, m.input_kind])).toEqual([
    ["عرض الصدر", "distance_2d"],
    ["طول الجسم", "distance_3d"],
    ["خط الظهر", "curve_3d"],
    ["عرض الرقبة", "distance_2d"],
  ]);
  const [keyboard, , curve, resting] = saved.measurements;
  expect(keyboard?.input.points).toEqual([
    [640, 360],
    [760, 360],
  ]);
  expect(curve?.input.points).toHaveLength(points.back.length);
  const [start, end] = (resting?.input.points ?? []) as Point[];
  expect(Math.hypot(start![0] - points.centre[0], start![1] - points.centre[1])).toBeLessThan(1.5);
  expect(end![0] - start![0]).toBeCloseTo(50, 6);
  expect(end![1] - start![1]).toBeCloseTo(0, 6);
  for (const row of saved.measurements) {
    // the stub's ellipse is not a camel: a value, or a rejection with its reason, never a blank
    expect(row.presentation.value !== null || Boolean(row.rejection_reason), row.name).toBe(true);
  }

  // finalize, approve on the engine's image (verified with WebCrypto), print and seal
  const src = await finalizeAndApprove(page, t);
  expect(src.startsWith("blob:")).toBe(true);
  await printAndWaitSealed(page, t);

  const sealed = await engine.session(sessionId);
  expect(sealed.status).toBe("exported");
  expect(sealed.outputs.report).toMatchObject({ version: 1, overlay_version: 1, stale: false });
  const manifest = await engine.json<Json>(need(sealed.outputs.manifest_url, "manifest"));
  const probes = manifest["probes"] as Json;
  expect(probes["verdict"]).toBe("PASS");
  expect(probes["hard_failures"]).toEqual([]);
  expect(((probes["pixel"] as Json)["match"] as Json)["max_abs_diff"]).toBe(0);
  expect(probes["text"]).toMatchObject({ ok: true, n_missing: 0 });
  expect(probes["fonts"]).toMatchObject({ ok: true, type3_present: false });
  expect(probes["attachments_ok"]).toBe(true);
  expect(launched.consoleErrors).toEqual([]);
});
