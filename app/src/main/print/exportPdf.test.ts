import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EngineConnection, ExportRequest, PrintJob, PrintPreflight } from "@shared/ipc";
import {
  exportPdf,
  oneAtATime,
  PRINT_FONT_SHA256,
  sha256Hex,
  type ExportDeps,
  type PrintOutcome,
} from "./exportPdf";
import { PrintError } from "./printWindow";

vi.mock("electron", () => ({}));

const FONT = new Uint8Array(
  readFileSync(
    resolve(
      __dirname,
      "../../../../engine/nazeer_engine/assets/fonts/IBMPlexSansArabic-Regular.ttf",
    ),
  ),
);
const OVERLAY = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 7, 7, 7]);
const MODEL = new TextEncoder().encode(
  JSON.stringify({ report_model_version: "1.1", static: {}, measurements: [] }),
);
const ID = "20261011_152956_e20a7c";
const CONN: EngineConnection = {
  baseUrl: "http://127.0.0.1:51234",
  port: 51234,
  token: "t0k",
  pid: 42,
  dataRoot: "D:\\root",
  engineVersion: "0.1.0",
  modelFile: "best.pt",
  modelSha256: null,
  stubModel: false,
  warmupMs: null,
  arabicStackOk: true,
  appVersion: "0.1.0",
  electron: "44.4.5",
  chromium: "152.0.0.0",
  logDir: "D:\\logs",
};
const PASS: PrintPreflight = {
  ok: true,
  problems: [],
  warnings: [],
  checked: { requiredTexts: 2, textNodes: 10, characters: 100, images: 2 },
};

interface Fake {
  status: string;
  stale: boolean;
  overlay: { version: number; sha256: string };
  model: { version: number; sha256: string; bytes: Uint8Array };
  upload: { status: number; body: unknown };
  calls: { method: string; path: string; headers: Record<string, string>; bytes: number }[];
}

function fake(): Fake {
  return {
    status: "finalized",
    stale: false,
    overlay: { version: 1, sha256: sha256Hex(OVERLAY) },
    model: { version: 2, sha256: sha256Hex(MODEL), bytes: MODEL },
    upload: { status: 200, body: { session: { session_id: ID }, probe: { verdict: "PASS" } } },
    calls: [],
  };
}

function engineFetch(f: Fake): typeof fetch {
  return (input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(answer(f, input, init));
}

function answer(f: Fake, input: string | URL | Request, init?: RequestInit): Response {
  {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const body = init?.body as Uint8Array | undefined;
    f.calls.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      headers,
      bytes: body?.byteLength ?? 0,
    });
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.pathname === `/sessions/${ID}` && init?.method === undefined) {
      return json(200, {
        session_id: ID,
        status: f.status,
        outputs_stale: f.stale,
        outputs: {
          overlay: {
            version: f.overlay.version,
            sha256: f.overlay.sha256,
            width: 1280,
            height: 840,
            url: `/sessions/${ID}/assets/overlay_v1.png?v=1`,
          },
          report_model: {
            version: f.model.version,
            sha256: f.model.sha256,
            url: `/sessions/${ID}/assets/report_model_v2.json?v=2`,
          },
          report: null,
        },
        required_report_texts: ["جمل-1", "Height"],
      });
    }
    if (url.pathname === `/sessions/${ID}/assets/report_model_v2.json`) {
      return new Response(f.model.bytes, { status: 200 });
    }
    if (url.pathname === `/sessions/${ID}/report` && init?.method === "POST") {
      return json(f.upload.status, f.upload.body);
    }
    return json(404, { error: { code: "not_found", message: "Not Found", details: {} } });
  }
}

const request = (f: Fake, overrides: Partial<ExportRequest> = {}): ExportRequest => ({
  sessionId: ID,
  overlay: { version: f.overlay.version, sha256: sha256Hex(OVERLAY), bytes: OVERLAY },
  reportModel: { version: f.model.version, sha256: f.model.sha256 },
  ...overrides,
});

function deps(
  f: Fake,
  print: (job: PrintJob) => Promise<PrintOutcome> = () =>
    Promise.resolve({ preflight: PASS, pdf: new Uint8Array([37, 80, 68, 70, 45]) }),
  font: Uint8Array | null = FONT,
): ExportDeps & { printed: PrintJob[] } {
  const printed: PrintJob[] = [];
  return {
    connection: () => CONN,
    fetch: engineFetch(f),
    readAsset: (name) => Promise.resolve(name === "font" ? font : new Uint8Array([1, 2, 3])),
    print: (job) => {
      printed.push(job);
      return print(job);
    },
    appInfo: { appVersion: "0.1.0", electron: "44.4.5", chromium: "152.0.0.0" },
    printed,
  };
}

describe("exportPdf", () => {
  it("prints the approved bytes with the engine's face and has the engine seal the PDF", async () => {
    const f = fake();
    const d = deps(f);
    const result = await exportPdf(request(f), d);
    expect(result.ok).toBe(true);
    expect(result.ok && result.probe).toEqual({ verdict: "PASS" });
    const job = d.printed[0];
    expect(job?.overlay.bytes).toEqual(OVERLAY);
    expect(job?.font.sha256).toBe(PRINT_FONT_SHA256);
    expect(job?.reportModel).toEqual({ version: 2, sha256: f.model.sha256 });
    expect(job?.requiredTexts).toEqual(["جمل-1", "Height"]);
    expect(job?.model).toEqual({ report_model_version: "1.1", static: {}, measurements: [] });
    const upload = f.calls.find((c) => c.method === "POST");
    expect(upload?.bytes).toBe(5);
    expect(upload?.headers).toMatchObject({
      "content-type": "application/pdf",
      "x-overlay-sha256": f.overlay.sha256,
      "x-overlay-version": "1",
      "x-report-model-sha256": f.model.sha256,
      "x-app-version": "0.1.0",
      "x-electron": "44.4.5",
      "x-chromium": "152.0.0.0",
      "x-nazeer-token": "t0k",
    });
  });

  it("refuses a session that is not finalized, or whose outputs are stale", async () => {
    for (const change of [(f: Fake) => (f.status = "open"), (f: Fake) => (f.stale = true)]) {
      const f = fake();
      change(f);
      const d = deps(f);
      const result = await exportPdf(request(f), d);
      expect(!result.ok && result.error.code).toBe("status_not_finalized");
      expect(d.printed).toHaveLength(0);
    }
  });

  it("refuses an approval of another overlay, and a report model that changed meanwhile", async () => {
    const f = fake();
    const outdated = await exportPdf(
      request(f, { overlay: { version: 2, sha256: "c".repeat(64), bytes: OVERLAY } }),
      deps(f),
    );
    expect(!outdated.ok && outdated.error.code).toBe("approval_outdated");
    const moved = await exportPdf(
      request(f, { reportModel: { version: 1, sha256: "d".repeat(64) } }),
      deps(f),
    );
    expect(!moved.ok && moved.error.code).toBe("report_model_mismatch");
  });

  it("re-hashes the bytes it is asked to print", async () => {
    const f = fake();
    const tampered = new Uint8Array(OVERLAY);
    tampered[9] = 0;
    const result = await exportPdf(
      request(f, { overlay: { version: 1, sha256: f.overlay.sha256, bytes: tampered } }),
      deps(f),
    );
    expect(!result.ok && result.error.code).toBe("overlay_bytes_mismatch");
  });

  it("checks the report model's bytes and version", async () => {
    const f = fake();
    f.model.bytes = new TextEncoder().encode('{"report_model_version": "1.1", "x": 1}');
    const changed = await exportPdf(request(f), deps(f));
    expect(!changed.ok && changed.error.code).toBe("report_model_hash_mismatch");

    const old = fake();
    old.model.bytes = new TextEncoder().encode('{"report_model_version": "1.0"}');
    old.model.sha256 = sha256Hex(old.model.bytes);
    const outdated = await exportPdf(request(old), deps(old));
    expect(!outdated.ok && outdated.error.code).toBe("report_model_outdated");
    expect(!outdated.ok && outdated.error.details).toMatchObject({ version: "1.0" });
  });

  it("needs the engine's pinned face", async () => {
    const f = fake();
    const missing = await exportPdf(request(f), deps(f, undefined, null));
    expect(!missing.ok && missing.error.code).toBe("print_font_missing");
    const other = await exportPdf(request(f), deps(f, undefined, new Uint8Array([0, 1, 0, 0])));
    expect(!other.ok && other.error.code).toBe("print_font_mismatch");
  });

  it("does not print or upload a page whose own checks failed", async () => {
    const f = fake();
    const problem = { code: "print_glyph_missing", message: "a name", details: {} };
    const result = await exportPdf(
      request(f),
      deps(f, () =>
        Promise.resolve({ preflight: { ...PASS, ok: false, problems: [problem] }, pdf: null }),
      ),
    );
    expect(!result.ok && result.error.code).toBe("print_glyph_missing");
    expect(result.preflight?.problems).toEqual([problem]);
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("reports a print window that timed out by its code", async () => {
    const f = fake();
    const result = await exportPdf(
      request(f),
      deps(f, () => Promise.reject(new PrintError("print_timeout", "not ready within 90000 ms"))),
    );
    expect(!result.ok && result.error).toMatchObject({ status: null, code: "print_timeout" });
  });

  it("passes the engine's refusal on with its probe", async () => {
    const f = fake();
    const probe = { verdict: "DRIFT", hard_failures: ["overlay_drift"] };
    f.upload = {
      status: 409,
      body: { error: { code: "overlay_drift", message: "drift", details: { probe } } },
    };
    const result = await exportPdf(request(f), deps(f));
    expect(!result.ok && result.error).toMatchObject({ status: 409, code: "overlay_drift" });
    expect(result.probe).toEqual(probe);
    expect(result.preflight).toEqual(PASS);
  });

  it("an engine that cannot be reached is a network error; none connected is engine_not_ready", async () => {
    const f = fake();
    const down = await exportPdf(request(f), {
      ...deps(f),
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    expect(!down.ok && down.error.code).toBe("network_error");
    const none = await exportPdf(request(f), { ...deps(f), connection: () => null });
    expect(!none.ok && none.error.code).toBe("engine_not_ready");
  });
});

describe("oneAtATime", () => {
  it("refuses a second export while one runs", async () => {
    let release: () => void = () => undefined;
    const run = oneAtATime(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              session: {},
              probe: {},
              preflight: PASS,
              pdfBytes: 1,
              timingsMs: {},
            });
        }),
    );
    const f = fake();
    const first = run(request(f));
    const second = await run(request(f));
    expect(!second.ok && second.error.code).toBe("export_busy");
    release();
    expect((await first).ok).toBe(true);
    // free again once the first finished
    const third = run(request(f));
    release();
    expect((await third).ok).toBe(true);
  });
});
