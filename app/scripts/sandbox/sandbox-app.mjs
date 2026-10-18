// Runs INSIDE Windows Sandbox (scripts/sandbox-check.mjs maps it in; sandbox-run.ps1 starts it with
// the host's node.exe): drives the installed app over the Chrome DevTools Protocol, like
// packaged-smoke.mjs does on the build laptop, for the D11 clean-PC checklist (items 3-7, and the
// bag and print flow on a clean Windows). Keys come from keys.json (issued on the host with the
// vendor key; the sandbox never sees the private key).
//
//   node sandbox-app.mjs --exe <installed exe> --keys <keys.json> --out <dir> --label <name>
//                        --pw <playwright-core folder> [--bag <bag>] [--expect-licensed]
//
// Writes <out>\app-<label>.json (one entry per check) and screenshots <out>\shots\<label>-*.png.
/* global document, location, window -- used inside page.evaluate callbacks (renderer) */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cancelOsDialogs } from "./os-dialogs.mjs";

function parseArgs(argv) {
  const out = { bag: null, expectLicensed: false, port: 9555 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === "--exe") out.exe = value();
    else if (arg === "--keys") out.keys = value();
    else if (arg === "--out") out.out = value();
    else if (arg === "--label") out.label = value();
    else if (arg === "--pw") out.pw = value();
    else if (arg === "--bag") out.bag = value();
    else if (arg === "--port") out.port = Number(value());
    else if (arg === "--expect-licensed") out.expectLicensed = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  for (const key of ["exe", "keys", "out", "label", "pw"]) {
    if (out[key] === undefined) throw new Error(`--${key} is required`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const { chromium } = createRequire(import.meta.url)(args.pw);
const keys = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(args.keys, "utf8")));
const shots = path.join(args.out, "shots");
mkdirSync(shots, { recursive: true });
const results = [];
const started = Date.now();

function check(item, name, ok, detail = "") {
  results.push({ item, name, ok: Boolean(ok), detail: String(detail) });
  process.stdout.write(
    `${ok ? "PASS" : "FAIL"}  [${item}] ${name}${detail ? `: ${detail}` : ""}\n`,
  );
  return Boolean(ok);
}

function save() {
  const file = path.join(args.out, `app-${args.label}.json`);
  writeFileSync(
    file,
    JSON.stringify({ label: args.label, seconds: (Date.now() - started) / 1000, results }, null, 2),
  );
}

async function waitFor(probe, what, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(shots, `${args.label}-${name}.png`), fullPage: true });
};

async function launch() {
  const child = spawn(args.exe, [`--remote-debugging-port=${args.port}`], { stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  child.on("error", () => {});
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${args.port}/json/version`)).ok,
    "the app's remote-debugging port",
    180_000,
  );
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.port}`);
  const page = await waitFor(
    async () =>
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().includes("/renderer/index.html")),
    "the renderer page",
    90_000,
  );
  await waitFor(
    () => page.evaluate(() => (document.getElementById("root")?.childElementCount ?? 0) > 0),
    "React to mount",
    90_000,
  );
  return { child, exited, browser, page };
}

async function close(app) {
  await app.page.evaluate(() => window.close()).catch(() => {});
  const code = await Promise.race([
    app.exited,
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 60_000)),
  ]);
  await app.browser.close().catch(() => {});
  if (code === "timeout") app.child.kill();
  return code;
}

async function engineReady(page, timeoutMs = 300_000) {
  return waitFor(
    () =>
      page.evaluate(async () => {
        const event = await window.nazeer.engine.getStatus();
        if (event.status === "fatal") return { fatal: event };
        return event.status === "ready" ? event : null;
      }),
    "the engine (ready or fatal)",
    timeoutMs,
  );
}

async function tryKey(page, key) {
  await page.getByRole("textbox").fill(key);
  await page.getByRole("button", { name: /Activate/ }).click();
}

async function alertHas(page, english, arabic) {
  return waitFor(
    async () => {
      const text = await page.getByRole("alert").innerText({ timeout: 1000 });
      return text.includes(english) && text.includes(arabic);
    },
    `the reason "${english}"`,
    15_000,
  ).catch(() => false);
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function api(conn, method, route, body) {
  const response = await fetch(`${conn.baseUrl}${route}`, {
    method,
    headers: { "X-Nazeer-Token": conn.token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** The bag on a clean Windows: frame search in the UI, a session, two measurements, finalize,
 * approve, print and seal (the packaged engine, pyrealsense2, torch, matplotlib, printToPDF). */
async function bagFlow(page, conn) {
  // English through the header's own switch, as an operator would (writing the preference into
  // storage before a reload races the app's own saving of it)
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("link", { name: "Open a bag" }).waitFor({ timeout: 15_000 });
  await page.evaluate(() => {
    location.hash = "#/";
  });
  await engineReady(page);
  const box = page.getByRole("textbox", { name: /paste the path/ });
  await box.fill(args.bag);
  await box.press("Enter");
  await page.getByText("Intel RealSense D455").waitFor({ timeout: 120_000 });
  check("bag", "the packaged engine reads the bag (inspect)", true, path.basename(args.bag));
  const t0 = Date.now();
  await page.getByRole("button", { name: /Find the best frames|Show the proposed frames/ }).click();
  await page.waitForURL(/#\/candidates\/[0-9a-f]+\/[0-9a-f]+$/, { timeout: 900_000 });
  const tiles = page.getByRole("article");
  await tiles.first().waitFor({ timeout: 60_000 });
  const n = await tiles.count();
  check(
    "bag",
    "frame search (real model on CPU)",
    n > 0,
    `${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
  await shot(page, "frames");
  await tiles.first().getByRole("button", { name: "Use this frame" }).click();
  const dialog = page.getByRole("dialog", { name: "Start a measuring session" });
  await dialog.getByRole("textbox", { name: /Camel ID/ }).fill("جمل-صندوق-1");
  await dialog.getByRole("button", { name: "Start measuring" }).click();
  await page.waitForURL(/#\/sessions\/\d{8}_\d{6}_[0-9a-f]{6}$/, { timeout: 60_000 });
  const id = page.url().split("/").pop();
  const view = (await api(conn, "GET", `/sessions/${id}`)).body;
  const inside = [];
  for (let v = 40; v < view.frame.height - 20 && inside.length < 40; v += 40) {
    for (let u = 40; u < view.frame.width - 20; u += 40) {
      const d = (await api(conn, "POST", `/sessions/${id}/depth`, { u, v, target: "camel" })).body;
      if (d?.inside_mask && d?.ok) inside.push([u, v]);
    }
  }
  const a = inside[0];
  const b = inside[inside.length - 1];
  const put = await api(conn, "PUT", `/sessions/${id}/document`, {
    revision: view.revision + 1,
    camel_id: "جمل-صندوق-1",
    measurements: [
      { id: 1, kind: "distance_2d", name: "طول ثنائي الأبعاد", points: [a, b], note: "" },
      { id: 2, kind: "distance_3d", name: "Length 3D", points: [a, b], note: "" },
    ],
    next_measurement_id: 3,
  });
  check(
    "bag",
    "two measurements saved",
    put.status === 200,
    `${put.status} ${put.body?.error?.code ?? ""}`,
  );
  const finalized = await api(conn, "POST", `/sessions/${id}/finalize`, {
    revision: put.body.revision,
  });
  check(
    "bag",
    "finalize: the engine drew the overlay (matplotlib, Plex)",
    finalized.status === 200,
    `${finalized.status} ${finalized.body?.error?.code ?? finalized.body?.outputs?.overlay?.file}`,
  );
  // the measurements and the finalize went through the engine's API, not the screens: the app
  // still holds the session as it was opened; a reload reads it again (finalized), as a reopen would
  await page.reload({ waitUntil: "load" });
  await engineReady(page);
  await page.evaluate((sid) => {
    location.hash = `#/sessions/${sid}/finalize`;
  }, id);
  const approve = page.getByRole("button", { name: "Approve this image" });
  await approve.waitFor({ timeout: 60_000 });
  await waitFor(async () => (await approve.isEnabled()) || null, "the approve button", 60_000);
  await approve.click();
  await page.evaluate((sid) => {
    location.hash = `#/sessions/${sid}/report`;
  }, id);
  const print = page.getByRole("button", { name: "Print the report" });
  await waitFor(async () => (await print.isEnabled()) || null, "the print button", 60_000);
  await print.click();
  await page.getByText("The report is sealed").waitFor({ timeout: 300_000 });
  const sealed = (await api(conn, "GET", `/sessions/${id}`)).body;
  const manifest = (await api(conn, "GET", sealed.outputs.manifest_url)).body;
  const probes = manifest?.probes ?? {};
  check(
    "bag",
    "print and seal on a clean Windows: probes PASS",
    probes.verdict === "PASS" &&
      probes.pixel?.match?.max_abs_diff === 0 &&
      probes.fonts?.ok &&
      !probes.fonts?.type3_present,
    `${probes.verdict}, ${probes.n_pages} pages, fonts ${(probes.fonts?.fonts ?? []).join(" ")}`,
  );
  await page
    .getByText("Fingerprint verified")
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => undefined);
  await shot(page, "report");
  // D12: once the viewer verified the sealed PDF, the Save dialog opens by itself; the packaged app
  // takes no test switch, so the OS dialog is cancelled here (Win32, IDCANCEL) and the report then
  // says no copy was saved
  const cancelled = cancelOsDialogs(args.exe, 60_000);
  const notSaved = await page
    .getByTestId("not-saved-to-file")
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check(
    "bag",
    "the Save dialog opened by itself after the seal; cancelled, no copy saved",
    cancelled.length > 0 && notSaved,
    cancelled.length > 0 ? `dialog "${cancelled.join('", "')}"` : "no Save dialog within 60 s",
  );
}

async function main() {
  // the first start: the Activate screen in both languages (unless this profile is licensed)
  let app = await launch();
  const { page } = app;
  await page.waitForTimeout(1500);
  await shot(page, "first-start");
  const license = await page.evaluate(() => window.nazeer.license.getStatus());
  if (!args.expectLicensed) {
    const heading = await waitFor(
      async () => {
        const text = await page.getByRole("heading", { level: 1 }).innerText({ timeout: 1000 });
        return text.includes("Activate Nazeer") ? text : null;
      },
      "the Activate screen",
      60_000,
    ).catch(() => "(no Activate screen)");
    check(
      "3",
      "Activate screen first, in Arabic and English",
      heading.includes("Activate Nazeer") &&
        heading.includes("تفعيل نظير") &&
        license.state === "inactive",
      heading.replace(/\s+/g, " "),
    );
    await tryKey(page, keys.tampered);
    check(
      "4",
      "tampered key: its reason in Arabic and English",
      await alertHas(page, "was not issued for Nazeer", "لم يُصدر هذا المفتاح لنظير"),
    );
    await tryKey(page, keys.expired);
    check(
      "4",
      "expired key: its reason in Arabic and English",
      await alertHas(page, "This licence key has expired", "انتهت صلاحية مفتاح الترخيص هذا"),
    );
    await shot(page, "activate-expired");
    await tryKey(page, keys.trial);
  } else {
    check(
      "7",
      "this profile's licence is active: no Activate screen",
      license.state === "active",
      JSON.stringify({ state: license.state, kind: license.license?.kind }),
    );
  }
  const t = Date.now();
  const ready = await engineReady(page);
  if (ready.fatal) {
    check(
      "4",
      "trial key: the app opens and the engine starts",
      false,
      JSON.stringify(ready.fatal),
    );
    await shot(page, "engine-fatal");
    await close(app);
    return;
  }
  const conn = ready.connection;
  check(
    "4",
    "trial key: the app opens and the engine starts (real model)",
    !conn.stubModel,
    `${((Date.now() - t) / 1000).toFixed(1)} s, ${conn.modelFile}, Arabic stack ${conn.arabicStackOk ? "ok" : "MISSING"}, data root ${conn.dataRoot}`,
  );
  await shot(page, "home");

  await page.evaluate(() => {
    location.hash = "#/about";
  });
  await page.waitForTimeout(2000);
  const about = await page
    .locator("main")
    .innerText()
    .catch(() => "");
  const status = await page.evaluate(() => window.nazeer.license.getStatus());
  check(
    "5",
    "About: licence (trial, end date), engine (best.pt), Arabic stack available",
    status.license?.kind === "trial" &&
      Boolean(status.license?.expires) &&
      /best\.pt/.test(about) &&
      conn.arabicStackOk,
    `licence ${status.license?.kind} until ${status.license?.expires}; ${/best\.pt/.test(about) ? "best.pt shown" : "best.pt NOT shown"}`,
  );
  await shot(page, "about");

  if (args.bag !== null && existsSync(args.bag)) {
    try {
      await bagFlow(page, conn);
    } catch (error) {
      check("bag", "bag, frame search, print and seal", false, error?.message ?? String(error));
      await shot(page, "bag-failure").catch(() => undefined);
    }
  }

  const enginePid = conn.pid;
  const code = await close(app);
  const gone = await waitFor(async () => !isPidAlive(enginePid), "the engine to stop", 60_000)
    .then(() => true)
    .catch(() => false);
  check(
    "6",
    "closing the window stops the app and the engine",
    code === 0 && gone,
    `app exit ${code}, engine pid ${enginePid} ${gone ? "gone" : "STILL RUNNING"}`,
  );

  app = await launch();
  const again = await app.page.evaluate(() => window.nazeer.license.getStatus());
  await app.page.waitForTimeout(1500);
  await shot(app.page, "relaunch");
  check(
    "7",
    "second start: no Activate screen",
    again.state === "active",
    `${again.license?.kind} until ${again.license?.expires}`,
  );
  const readyAgain = await engineReady(app.page).catch(() => ({ fatal: "timeout" }));
  const againPid = readyAgain.connection?.pid;
  const code2 = await close(app);
  const gone2 =
    againPid === undefined ||
    (await waitFor(async () => !isPidAlive(againPid), "the engine", 60_000)
      .then(() => true)
      .catch(() => false));
  check("6", "second close: app and engine gone", code2 === 0 && gone2, `exit ${code2}`);
}

try {
  await main();
} catch (error) {
  check("run", "the driver ran to the end", false, error?.stack ?? String(error));
} finally {
  save();
}
