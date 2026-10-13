/**
 * The operator flow through the built app's UI, the way an operator drives it: labels looked up by
 * i18n key (helpers/labels.ts), the open-file dialog stubbed in main, the measuring canvas clicked
 * in image space through its SVG's screen matrix. Checks talk to the engine directly with the app's
 * own connection (port + token) from the test process.
 */
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import type { components } from "@shared/api";
import type { EngineConnection } from "@shared/ipc";

type Schemas = components["schemas"];
export type SessionView = Schemas["SessionView"];
export type MeasurementRow = Schemas["MeasurementRow"];
export type CandidateSet = Schemas["CandidateSet"];
export type DepthOut = Schemas["DepthOut"];
export type Json = Record<string, unknown>;
export type Point = [number, number];

/** A value the flow must have produced by now (an output, a URL): fail loudly when it is absent. */
export function need<V>(value: V | null | undefined, what: string): V {
  if (value === null || value === undefined) throw new Error(`missing: ${what}`);
  return value;
}
type T = (key: string) => string;

/** The engine, called from the test process with the app's connection. */
export class Engine {
  constructor(readonly conn: EngineConnection) {}

  url(route: string): string {
    return new URL(route, this.conn.baseUrl).toString();
  }

  async call<R = Json>(
    method: string,
    route: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: R; headers: Headers }> {
    const response = await fetch(this.url(route), {
      method,
      headers: {
        "X-Nazeer-Token": this.conn.token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as R,
      headers: response.headers,
    };
  }

  async json<R = Json>(route: string): Promise<R> {
    const { status, body } = await this.call<R>("GET", route);
    if (status !== 200) throw new Error(`GET ${route}: ${status} ${JSON.stringify(body)}`);
    return body;
  }

  async bytes(route: string): Promise<Uint8Array> {
    const response = await fetch(this.url(route), {
      headers: { "X-Nazeer-Token": this.conn.token },
    });
    if (!response.ok) throw new Error(`GET ${route}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  session(id: string): Promise<SessionView> {
    return this.json<SessionView>(`/sessions/${id}`);
  }
}

/** Switch the UI language (a UI preference kept in localStorage) and reload. */
export async function useLanguage(page: Page, lang: "ar" | "en"): Promise<void> {
  await page.evaluate((language) => {
    localStorage.setItem(
      "nazeer.ui.v1",
      JSON.stringify({ lang: language, theme: "light", bilingual: false }),
    );
  }, lang);
  await page.reload({ waitUntil: "load" });
}

/** Open a recording through "Choose a .bag file…", with the OS dialog answered in main. */
export async function openBagWithDialog(
  app: ElectronApplication,
  page: Page,
  t: T,
  bag: string,
): Promise<void> {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
  }, bag);
  await page.getByRole("button", { name: t("bag.browse") }).click();
}

/** Open a recording by pasting its path. */
export async function openBagByPath(page: Page, t: T, bag: string): Promise<void> {
  const field = page.getByRole("textbox", { name: t("bag.pastePath") });
  await field.fill(bag);
  await field.press("Enter");
}

/** "Find the best frames" → the job screen → the proposed frames. Returns {fingerprint, paramsHash}. */
export async function findFrames(
  page: Page,
  t: T,
  timeoutMs: number,
): Promise<{ fingerprint: string; paramsHash: string }> {
  const find = page.getByRole("button", { name: t("bag.findFrames") });
  await expect(find).toBeEnabled({ timeout: 60_000 });
  await find.click();
  await page.waitForURL(/#\/candidates\/[0-9a-f]+\/[0-9a-f]+$/, { timeout: timeoutMs });
  const [, fingerprint = "", paramsHash = ""] =
    /#\/candidates\/([0-9a-f]+)\/([0-9a-f]+)$/.exec(page.url()) ?? [];
  await page.getByRole("article").first().waitFor({ timeout: 30_000 });
  return { fingerprint, paramsHash };
}

/** "Use this frame" on a tile, the session dialog, "Start measuring". Returns the session id. */
export async function startSession(
  page: Page,
  t: T,
  tileText: string | null,
  camelId: string,
  operator: string,
): Promise<string> {
  const tiles = page.getByRole("article");
  let tile = tileText === null ? tiles.first() : tiles.filter({ hasText: tileText }).first();
  if ((await tile.count()) === 0) tile = tiles.first();
  await tile.getByRole("button", { name: t("candidate.pick") }).click();
  const dialog = page.getByRole("dialog", { name: t("session.startTitle") });
  await dialog.getByRole("textbox", { name: t("session.camelId") }).fill(camelId);
  await dialog.getByRole("textbox", { name: t("session.operator") }).fill(operator);
  await dialog.getByRole("button", { name: t("session.start") }).click();
  await page.waitForURL(/#\/sessions\/\d{8}_\d{6}_[0-9a-f]{6}$/, { timeout: 30_000 });
  await page.getByRole("application", { name: t("measure.canvasLabel") }).waitFor();
  return page.url().split("/").pop() ?? "";
}

/** Screen position of an image pixel on the measuring canvas (the SVG's CTM). */
export async function screenPoint(page: Page, [u, v]: Point): Promise<Point> {
  return page.evaluate(
    ([x, y]) => {
      const svg = document.querySelector('[role="application"] svg');
      if (!(svg instanceof SVGSVGElement)) throw new Error("no measuring canvas");
      const matrix = svg.getScreenCTM();
      if (matrix === null) throw new Error("the canvas has no screen matrix");
      const p = new DOMPoint(x, y).matrixTransform(matrix);
      return [p.x, p.y] as Point;
    },
    [u, v] as Point,
  );
}

export async function hoverAt(page: Page, point: Point, { shift = false } = {}): Promise<void> {
  const [x, y] = await screenPoint(page, point);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(x, y, { steps: 4 });
  if (shift) await page.keyboard.up("Shift");
}

export async function clickAt(
  page: Page,
  point: Point,
  { shift = false, double = false } = {},
): Promise<void> {
  const [x, y] = await screenPoint(page, point);
  await page.mouse.move(x, y, { steps: 3 });
  if (shift) await page.keyboard.down("Shift");
  if (double) await page.mouse.dblclick(x, y);
  else await page.mouse.click(x, y);
  if (shift) await page.keyboard.up("Shift");
  await page.waitForTimeout(120);
}

/** Choose a tool with its number key on the focused canvas. */
export async function chooseTool(page: Page, t: T, key: string): Promise<void> {
  await page.getByRole("application", { name: t("measure.canvasLabel") }).focus();
  await page.keyboard.press(key);
}

/** Name the measurement just drawn: it enters the session only once named. */
export async function nameIt(page: Page, t: T, name: string): Promise<void> {
  const field = page.getByRole("textbox", { name: t("measure.name") });
  await field.waitFor({ state: "visible", timeout: 5000 });
  await field.fill(name);
  await field.press("Enter");
  await page.waitForTimeout(250);
}

/** Until the list shows `n` rows, all saved, and the save badge is clean. */
export async function waitAllSaved(page: Page, n: number, timeoutMs = 30_000): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const rows = [...document.querySelectorAll("li[data-row]")];
          const badge = document
            .querySelector('span[role="status"][data-state]')
            ?.getAttribute("data-state");
          return {
            rows: rows.length,
            saved: rows.filter((li) => li.getAttribute("data-status") === "saved").length,
            badge,
          };
        }),
      { timeout: timeoutMs },
    )
    .toEqual({ rows: n, saved: n, badge: "clean" });
}

/** Finalize on the Finalize screen, check the WebCrypto fingerprint, approve, go to the report. */
export async function finalizeAndApprove(page: Page, t: T): Promise<string> {
  await page.getByRole("link", { name: t("session.finalize") }).click();
  await page.getByRole("button", { name: t("finalize.run") }).click();
  const image = page.getByRole("img", { name: t("approval.imageAlt") });
  await image.waitFor({ timeout: 120_000 });
  await expect(page.getByText(t("approval.verified")).first()).toBeVisible({ timeout: 60_000 });
  const src = (await image.getAttribute("src")) ?? "";
  await page.getByRole("button", { name: t("approval.approve") }).click();
  await expect(page.getByText(t("approval.approved")).first()).toBeVisible();
  await page.getByRole("link", { name: t("finalize.toReport") }).click();
  await page.waitForURL(/\/report$/);
  return src;
}

/** Print from the Report screen and wait for the engine's seal and the viewer's fingerprint. */
export async function printAndWaitSealed(page: Page, t: T, again = false): Promise<void> {
  const button = page.getByRole("button", {
    name: t(again ? "report.printAgain" : "report.print"),
  });
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await button.click();
  await expect(page.getByText(t("report.sealed")).first()).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(t("pdf.verified")).first()).toBeVisible({ timeout: 60_000 });
}

export interface FramePoints {
  width: number;
  height: number;
  /** inside the mask, at least 6 px from its edge (the engine erodes 2 px) */
  left: Point;
  right: Point;
  top: Point;
  belly: Point;
  centre: Point;
  /** along the top of the body, left to right, inside */
  back: Point[];
  /** 8–25 px above the silhouette: a click that missed the camel */
  outside: Point;
  /** just below the drawn ground line, off the camel */
  ground: Point;
}

/** Click positions from the session's own mask (decoded in the renderer: canvas, no deps). */
export async function framePoints(
  page: Page,
  engine: Engine,
  view: SessionView,
): Promise<FramePoints> {
  const frame = view.frame as Json;
  const assets = frame["assets"] as Record<string, string>;
  const ground = frame["ground"] as Json;
  const maskUrl = engine.url(assets["mask"] ?? "");
  const groundRow = Number(ground["drawn_row"]);
  return page.evaluate(
    async ({ url, token, groundRow }) => {
      const response = await fetch(url, {
        headers: { "X-Nazeer-Token": token },
        cache: "no-store",
      });
      const bitmap = await createImageBitmap(await response.blob(), {
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
      });
      const W = bitmap.width;
      const H = bitmap.height;
      const canvas = new OffscreenCanvas(W, H);
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("no 2D context");
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, W, H).data;
      const on = (u: number, v: number): boolean =>
        u >= 0 && v >= 0 && u < W && v < H && (data[(v * W + u) * 4] ?? 0) > 127;
      const inset = (u: number, v: number, r: number): boolean => {
        for (let dv = -r; dv <= r; dv += 1)
          for (let du = -r; du <= r; du += 1) if (!on(u + du, v + dv)) return false;
        return true;
      };
      const inner: [number, number][] = [];
      for (let v = 10; v < H - 10; v += 10)
        for (let u = 10; u < W - 10; u += 10) if (inset(u, v, 6)) inner.push([u, v]);
      if (inner.length < 40) throw new Error(`only ${inner.length} inside points`);
      const xs = inner.map((p) => p[0]);
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);
      const span = xMax - xMin;
      const midY = inner.map((p) => p[1]).sort((a, b) => a - b)[Math.floor(inner.length / 2)] ?? 0;
      const near = (x: number, y: number): [number, number] =>
        inner.reduce((a, b) =>
          Math.hypot(b[0] - x, b[1] - y) < Math.hypot(a[0] - x, a[1] - y) ? b : a,
        );
      const column = (x: number) => inner.filter((p) => Math.abs(p[0] - x) <= 5);
      const colTop = (x: number) =>
        column(x).reduce<[number, number] | null>(
          (a, b) => (a === null || b[1] < a[1] ? b : a),
          null,
        );
      const colBottom = (x: number) =>
        column(x).reduce<[number, number] | null>(
          (a, b) => (a === null || b[1] > a[1] ? b : a),
          null,
        );
      const xc = Math.round(xMin + 0.5 * span);
      const back = [0.25, 0.4, 0.55, 0.7]
        .map((f) => colTop(Math.round((xMin + f * span) / 10) * 10))
        .filter((p): p is [number, number] => p !== null);
      // a click that missed the camel: the first column (from the middle out) where the point 15 px
      // above the silhouette has no mask pixel within 8 px
      let outside: [number, number] | null = null;
      for (let step = 0; step < 40 && outside === null; step += 1) {
        const u = xc + (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * 10;
        let top = -1;
        for (let v = 0; v < H; v += 1)
          if (on(u, v)) {
            top = v;
            break;
          }
        if (top < 30) continue;
        const v = top - 15;
        let clear = true;
        for (let dv = -8; dv <= 8 && clear; dv += 1)
          for (let du = -8; du <= 8; du += 1)
            if (on(u + du, v + dv)) {
              clear = false;
              break;
            }
        if (clear) outside = [u, v];
      }
      if (outside === null) throw new Error("no clear point above the camel");
      return {
        width: W,
        height: H,
        left: near(xMin + 0.12 * span, midY),
        right: near(xMax - 0.12 * span, midY),
        top: colTop(xc) ?? near(xc, midY),
        belly: colBottom(xc) ?? near(xc, midY),
        centre: near(xc, midY),
        back,
        outside,
        ground: [xc, Math.min(H - 3, groundRow + 6)] as [number, number],
      };
    },
    { url: maskUrl, token: engine.conn.token, groundRow },
  );
}
