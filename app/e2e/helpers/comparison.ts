/**
 * The comparison flow (D12 F2) through the built app's UI, shared by the fast spec (stub ellipse,
 * bag 004) and the real one (NAZEER_REAL=1, bag 006 + best.pt). The setup talks to the engine the
 * way the app does (a candidate walk, two sessions on two proposed frames, named measurements,
 * finalize); everything the operator does for the comparison goes through the UI: tick the camels
 * in History, order them in the Compare dialog, fill the cover, approve each image on the engine's
 * full image, create, print and seal, the "Save as" copy (the dialog answered by the test switch),
 * the Comparisons tab, then a member reopened from History turns the comparison out of date. Checks
 * read the engine's own records, and the sealed PDF's content with the app's pdf.js.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type { components } from "@shared/api";
import { comparisonReportFileName } from "../../src/shared/fileNames";
import {
  framePoints,
  type Engine,
  need,
  type CandidateSet,
  type FramePoints,
  type Json,
  type SessionView,
} from "./flow";
import { readPdf, sha256 } from "./pdf";

type Schemas = components["schemas"];
export type ComparisonView = Schemas["ComparisonView"];
type MeasurementInput = Schemas["MeasurementInputModel"];
type T = (key: string) => string;

const A4_PT = [595.28, 841.89] as const;

/** One camel of the comparison: its camel id and measurements. */
export interface CamelPlan {
  camelId: string;
  measurements: (p: FramePoints) => Omit<MeasurementInput, "id">[];
}

const line = (
  kind: "distance_2d" | "distance_3d",
  name: string,
  points: [number, number][],
): Omit<MeasurementInput, "id"> => ({ kind, name, points, note: "" });

/**
 * Two camels whose measurements exercise the engine's matching: a name both share (3D), a name one
 * camel measured twice ("(1/2)", "(2/2)"), a name only one camel has (a "—" cell for the other), and
 * one name in two kinds (2D and 3D never share a row).
 */
export const CAMELS: [CamelPlan, CamelPlan] = [
  {
    camelId: "ناقة-مقارنة-أ",
    measurements: (p) => [
      line("distance_3d", "طول الجسم", [p.left, p.right]),
      line("distance_2d", "عرض الصدر", [p.left, p.centre]),
      line("distance_2d", "عرض الصدر", [p.centre, p.right]),
      { kind: "curve_3d", name: "خط الظهر", points: p.back, note: "" },
    ],
  },
  {
    camelId: "ناقة-مقارنة-ب",
    measurements: (p) => [
      line("distance_3d", "طول الجسم", [p.left, p.right]),
      line("distance_2d", "عرض الصدر", [p.left, p.centre]),
      line("distance_2d", "Neck width", [p.top, p.centre]),
      line("distance_2d", "طول الجسم", [p.left, p.right]),
    ],
  },
];

/** Walk a bag with the engine's candidate job (or take its cached result): the proposed frames. */
export async function walkBag(
  engine: Engine,
  bag: string,
  timeoutMs: number,
): Promise<CandidateSet> {
  const start = await engine.call<Json>("POST", "/candidates/jobs", { bag_path: bag });
  expect([200, 202], JSON.stringify(start.body)).toContain(start.status);
  let result = start.body["cached"] === true ? (start.body["result"] as Json) : null;
  if (result === null) {
    const job = need(start.body["job"] as Json | undefined, "candidate job");
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const snap = await engine.json<Json>(`/candidates/jobs/${String(job["job_id"])}`);
      if (snap["terminal"] === true) {
        expect(snap["state"], JSON.stringify(snap["error"])).toBe("done");
        result = snap["result"] as Json;
        break;
      }
      if (Date.now() > deadline) throw new Error(`the candidate job ran over ${timeoutMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return engine.json<CandidateSet>(
    `/candidates/${String(result["fingerprint"])}/${String(result["params_hash"])}`,
  );
}

/**
 * One finalized session per camel, each on its own proposed frame: side views first (the whole body
 * in view), measured at positions read from the frame's own mask, saved as revision 1, finalized. A
 * frame whose mask gives no clear click positions (a camel touching the top edge has no point above
 * it) is skipped and its session deleted.
 */
export async function finalizedSessions(
  page: Page,
  engine: Engine,
  set: CandidateSet,
  plans: readonly [CamelPlan, CamelPlan],
): Promise<[SessionView, SessionView]> {
  const frames = [
    ...set.candidates.filter((c) => c.bucket === "SIDE"),
    ...set.candidates.filter((c) => c.bucket !== "SIDE"),
  ];
  const made: SessionView[] = [];
  for (const plan of plans) {
    for (;;) {
      const candidate = need(frames.shift(), `a proposed frame for ${plan.camelId}`);
      const created = await engine.call<SessionView>("POST", "/sessions", {
        candidate: candidate.ref,
        camel_id: plan.camelId,
        operator: "e2e",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.session_id;
      const points = await framePoints(page, engine, created.body).catch(() => null);
      if (points === null) {
        expect((await engine.call("DELETE", `/sessions/${id}`)).status).toBe(200);
        continue;
      }
      const measurements = plan.measurements(points).map((m, i) => ({ id: i + 1, ...m }));
      const saved = await engine.call<SessionView>("PUT", `/sessions/${id}/document`, {
        revision: 1,
        next_measurement_id: measurements.length + 1,
        measurements,
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const finalized = await engine.call<SessionView>("POST", `/sessions/${id}/finalize`, {
        revision: 1,
      });
      expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
      expect(finalized.body.status).toBe("finalized");
      made.push(finalized.body);
      break;
    }
  }
  const [first, second] = made;
  return [need(first, "first session"), need(second, "second session")];
}

export interface Cover {
  title: string;
  event: string;
  judge: string;
  council: string;
}

/**
 * History → tick both camels (in session order) → Compare → move the second camel up (the print
 * order is the operator's, here the reverse of the ticking order) → cover and language → approve
 * each image on the engine's full image → Create. Returns the new comparison's id.
 */
export async function createThroughUi(
  page: Page,
  t: T,
  sessions: [SessionView, SessionView],
  cover: Cover,
  language: "ar" | "en" | "both",
): Promise<string> {
  const [first, second] = sessions;
  await page.evaluate(() => {
    location.hash = "#/history";
  });
  for (const session of sessions) {
    const box = page.locator(`tr[data-session="${session.session_id}"]`).getByRole("checkbox");
    await expect(box).toBeEnabled({ timeout: 30_000 });
    await box.click();
    await expect(box).toBeChecked();
  }
  const bar = page.getByTestId("compare-bar");
  await bar.getByRole("button", { name: t("compare.open") }).click();

  const dialog = page.getByTestId("compare-dialog");
  const order = () =>
    dialog
      .locator("li[data-session]")
      .evaluateAll((items) => items.map((li) => li.dataset["session"]));
  await expect.poll(order).toEqual([first.session_id, second.session_id]);
  await dialog
    .locator(`li[data-session="${second.session_id}"]`)
    .getByRole("button", { name: t("compare.moveUp") })
    .click();
  await expect.poll(order).toEqual([second.session_id, first.session_id]);

  const form = page.getByRole("dialog", { name: t("compare.title") });
  await form.getByRole("textbox", { name: t("compare.coverTitle"), exact: true }).fill(cover.title);
  await form.getByRole("textbox", { name: t("report.event"), exact: true }).fill(cover.event);
  await form.getByRole("textbox", { name: t("report.judge"), exact: true }).fill(cover.judge);
  await form.getByRole("textbox", { name: t("report.council"), exact: true }).fill(cover.council);
  const radio = { ar: "report.languageAr", en: "report.languageEn", both: "report.languageBoth" };
  await form.getByRole("radio", { name: t(radio[language]) }).click();

  // neither camel has a report sealed from its image: each is approved here (D12 Q1)
  const create = form.getByRole("button", { name: t("compare.create") });
  await expect(create).toBeDisabled();
  for (const session of [second, first]) {
    const item = dialog.locator(`li[data-session="${session.session_id}"]`);
    await item.getByRole("button", { name: t("compare.approveImage") }).click();
    const approval = page.getByTestId("member-approval");
    await expect(approval).toHaveAttribute("data-session", session.session_id);
    await expect(approval.getByText(t("approval.verified")).first()).toBeVisible({
      timeout: 60_000,
    });
    await approval.getByRole("button", { name: t("approval.approve") }).click();
    await expect(approval).toHaveCount(0);
    await expect(item.getByText(t("approval.approved"))).toBeVisible();
  }
  await expect(create).toBeEnabled();
  await create.click();
  await page.waitForURL(/#\/comparisons\/\d{8}_\d{6}_[0-9a-f]{6}$/, { timeout: 30_000 });
  return page.url().split("/").pop() ?? "";
}

/** Print the comparison from its screen; wait for the seal and the viewer's fingerprint. */
export async function printAndSeal(page: Page, t: T): Promise<void> {
  const card = page.getByTestId("comparison-print");
  const print = card.getByRole("button", { name: t("comparison.print") });
  await expect(print).toBeEnabled({ timeout: 60_000 });
  await print.click();
  await expect(card.getByText(t("comparison.sealed"))).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId("comparison-pdf").getByText(t("pdf.verified")).first()).toBeVisible(
    { timeout: 120_000 },
  );
}

/**
 * The sealed comparison as the engine recorded it: PASS, each camel's image once, in the operator's
 * order, on pages that follow each other; the comparison data's rows matched as the plan expects.
 */
export async function checkSealed(
  engine: Engine,
  id: string,
  order: [SessionView, SessionView],
): Promise<ComparisonView> {
  const view = await engine.json<ComparisonView>(`/comparisons/${id}`);
  expect(view).toMatchObject({ status: "sealed", stale: false, report_stale: false });
  expect(view.members.map((m) => m.session_id)).toEqual(order.map((s) => s.session_id));
  const report = need(view.outputs.report, "sealed report");
  expect(report).toMatchObject({ version: 1, stale: false });
  const manifest = await engine.json<Json>(need(view.outputs.manifest_url, "manifest"));
  const probes = manifest["probes"] as Json;
  expect(probes["verdict"]).toBe("PASS");
  expect(probes["hard_failures"]).toEqual([]);
  expect(probes["fonts"]).toMatchObject({ ok: true, type3_present: false });
  expect(probes["attachments_ok"]).toBe(true);
  const members = manifest["members"] as Json[];
  const pages = members.map((m) => Number((m["overlay"] as Json)["page"]));
  expect(members.map((m) => m["session_id"])).toEqual(order.map((s) => s.session_id));
  expect(pages[0]).toBeLessThan(pages[1]!);
  for (const member of members) expect((member["overlay"] as Json)["max_abs_diff"]).toBe(0);

  // the rows the engine matched: names exact, kind apart, duplicates paired by order, "—" kept
  const model = await engine.json<{
    members: { session_id: string }[];
    rows: {
      name: string;
      kind: string;
      occurrence: number;
      n_occurrences: number;
      cells: unknown[];
    }[];
  }>(view.outputs.model.url);
  expect(model.members.map((m) => m.session_id)).toEqual(order.map((s) => s.session_id));
  const cells = (name: string, kind: string, occurrence = 1) => {
    const row = model.rows.find(
      (r) => r.name === name && r.kind === kind && r.occurrence === occurrence,
    );
    return need(row, `row ${name} ${kind} ${occurrence}`).cells.map((c) => c !== null);
  };
  // the print order is [camel B, camel A]
  expect(cells("طول الجسم", "distance_3d")).toEqual([true, true]);
  expect(cells("طول الجسم", "distance_2d")).toEqual([true, false]);
  expect(cells("عرض الصدر", "distance_2d", 1)).toEqual([true, true]);
  expect(cells("عرض الصدر", "distance_2d", 2)).toEqual([false, true]);
  expect(cells("Neck width", "distance_2d")).toEqual([true, false]);
  expect(cells("خط الظهر", "curve_3d")).toEqual([false, true]);
  return view;
}

/** The copy "Save as" wrote (the dialog answered by the test switch): the sealed report, exactly. */
export async function checkSavedCopy(
  page: Page,
  t: T,
  view: ComparisonView,
  saveDir: string,
  lang: "ar" | "en",
): Promise<Uint8Array> {
  const report = need(view.outputs.report, "sealed report");
  const name = comparisonReportFileName({
    members: view.n_members,
    createdAt: view.created_at,
    version: report.version,
    lang,
  });
  const copy = path.join(saveDir, name);
  await expect.poll(() => existsSync(copy), { timeout: 60_000 }).toBe(true);
  await expect(page.getByTestId("comparison-pdf").getByTestId("saved-copy")).toContainText(
    t("report.savedTo"),
  );
  const bytes = new Uint8Array(readFileSync(copy));
  expect(sha256(bytes)).toBe(report.sha256);
  expect(readdirSync(saveDir)).toEqual([name]); // the temp file was renamed over it
  return bytes;
}

/**
 * The saved PDF's content read back with pdf.js: A4 pages (as many as the probe counted), only the
 * Plex face and no Type3 glyphs, the ids in the text layer, and the attachments byte-identical to
 * each camel's approved image and to the comparison data that was printed.
 */
export async function checkPdfContent(
  engine: Engine,
  view: ComparisonView,
  bytes: Uint8Array,
): Promise<{ pages: number; attachments: string[] }> {
  const manifest = await engine.json<Json>(need(view.outputs.manifest_url, "manifest"));
  const pdf = await readPdf(bytes);
  expect(pdf.pages.length).toBe(Number((manifest["probes"] as Json)["n_pages"]));
  for (const size of pdf.pages) {
    expect(Math.abs(size.width - A4_PT[0])).toBeLessThan(1);
    expect(Math.abs(size.height - A4_PT[1])).toBeLessThan(1);
  }
  expect(pdf.fonts.length).toBeGreaterThan(0);
  for (const font of pdf.fonts) {
    expect(font.name).toMatch(/IBMPlexSansArabic/);
    expect(font.type3).toBe(false);
  }
  expect(pdf.text).toContain(view.comparison_id);
  for (const member of view.members) expect(pdf.text).toContain(member.session_id);

  const model = view.outputs.model;
  const expected = new Map<string, string>([[model.file, model.sha256]]);
  for (const member of view.members) {
    const prefix = `m${String(member.position).padStart(2, "0")}_${member.session_id}_`;
    const overlay = await engine.bytes(member.overlay.url);
    expect(sha256(overlay)).toBe(member.overlay.sha256);
    expected.set(`${prefix}${member.overlay.file}`, member.overlay.sha256);
    expected.set(`${prefix}session.json`, "");
    expected.set(`${prefix}${member.report_model.file}`, member.report_model.sha256);
  }
  expect([...pdf.attachments.keys()].sort()).toEqual([...expected.keys()].sort());
  for (const [name, hash] of expected) {
    if (hash !== "") expect(sha256(need(pdf.attachments.get(name), name)), name).toBe(hash);
  }
  return { pages: pdf.pages.length, attachments: [...pdf.attachments.keys()] };
}

/** Labels of one group from the engine (`/meta/labels`), in one language. */
export async function engineLabel(
  engine: Engine,
  group: string,
  code: string,
  lang: "ar" | "en",
): Promise<string> {
  const labels =
    await engine.json<Record<string, Record<string, { ar: string; en: string }>>>("/meta/labels");
  return need(labels[group]?.[code]?.[lang], `${group}.${code}`);
}

/**
 * Reopen a member from its History row (it becomes editable again), then: the engine calls the
 * comparison out of date naming that camel's reason; its screen shows the reason, refuses a new
 * print and marks the sealed PDF; the Comparisons tab marks the row; History no longer lets that
 * camel be ticked.
 */
export async function reopenMakesStale(
  page: Page,
  t: T,
  engine: Engine,
  id: string,
  member: SessionView,
  lang: "ar" | "en",
): Promise<void> {
  await page.evaluate(() => {
    location.hash = "#/history";
  });
  const row = page.locator(`tr[data-session="${member.session_id}"]`);
  await row.getByRole("button", { name: t("history.reopen") }).click();
  await page.waitForURL(new RegExp(`#/sessions/${member.session_id}$`), { timeout: 30_000 });

  const view = await engine.json<ComparisonView>(`/comparisons/${id}`);
  expect(view.stale).toBe(true);
  const changed = view.members.find((m) => m.session_id === member.session_id);
  expect(changed?.stale_reasons).toEqual(["member_reopened"]);
  expect(view.members.filter((m) => m.stale_reasons.length > 0)).toHaveLength(1);
  // a member changed: the comparison is out of date; the sealed PDF still shows its cover and
  // language (report_stale says only that), and the screen marks it from the comparison's state
  expect(view.report_stale).toBe(false);
  expect(need(view.outputs.report, "sealed report").stale).toBe(false);

  const reason = await engineLabel(engine, "comparison_stale", "member_reopened", lang);
  await page.evaluate((cid) => {
    location.hash = `#/comparisons/${cid}`;
  }, id);
  const memberRow = page.locator(`tr[data-session="${member.session_id}"][data-stale]`);
  await expect(memberRow).toContainText(reason, { timeout: 30_000 });
  await expect(page.getByTestId("print-blocked")).toContainText(t("comparison.printStale"));
  await expect(
    page.getByTestId("comparison-print").getByRole("button", { name: t("report.printAgain") }),
  ).toBeDisabled();
  await expect(page.getByTestId("comparison-pdf")).toContainText(t("comparison.pdfStale"));

  await page.evaluate(() => {
    location.hash = "#/history?tab=comparisons";
  });
  const listed = page.locator(`tr[data-comparison="${id}"]`);
  await expect(listed).toContainText(t("comparisons.stale"), { timeout: 30_000 });
  await expect(listed).toContainText(reason);

  await page.evaluate(() => {
    location.hash = "#/history";
  });
  await expect(
    page.locator(`tr[data-session="${member.session_id}"]`).getByRole("checkbox"),
  ).toBeDisabled({ timeout: 30_000 });
}
