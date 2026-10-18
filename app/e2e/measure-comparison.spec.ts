// D12 Stage 5, the measurement (opt-in: NAZEER_MEASURE=1; npm run build first): the built app
// prints and seals comparisons of 1, 5 and 20 camels through `print.exportComparison` — the same
// path the comparison screen takes (main fetches and hashes each approved image, the hidden print
// window lays the comparison model out and prints it, the engine probes and seals it). The data
// roots are copies of the Stage 3 measurement's (`engine/tools/measure_comparison_seal.py`: real
// bag frames, eight named measurements per camel); the 20-camel comparison is printed again in
// both languages (blocks of four camel columns). Per run: the phases' times as main reports them,
// pages, printed and sealed sizes, and peak memory — main and the print window from
// `app.getAppMetrics()` (sampled every 200 ms), the engine's lifetime peak working set. Writes
// ..\runs\comparison_print_<UTC>\summary.json and keeps each sealed PDF
// there. No pointer or keyboard is used (the window can be left alone, D9).
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { ComparisonExportRequest, EngineConnection } from "@shared/ipc";
import { launchApp, repoDir, waitForReady } from "./helpers/app";

const SIZES = [1, 5, 20] as const;

test.skip(process.env["NAZEER_MEASURE"] !== "1", "the measurement runs only with NAZEER_MEASURE=1");
test.describe.configure({ mode: "serial" });

type Json = Record<string, unknown>;

/** The newest Stage 3 measurement whose data roots hold every size. */
function stage3Roots(): Record<number, string> {
  const runs = path.join(repoDir, "runs");
  const candidates = readdirSync(runs)
    .filter((name) => name.startsWith("comparison_seal_"))
    .sort()
    .reverse();
  for (const name of candidates) {
    const roots = Object.fromEntries(SIZES.map((n) => [n, path.join(runs, name, `n${n}`, "root")]));
    if (SIZES.every((n) => existsSync(roots[n] as string))) return roots;
  }
  throw new Error(
    "no comparison_seal_* run with n1, n5 and n20 roots: run measure_comparison_seal.py",
  );
}

async function engine(
  page: Page,
  conn: EngineConnection,
  method: string,
  route: string,
  body?: unknown,
) {
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
      return (await response.json()) as Record<string, unknown>;
    },
    { conn, method, route, body },
  );
}

interface Sample {
  pid: number;
  type: string;
  ws: number;
  peak: number;
}

/** Peak working sets (MB) while `work` runs: main, and the renderers that appeared meanwhile. */
async function sampled<T>(app: ElectronApplication, work: () => Promise<T>) {
  const metrics = () =>
    app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().map((m) => ({
        pid: m.pid,
        type: m.type,
        ws: m.memory.workingSetSize,
        peak: m.memory.peakWorkingSetSize,
      })),
    ) as Promise<Sample[]>;
  const before = new Set((await metrics()).map((m) => m.pid));
  let done = false;
  let main = 0;
  let print = 0;
  const loop = (async () => {
    while (!done) {
      for (const m of await metrics().catch(() => [] as Sample[])) {
        if (m.type === "Browser") main = Math.max(main, m.ws, m.peak);
        else if (m.type === "Tab" && !before.has(m.pid)) print = Math.max(print, m.ws, m.peak);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  })();
  try {
    return { value: await work(), mainMb: main / 1024, printWindowMb: print / 1024 };
  } finally {
    done = true;
    await loop;
  }
}

function enginePeakMb(pid: number): number | null {
  const run = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).PeakWorkingSet64`],
    { encoding: "utf8" },
  );
  const bytes = Number(run.stdout.trim());
  return Number.isFinite(bytes) && bytes > 0 ? bytes / 2 ** 20 : null;
}

const summary: Json[] = [];
const outDir = path.join(
  repoDir,
  "runs",
  `comparison_print_${new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")}`,
);

test.afterAll(() => {
  if (summary.length === 0) return;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`summary: ${path.join(outDir, "summary.json")}`);
  for (const row of summary) console.log(JSON.stringify(row));
});

for (const n of SIZES) {
  test(`prints and seals a comparison of ${n} camel(s) in Electron`, async () => {
    test.setTimeout(600_000);
    const source = stage3Roots()[n] as string;
    const dataRoot = path.join(mkdtempSync(path.join(tmpdir(), "nazeer-measure-")), "root");
    cpSync(source, dataRoot, { recursive: true });
    const launched = await launchApp({ dataRoot });
    try {
      const { connection } = await waitForReady(launched.page);
      const list = await engine(launched.page, connection, "GET", "/comparisons");
      const id = ((list["items"] as Json[])[0] as Json)["comparison_id"] as string;
      const languages = n === 20 ? (["model", "both"] as const) : (["model"] as const);
      for (const language of languages) {
        if (language === "both") {
          await engine(launched.page, connection, "PATCH", `/comparisons/${id}/inputs`, {
            language: "both",
          });
        }
        const view = await engine(launched.page, connection, "GET", `/comparisons/${id}`);
        expect(view["stale"]).toBe(false);
        const members = view["members"] as Json[];
        const model = (view["outputs"] as Json)["model"] as Json;
        // the measurement approves every image not sealed in a report as the screen would
        const request: ComparisonExportRequest = {
          comparisonId: id,
          model: { version: model["version"] as number, sha256: model["sha256"] as string },
          approvals: members
            .filter((m) => m["approved_by_seal"] !== true)
            .map((m) => {
              const overlay = m["overlay"] as Json;
              return {
                sessionId: m["session_id"] as string,
                overlayVersion: overlay["version"] as number,
                sha256: overlay["sha256"] as string,
              };
            }),
        };
        const started = Date.now();
        const run = await sampled(launched.app, () =>
          launched.page.evaluate((r) => window.nazeer.print.exportComparison(r), request),
        );
        const wallMs = Date.now() - started;
        const result = run.value;
        if (!result.ok) throw new Error(`export failed: ${JSON.stringify(result.error)}`);
        const probe = result.probe as Json;
        expect(probe["verdict"]).toBe("PASS");
        const row = {
          camels: n,
          language: view["language"],
          pages: probe["n_pages"],
          printed_mb: +(result.pdfBytes / 2 ** 20).toFixed(1),
          sealed_mb: +((probe["bytes_out"] as number) / 2 ** 20).toFixed(1),
          timings_ms: result.timingsMs,
          wall_ms: wallMs,
          seal_probe_ms: (probe["timings_ms"] as Json)["total"],
          main_peak_mb: +run.mainMb.toFixed(0),
          print_window_peak_mb: +run.printWindowMb.toFixed(0),
          engine_peak_mb: Number(enginePeakMb(connection.pid)?.toFixed(0) ?? NaN),
          preflight: result.preflight.checked,
        };
        summary.push(row);
        // the sealed PDF, kept for reading back (the data root copy is deleted)
        const sealed = (
          (
            (await engine(launched.page, connection, "GET", `/comparisons/${id}`))[
              "outputs"
            ] as Json
          )["report"] as Json
        )["file"] as string;
        mkdirSync(outDir, { recursive: true });
        cpSync(
          path.join(dataRoot, "comparisons", id, sealed),
          path.join(outDir, `n${n}_${String(view["language"])}.pdf`),
        );
        console.log(JSON.stringify(row));
      }
    } finally {
      await launched.close();
      rmSync(path.dirname(dataRoot), { recursive: true, force: true });
    }
  });
}
