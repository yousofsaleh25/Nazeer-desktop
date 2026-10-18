// The end-to-end proof with the real model (plan Stage 8b; NAZEER_REAL=1): the built app and its
// real engine (best.pt, warmed up) on bag 006, driven through the UI in English like an operator,
// with every check engine/tools/real_run.py makes, here on what the app itself produced: health and
// the pinned model, rgb8, the frame search and its gates, Z_ref, depth sources as placed (hovered
// and saved), autosave (one revision per save; a replay is a 200, a stale save a 409 with the
// current view), previews = saved values, the 3D curve's cross-check, the overlay and report model
// hashes, then print and seal (probes PASS, pixel |Δ| 0, every name in the text layer, only the
// Plex face, attachments byte-identical to what was approved and printed), the copy "Save as" wrote
// (D12) identical to the sealed report, History. Content only, never PDF bytes. About 5 minutes;
// skipped without NAZEER_REAL=1, bag 006 or the model.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";
import { BAG_006, launchApp, repoDir, waitForReady, type LaunchedApp } from "./helpers/app";
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
  openBagByPath,
  printAndWaitSealed,
  startSession,
  useLanguage,
  waitAllSaved,
  type CandidateSet,
  type DepthOut,
  type FramePoints,
  type Json,
  type MeasurementRow,
  type Point,
  type SessionView,
} from "./helpers/flow";
import { labels } from "./helpers/labels";
import { readPdf, sha256 } from "./helpers/pdf";
import { sessionReportFileName } from "../src/shared/fileNames";

const REAL = process.env["NAZEER_REAL"] === "1";
const MODEL = path.join(repoDir, "engine", "models", "best.pt");
const PINNED_MODEL_SHA = "0e9ee2baada7c70531b66e0b98f7e1cf4dcf3ce7971c55bce69a7270ec3a4320";
const A4_PT = [595.28, 841.89] as const;
const INSIDE_SOURCES = ["window_median", "knn_fill"];
const OUTSIDE_SOURCES = ["knn_snapped_to_mask", "knn_no_depth_band"];
const CAMEL_ID = "جمل-اختبار-حقيقي";
const NAMES = {
  judge: "حكم الاختبار",
  council: "مجلس حكام الاختبار",
  event: "مزاين الإبل - تشغيل تجريبي",
};
const t = labels("en");

test.describe.configure({ mode: "serial" });

let launched: LaunchedApp | undefined;
let page: Page;
let engine: Engine;
let set: CandidateSet;
let sessionId = "";
let points: FramePoints;
let saved: SessionView;
let approvedOverlay: Uint8Array;
let saveDir = "";
const depthReplies: { body: { u: number; v: number; target: string }; reply: DepthOut }[] = [];
const documentSaves: { status: number; revision: number | null; ifMatch: string | null }[] = [];

/** Both rejected (null), or equal values. */
function same(a: number | null | undefined, b: number | null | undefined): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (x === null || y === null) return x === y;
  return Math.abs(x - y) < 1e-9;
}

function row(name: string): MeasurementRow {
  const found = saved.measurements.find((m) => m.name === name);
  if (found === undefined) throw new Error(`no measurement ${name}`);
  return found;
}

/** A line row's endpoint provenance (p1_depth / p2_depth). */
function endpoint(name: string, key: "p1_depth" | "p2_depth"): DepthOut {
  return row(name)[key] as DepthOut;
}

/** What the run measured, in the reporter's output (as real_run prints it). */
function note(text: string): void {
  console.log(`    ${text}`);
}

test.beforeAll(async () => {
  test.skip(!REAL, "set NAZEER_REAL=1 to run the real-model proof (bag 006 and best.pt)");
  test.skip(!existsSync(BAG_006), `needs bag 006 (${BAG_006})`);
  test.skip(!existsSync(MODEL), `needs the model (${MODEL})`);
  // "Save as" (D12): the Save dialog that opens after the seal saves into a folder named in Arabic
  saveDir = path.join(mkdtempSync(path.join(tmpdir(), "nazeer-e2e-real-save-")), "نسخ حقيقية");
  mkdirSync(saveDir);
  launched = await launchApp({
    stubModel: false,
    env: { NAZEER_E2E_SAVE_DIALOG: `folder:${saveDir}` },
  });
  page = launched.page;
  engine = new Engine((await waitForReady(page, { timeoutMs: 240_000 })).connection);
  page.on("response", (response: Response) => {
    void record(response);
  });
});

async function record(response: Response): Promise<void> {
  const request = response.request();
  if (sessionId === "" || !response.url().includes(`/sessions/${sessionId}/`)) return;
  if (request.method() === "POST" && response.url().includes("/depth")) {
    const body = request.postDataJSON() as { u: number; v: number; target: string };
    depthReplies.push({ body, reply: (await response.json()) as DepthOut });
  } else if (request.method() === "PUT" && response.url().includes("/document")) {
    const reply = (await response.json().catch(() => null)) as { revision?: number } | null;
    documentSaves.push({
      status: response.status(),
      revision: reply?.revision ?? null,
      ifMatch: (await request.allHeaders())["if-match"] ?? null,
    });
  }
}

test.afterAll(async () => {
  if (launched !== undefined) await launched.close();
  if (saveDir !== "") rmSync(path.dirname(saveDir), { recursive: true, force: true });
});

test("1. engine: healthy, the pinned real model, the Arabic stack with the pinned font", async () => {
  const health = await engine.json<Json>("/health");
  expect(health["status"]).toBe("ok");
  expect(health["model"]).toMatchObject({ stub: false, sha256: PINNED_MODEL_SHA });
  expect(health["arabic_stack"]).toMatchObject({ ok: true, font_pinned: true });
  expect(engine.conn).toMatchObject({ stubModel: false, arabicStackOk: true });
  const arabic = health["arabic_stack"] as Json;
  note(
    `${engine.conn.modelFile} ${PINNED_MODEL_SHA.slice(0, 16)}…, warm-up ${String(health["warmup_ms"])} ms, ` +
      `native layout ${String(arabic["native_layout"])}`,
  );
});

test("2. open bag 006 by its path; the colour stream is rgb8", async () => {
  await useLanguage(page, "en");
  await openBagByPath(page, t, BAG_006);
  await expect(page.getByRole("button", { name: t("bag.findFrames") })).toBeEnabled({
    timeout: 60_000,
  });
  const info = (await engine.call<Json>("POST", "/bags/inspect", { path: BAG_006 })).body;
  expect((info["color"] as Json)["format"]).toBe("format.rgb8");
});

test("3. the frame search reads the whole bag; every proposal passes the gates, 1.5 s apart", async () => {
  test.setTimeout(900_000);
  const { fingerprint, paramsHash } = await findFrames(page, t, 840_000);
  set = await engine.json<CandidateSet>(`/candidates/${fingerprint}/${paramsHash}`);
  const params = set.params;
  const walk = set.walk;
  expect(set.candidates.length).toBeGreaterThan(0);
  expect(walk["walk_complete"]).toBe(true);
  for (const c of set.candidates) {
    expect(c.z_mean).toBeGreaterThanOrEqual(1.0);
    expect(c.mask_area_frac).toBeGreaterThanOrEqual(Number(params["maf_low"]));
    expect(c.mask_area_frac).toBeLessThanOrEqual(Number(params["maf_high"]));
    expect(c.valid_frac).toBeGreaterThanOrEqual(Number(params["valid_frac_min"]));
  }
  const times = set.candidates.map((c) => c.read_index / Number(walk["fps"])).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i += 1) {
    expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(Number(params["bin_sec"]) - 1e-9);
  }
  expect(await page.getByRole("article").count()).toBe(set.candidates.length);
  const buckets: Record<string, number> = {};
  for (const c of set.candidates) {
    const bucket = String(c.bucket);
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
  }
  note(
    `${String(walk["n_pairs"])} pairs read, ${String(walk["n_sampled"])} sampled, ` +
      `${set.candidates.length} proposed ${JSON.stringify(buckets)}; ` +
      `rejected ${JSON.stringify(set.rejected_by_reason)}`,
  );
});

test("4. pick a frame: the session starts at revision 0 with Z_ref = the frame's mask median", async () => {
  const labelsOut =
    await engine.json<Record<string, Record<string, { en: string }>>>("/meta/labels");
  sessionId = await startSession(
    page,
    t,
    labelsOut["buckets"]?.["SIDE"]?.en ?? null,
    CAMEL_ID,
    "e2e",
  );
  const view = await engine.session(sessionId);
  expect(view).toMatchObject({ revision: 0, status: "open", camel_id: CAMEL_ID });
  const frame = view.frame as Json;
  const candidateId = (frame["candidate"] as Json)["candidate_id"];
  const candidate = set.candidates.find((c) => c.candidate_id === candidateId);
  expect(candidate, String(candidateId)).toBeDefined();
  const zRef = Number((frame["z_ref"] as Json)["z_ref_m"]);
  expect(Math.abs(zRef - (candidate?.z_median ?? Number.NaN))).toBeLessThan(1e-6);
  points = await framePoints(page, engine, view);
  note(
    `${sessionId}: ${String(candidateId)} (${String(candidate?.bucket)}), Z_ref ${zRef.toFixed(3)} m; ` +
      `clicks from the mask: inside ${JSON.stringify(points.centre)}, ` +
      `miss ${JSON.stringify(points.outside)}, ground ${JSON.stringify(points.ground)}`,
  );
});

test("5. hover: inside resolves directly, a miss snaps to the camel, a Shift ground point keeps its own depth", async () => {
  await chooseTool(page, t, "2"); // a 3D tool: Shift aims at the ground
  const hovered = async (point: Point, target: string): Promise<DepthOut> => {
    await expect
      .poll(() =>
        depthReplies.some(
          (d) =>
            d.body.target === target && Math.hypot(d.body.u - point[0], d.body.v - point[1]) <= 1.5,
        ),
      )
      .toBe(true);
    const match = depthReplies.findLast(
      (d) =>
        d.body.target === target && Math.hypot(d.body.u - point[0], d.body.v - point[1]) <= 1.5,
    );
    if (match === undefined) throw new Error("no hover reply");
    return match.reply;
  };
  await hoverAt(page, points.centre);
  const inside = await hovered(points.centre, "camel");
  expect(inside.inside_mask).toBe(true);
  expect(INSIDE_SOURCES).toContain(inside.source);
  await hoverAt(page, points.outside);
  const outside = await hovered(points.outside, "camel");
  expect(outside.inside_mask).toBe(false);
  expect(OUTSIDE_SOURCES).toContain(outside.source);
  await hoverAt(page, points.ground, { shift: true });
  const ground = await hovered(points.ground, "ground");
  expect(
    ground.source === "direct_off_mask" || ground.flags.includes("ground_target_unresolved"),
  ).toBe(true);
  await page.keyboard.press("Escape");
  note(
    `hover: inside ${inside.source} ${String(inside.depth_m)} m; miss ${outside.source} ` +
      `(${String(outside.nn_dist_m_max)} m to the camel); ground ${ground.source} ` +
      `${String(ground.depth_m)} m [${ground.flags.join(",")}]`,
  );
});

test("6. draw every kind through the UI; each autosave stores the next revision, no conflict", async () => {
  test.setTimeout(240_000);
  const p = points;
  await chooseTool(page, t, "1");
  await clickAt(page, p.top);
  await clickAt(page, [p.top[0], p.ground[1] - 6]);
  await nameIt(page, t, "ارتفاع الحارك");
  await chooseTool(page, t, "2");
  await clickAt(page, p.left);
  await clickAt(page, p.right);
  await nameIt(page, t, "Body length 3D");
  await chooseTool(page, t, "2");
  await clickAt(page, p.belly);
  await clickAt(page, p.ground, { shift: true });
  await nameIt(page, t, "Belly to ground 3D");
  await chooseTool(page, t, "2");
  await clickAt(page, p.outside);
  await clickAt(page, p.centre);
  await nameIt(page, t, "Missed click to body 3D");
  await chooseTool(page, t, "3");
  for (const q of p.back) await clickAt(page, q);
  await clickAt(page, p.back.at(-1)!);
  await nameIt(page, t, "خط الظهر 2D");
  await chooseTool(page, t, "4");
  for (const q of p.back.slice(0, -1)) await clickAt(page, q);
  await clickAt(page, p.back.at(-1)!, { double: true });
  await nameIt(page, t, "Back line 3D");
  await chooseTool(page, t, "5");
  await clickAt(page, p.centre);
  await clickAt(page, p.top);
  await clickAt(page, p.right);
  await nameIt(page, t, "Angle 2D");
  await chooseTool(page, t, "6");
  await clickAt(page, p.centre);
  await clickAt(page, p.left);
  await clickAt(page, p.right);
  await nameIt(page, t, "Angle 3D");
  await chooseTool(page, t, "7"); // the keyboard crosshair
  await page.mouse.move(5, 5);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 12; i += 1) await page.keyboard.press("Shift+ArrowRight");
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Enter");
  await nameIt(page, t, "Slope from horizontal");
  await chooseTool(page, t, "8");
  const picker = page.locator("section", { hasText: t("measure.lines.title") });
  await picker.getByRole("button", { name: /Body length 3D/ }).click();
  await picker.getByRole("button", { name: /Belly to ground 3D/ }).click();
  await nameIt(page, t, "Angle between lines");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitAllSaved(page, 10, 60_000);

  saved = await engine.session(sessionId);
  expect(new Set(saved.measurements.map((m) => m.input_kind)).size).toBe(8);
  // the saved depth sources, as placed
  for (const key of ["p1_depth", "p2_depth"] as const) {
    expect(INSIDE_SOURCES).toContain(endpoint("Body length 3D", key).source);
  }
  expect(INSIDE_SOURCES).toContain(endpoint("Belly to ground 3D", "p1_depth").source);
  expect(row("Belly to ground 3D").targets).toEqual(["camel", "ground"]);
  const groundPoint = endpoint("Belly to ground 3D", "p2_depth");
  expect(
    groundPoint.source === "direct_off_mask" ||
      groundPoint.flags.includes("ground_target_unresolved"),
  ).toBe(true);
  expect(OUTSIDE_SOURCES).toContain(endpoint("Missed click to body 3D", "p1_depth").source);
  expect(INSIDE_SOURCES).toContain(endpoint("Missed click to body 3D", "p2_depth").source);
  // autosave: every PUT answered 200 with the next revision, none lost or conflicting
  expect(documentSaves.length).toBeGreaterThan(0);
  documentSaves.forEach((save, i) => {
    expect(save.status).toBe(200);
    expect(save.revision).toBe(i + 1);
    // If-Match names the revision it builds on (the ETag "r<revision>-<hash>" of the last save)
    expect(save.ifMatch, `save ${i + 1}`).toMatch(new RegExp(`^"r${i}-[0-9a-f]+"$`));
  });
  expect(saved.revision).toBe(documentSaves.length);
  note(
    `${documentSaves.length} autosaves (each 200 with If-Match on the revision before, revisions ` +
      `1…${saved.revision}), no conflict`,
  );
  for (const m of saved.measurements) {
    const shown = m.presentation.rejected
      ? `rejected: ${String(m.rejection_reason)}`
      : m.presentation.value_text.en;
    const basis = m.presentation.depth_basis.map((b) => b.en).join("; ");
    note(`#${m.id} ${m.input_kind} "${m.name}": ${shown}  [${basis}]`);
  }
});

test("7. autosave edges the store relies on: a replay is a 200, a stale save a 409 with the current view", async () => {
  const stored = await engine.call<SessionView>("GET", `/sessions/${sessionId}`);
  const etag = stored.headers.get("etag");
  const document = {
    revision: stored.body.revision,
    next_measurement_id: stored.body.next_measurement_id,
    measurements: stored.body.measurements.map((m) => m.input),
  };
  const replay = await engine.call<SessionView>("PUT", `/sessions/${sessionId}/document`, document);
  expect(replay.status).toBe(200);
  expect(replay.body.revision).toBe(stored.body.revision);
  expect(replay.headers.get("etag")).toBe(etag);
  const stale = await engine.call<{ error: { code: string; details: { current: SessionView } } }>(
    "PUT",
    `/sessions/${sessionId}/document`,
    { ...document, measurements: document.measurements.slice(0, -1) },
  );
  expect(stale.status).toBe(409);
  expect(stale.body.error.code).toBe("stale_revision");
  expect(stale.body.error.details.current.revision).toBe(stored.body.revision);
});

test("8. previews equal the saved values; the 3D curve's 2D cross-check equals the 2D curve", async () => {
  let seq = 1000;
  for (const m of saved.measurements) {
    seq += 1;
    const preview = await engine.call<{ row: MeasurementRow }>(
      "POST",
      `/sessions/${sessionId}/preview`,
      { measurement: m.input, seq },
    );
    expect(preview.status, m.name).toBe(200);
    expect(same(preview.body.row.presentation.value, m.presentation.value), m.name).toBe(true);
  }
  const curve2d = row("خط الظهر 2D");
  const curve3d = row("Back line 3D");
  expect(curve3d.input.points).toEqual(curve2d.input.points);
  expect(same(curve3d["cross_check_2d_m"] as number | null, curve2d.presentation.value)).toBe(true);
});

test("9. finalize and approve in the UI: the overlay is W x (H + 120) and matches its hash", async () => {
  const src = await finalizeAndApprove(page, t);
  expect(src.startsWith("blob:")).toBe(true);
  const view = await engine.session(sessionId);
  expect(view.status).toBe("finalized");
  const overlay = need(view.outputs.overlay, "overlay");
  approvedOverlay = await engine.bytes(overlay.url);
  expect(sha256(approvedOverlay)).toBe(overlay.sha256);
  expect([overlay.width, overlay.height]).toEqual([points.width, points.height + 120]);
  const model = need(view.outputs.report_model, "report model");
  expect(sha256(await engine.bytes(model.url))).toBe(model.sha256);
  note(
    `overlay v${overlay.version} ${overlay.width} x ${overlay.height}, sha256 ` +
      `${overlay.sha256.slice(0, 16)}… = the bytes the app verified; report model v${model.version}`,
  );
});

test("10. report details, print and seal: probes PASS with every name, the pixels, the face, the files", async () => {
  test.setTimeout(300_000);
  await page.getByRole("textbox", { name: t("report.judge"), exact: true }).fill(NAMES.judge);
  await page.getByRole("textbox", { name: t("report.council"), exact: true }).fill(NAMES.council);
  await page.getByRole("textbox", { name: t("report.event"), exact: true }).fill(NAMES.event);
  await page.getByRole("radio", { name: t("report.languageBoth") }).click();
  await page.getByRole("button", { name: t("report.saveInputs") }).click();
  await expect(page.getByText(t("report.unsavedInputs"))).toHaveCount(0, { timeout: 15_000 });
  const before = await engine.session(sessionId);
  expect(before.report_inputs).toMatchObject({ language: "both", names: NAMES });
  const model = need(before.outputs.report_model, "report model");
  const printedModel = await engine.bytes(model.url);

  await printAndWaitSealed(page, t);
  const view = await engine.session(sessionId);
  expect(view.status).toBe("exported");
  const overlay = need(view.outputs.overlay, "overlay");
  const report = need(view.outputs.report, "report");
  expect(report).toMatchObject({
    overlay_version: overlay.version,
    report_model_version: model.version,
    stale: false,
  });
  const manifest = await engine.json<Json>(need(view.outputs.manifest_url, "manifest"));
  const probes = manifest["probes"] as Json;
  expect(probes).toMatchObject({ verdict: "PASS", require_text: true, require_font: true });
  expect(probes["hard_failures"]).toEqual([]);
  expect(((probes["pixel"] as Json)["match"] as Json)["max_abs_diff"]).toBe(0);
  const text = probes["text"] as { ok: boolean; names: { name: string; ok: boolean }[] };
  expect(text.ok).toBe(true);
  for (const required of view.required_report_texts) {
    expect(text.names.find((n) => n.name === required)?.ok, required).toBe(true);
  }
  expect(probes["fonts"]).toMatchObject({ ok: true, type3_present: false });
  expect(probes["attachments_ok"]).toBe(true);

  // the sealed PDF itself (content, never its bytes)
  const pdfBytes = await engine.bytes(report.url);
  expect(sha256(pdfBytes)).toBe(report.sha256);
  const pdf = await readPdf(pdfBytes);
  expect(pdf.pages.length).toBe(Number(probes["n_pages"]));
  for (const size of pdf.pages) {
    expect(Math.abs(size.width - A4_PT[0])).toBeLessThan(1);
    expect(Math.abs(size.height - A4_PT[1])).toBeLessThan(1);
  }
  expect(pdf.fonts.length).toBeGreaterThan(0);
  for (const font of pdf.fonts) {
    expect(font.name).toMatch(/IBMPlexSansArabic/); // no fallback face drew anything
    expect(font.type3).toBe(false);
  }
  expect(pdf.text).toContain(sessionId);
  const overlayFile = overlay.file;
  expect([...pdf.attachments.keys()].sort()).toEqual(
    [overlayFile, "report_model.json", "session.json"].sort(),
  );
  expect(sha256(pdf.attachments.get(overlayFile)!)).toBe(sha256(approvedOverlay));
  expect(sha256(pdf.attachments.get("report_model.json")!)).toBe(sha256(printedModel));
  const session = JSON.parse(new TextDecoder().decode(pdf.attachments.get("session.json"))) as Json;
  expect(session["schema_version"]).toBe("2.1");
  const stored = new Set(
    ["lines", "curves", "angles"].flatMap((key) =>
      ((session[key] as { name: string }[] | undefined) ?? []).map((m) => m.name),
    ),
  );
  for (const m of saved.measurements) expect(stored.has(m.name), m.name).toBe(true);

  // "Save as" (D12): once the viewer verified the sealed bytes, the Save dialog opened by itself;
  // the copy main wrote under the default name is the sealed report, byte for byte
  const copy = path.join(
    saveDir,
    sessionReportFileName({
      camelId: view.camel_id,
      sessionId,
      createdAt: view.created_at,
      version: report.version,
    }),
  );
  await expect.poll(() => existsSync(copy), { timeout: 60_000 }).toBe(true);
  await expect(page.getByTestId("saved-copy")).toContainText(t("report.savedTo"));
  expect(sha256(new Uint8Array(readFileSync(copy)))).toBe(report.sha256);
  note(
    `saved a copy: ${path.basename(copy)} (${readFileSync(copy).byteLength} bytes, same SHA-256)`,
  );
  note(
    `report v${report.version} (overlay v${report.overlay_version}, model v${model.version}): ` +
      `verdict PASS, ${pdf.pages.length} A4 pages, fonts ${pdf.fonts.map((f) => f.name).join(", ")}, ` +
      `${view.required_report_texts.length} required texts found, pixel |diff| 0; attachments ` +
      `${[...pdf.attachments.keys()].join(", ")} (overlay and model byte-identical; session.json ` +
      `2.1 with ${stored.size} measurements)`,
  );
});

test("11. History: searching the Arabic camel ID finds the session, exported", async () => {
  const listed = await engine.json<{ items: { session_id: string; status: string }[] }>(
    `/sessions?q=${encodeURIComponent(CAMEL_ID)}`,
  );
  expect(listed.items.find((r) => r.session_id === sessionId)?.status).toBe("exported");
  const statuses =
    await engine.json<Record<string, Record<string, { en: string }>>>("/meta/labels");
  await page.evaluate(() => {
    location.hash = "#/history";
  });
  await page.getByRole("searchbox").fill(CAMEL_ID);
  const rowInUi = page.locator(`tr[data-session="${sessionId}"]`);
  await expect(rowInUi).toContainText(statuses["statuses"]?.["exported"]?.en ?? "exported", {
    timeout: 15_000,
  });
  expect(launched?.consoleErrors).toEqual([]);
});
