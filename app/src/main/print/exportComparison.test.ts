import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  ComparisonExportRequest,
  ComparisonExportResult,
  EngineConnection,
  ExportRequest,
  ExportResult,
  PrintJob,
  PrintPreflight,
} from "@shared/ipc";
import { COMPARISON_PRINT_TIMEOUTS, exportComparison } from "./exportComparison";
import {
  oneAtATime,
  sha256Hex,
  type ExportDeps,
  type PrintOutcome,
  type PrintTimeouts,
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
const CID = "20261017_120000_c0ffee";
const A = "20261017_100000_aaaaaa";
const B = "20261017_100500_bbbbbb";
const PNG = (n: number) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, n, n, n]);
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
  checked: { requiredTexts: 4, textNodes: 10, characters: 100, images: 3 },
};
const PDF = new Uint8Array([37, 80, 68, 70, 45]);

interface Member {
  sessionId: string;
  bytes: Uint8Array;
  approvedBySeal: boolean;
  staleReasons: string[];
}

interface Fake {
  stale: boolean;
  members: Member[];
  /** what the engine serves as each overlay (defaults to the member's bytes) */
  served: Record<string, Uint8Array>;
  modelVersion: number;
  modelBytes: Uint8Array;
  /** what the engine serves as the model file (defaults to modelBytes) */
  modelServed: Uint8Array | null;
  upload: { status: number; body: unknown };
  calls: { method: string; path: string; headers: Record<string, string> }[];
}

function modelOf(members: Member[], schema = "1.0"): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      comparison_model_version: schema,
      members: members.map((m) => ({
        session_id: m.sessionId,
        overlay: { version: 1, sha256: sha256Hex(m.bytes) },
      })),
    }),
  );
}

function fake(): Fake {
  const members: Member[] = [
    { sessionId: B, bytes: PNG(2), approvedBySeal: true, staleReasons: [] },
    { sessionId: A, bytes: PNG(1), approvedBySeal: false, staleReasons: [] },
  ];
  return {
    stale: false,
    members,
    served: {},
    modelVersion: 3,
    modelBytes: modelOf(members),
    modelServed: null,
    upload: {
      status: 200,
      body: { comparison: { comparison_id: CID, status: "sealed" }, probe: { verdict: "PASS" } },
    },
    calls: [],
  };
}

function engineFetch(f: Fake): typeof fetch {
  return (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    f.calls.push({ method: init?.method ?? "GET", path: url.pathname, headers });
    const json = (status: number, value: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(value), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const base = `/comparisons/${CID}`;
    if (url.pathname === base && init?.method === undefined) {
      return json(200, {
        comparison_id: CID,
        stale: f.stale,
        members: f.members.map((m, i) => ({
          position: i + 1,
          session_id: m.sessionId,
          approved_by_seal: m.approvedBySeal,
          stale_reasons: m.staleReasons,
          overlay: {
            version: 1,
            sha256: sha256Hex(m.bytes),
            url: `/sessions/${m.sessionId}/assets/overlay_v1.png?v=1`,
          },
        })),
        outputs: {
          model: {
            version: f.modelVersion,
            sha256: sha256Hex(f.modelBytes),
            url: `${base}/assets/comparison_model_v${f.modelVersion}.json`,
          },
          report: null,
        },
        required_report_texts: ["جمل-1", "Height", "Title"],
      });
    }
    if (url.pathname === `${base}/assets/comparison_model_v${f.modelVersion}.json`) {
      return Promise.resolve(new Response(f.modelServed ?? f.modelBytes, { status: 200 }));
    }
    const member = f.members.find(
      (m) => url.pathname === `/sessions/${m.sessionId}/assets/overlay_v1.png`,
    );
    if (member !== undefined) {
      return Promise.resolve(
        new Response(f.served[member.sessionId] ?? member.bytes, { status: 200 }),
      );
    }
    if (url.pathname === `${base}/report` && init?.method === "POST") {
      return json(f.upload.status, f.upload.body);
    }
    return json(404, { error: { code: "not_found", message: "Not Found", details: {} } });
  };
}

const request = (f: Fake, overrides: Partial<ComparisonExportRequest> = {}) => ({
  comparisonId: CID,
  model: { version: f.modelVersion, sha256: sha256Hex(f.modelBytes) },
  approvals: [{ sessionId: A, overlayVersion: 1, sha256: sha256Hex(PNG(1)) }],
  ...overrides,
});

function deps(
  f: Fake,
  print: (job: PrintJob) => Promise<PrintOutcome> = () =>
    Promise.resolve({ preflight: PASS, pdf: PDF }),
): ExportDeps & { printed: { job: PrintJob; timeouts: PrintTimeouts }[] } {
  const printed: { job: PrintJob; timeouts: PrintTimeouts }[] = [];
  return {
    connection: () => CONN,
    fetch: engineFetch(f),
    readAsset: (name) => Promise.resolve(name === "font" ? FONT : new Uint8Array([1, 2, 3])),
    print: (job, timeouts) => {
      printed.push({ job, timeouts });
      return print(job);
    },
    appInfo: { appVersion: "1.1.0", electron: "44.4.5", chromium: "152.0.0.0" },
    printed,
  };
}

const codeOf = (result: ComparisonExportResult) => (result.ok ? null : result.error.code);

describe("exportComparison", () => {
  it("fetches each camel's approved image, prints them in order and has the engine seal it", async () => {
    const f = fake();
    const d = deps(f);
    const result = await exportComparison(request(f), d);
    expect(result.ok).toBe(true);
    expect(result.ok && result.comparison).toEqual({ comparison_id: CID, status: "sealed" });
    const printed = d.printed[0];
    if (printed?.job.kind !== "comparison") throw new Error("not a comparison job");
    expect(printed.timeouts).toEqual(COMPARISON_PRINT_TIMEOUTS);
    // the operator's order (B first), the bytes main fetched and hashed
    expect(printed.job.overlays.map((o) => [o.sessionId, o.bytes])).toEqual([
      [B, PNG(2)],
      [A, PNG(1)],
    ]);
    expect(printed.job.comparisonModel).toEqual({
      version: 3,
      sha256: sha256Hex(f.modelBytes),
    });
    expect(printed.job.requiredTexts).toEqual(["جمل-1", "Height", "Title"]);
    const upload = f.calls.find((c) => c.method === "POST");
    expect(upload?.path).toBe(`/comparisons/${CID}/report`);
    expect(upload?.headers).toMatchObject({
      "content-type": "application/pdf",
      "x-comparison-model-sha256": sha256Hex(f.modelBytes),
      "x-app-version": "1.1.0",
      "x-nazeer-token": "t0k",
    });
    expect(Object.keys(result.timingsMs)).toEqual(["fetch", "overlays", "print", "seal"]);
  });

  it("refuses a stale comparison before reading anything else", async () => {
    const f = fake();
    f.stale = true;
    const first = f.members[0];
    if (first !== undefined) first.staleReasons = ["member_reopened"];
    const result = await exportComparison(request(f), deps(f));
    expect(codeOf(result)).toBe("comparison_stale");
    expect(!result.ok && result.error.details).toEqual({
      members: [{ position: 1, session_id: B, stale_reasons: ["member_reopened"] }],
    });
    expect(f.calls).toHaveLength(1);
  });

  it("refuses a camel whose image is neither sealed in a report nor approved in the app", async () => {
    const f = fake();
    for (const approvals of [
      [],
      [{ sessionId: A, overlayVersion: 1, sha256: sha256Hex(PNG(9)) }],
      [{ sessionId: A, overlayVersion: 2, sha256: sha256Hex(PNG(1)) }],
    ]) {
      const result = await exportComparison(request(f, { approvals }), deps(f));
      expect(codeOf(result)).toBe("comparison_approval_required");
      expect(!result.ok && result.error.details).toEqual({
        members: [{ position: 2, session_id: A, overlay_version: 1 }],
      });
    }
  });

  it("refuses another model version, other model bytes, an old schema or other camels", async () => {
    const f = fake();
    const moved = await exportComparison(
      request(f, { model: { version: 2, sha256: sha256Hex(f.modelBytes) } }),
      deps(f),
    );
    expect(codeOf(moved)).toBe("comparison_model_mismatch");

    const tampered = fake();
    tampered.modelServed = modelOf(tampered.members, "1.0 ");
    const hashed = await exportComparison(request(tampered), deps(tampered));
    expect(codeOf(hashed)).toBe("comparison_model_hash_mismatch");

    const old = fake();
    old.modelBytes = modelOf(old.members, "0.9");
    expect(codeOf(await exportComparison(request(old), deps(old)))).toBe(
      "comparison_model_outdated",
    );

    const other = fake();
    other.modelBytes = modelOf([...other.members].reverse());
    expect(codeOf(await exportComparison(request(other), deps(other)))).toBe(
      "comparison_model_mismatch",
    );
  });

  it("refuses an image whose bytes are not the approved ones, naming the camel", async () => {
    const f = fake();
    f.served[A] = PNG(7);
    const d = deps(f);
    const result = await exportComparison(request(f), d);
    expect(codeOf(result)).toBe("overlay_bytes_mismatch");
    expect(!result.ok && result.error.details).toMatchObject({ position: 2, session_id: A });
    expect(d.printed).toEqual([]);
  });

  it("reports the print page's first problem, a print timeout and the engine's refusal", async () => {
    const f = fake();
    const refused: PrintPreflight = {
      ...PASS,
      ok: false,
      problems: [{ code: "print_overlay_order", message: "order", details: {} }],
    };
    const page = await exportComparison(
      request(f),
      deps(f, () => Promise.resolve({ preflight: refused, pdf: null })),
    );
    expect(codeOf(page)).toBe("print_overlay_order");
    expect(!page.ok && page.preflight).toEqual(refused);

    const late = await exportComparison(
      request(f),
      deps(f, () => Promise.reject(new PrintError("print_timeout", "printing took too long"))),
    );
    expect(codeOf(late)).toBe("print_timeout");

    const drift = fake();
    drift.upload = {
      status: 409,
      body: {
        error: {
          code: "overlay_out_of_place",
          message: "camel #2's image is on two pages",
          details: { probe: { verdict: "DRIFT" }, rejected_file: "report_v1.rejected.pdf" },
        },
      },
    };
    const sealed = await exportComparison(request(drift), deps(drift));
    expect(codeOf(sealed)).toBe("overlay_out_of_place");
    expect(!sealed.ok && sealed.probe).toEqual({ verdict: "DRIFT" });
  });

  it("shares one gate with the report's export: neither runs while the other prints", async () => {
    const gate = { busy: false };
    let release: () => void = () => undefined;
    const report = oneAtATime(
      (_request: ExportRequest) =>
        new Promise<ExportResult>((resolve) => {
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
      gate,
    );
    const f = fake();
    const comparison = oneAtATime(
      (r: ComparisonExportRequest) => exportComparison(r, deps(f)),
      gate,
    );
    const running = report({
      sessionId: A,
      overlay: { version: 1, sha256: sha256Hex(PNG(1)), bytes: PNG(1) },
      reportModel: { version: 1, sha256: sha256Hex(PNG(1)) },
    });
    expect(codeOf(await comparison(request(f)))).toBe("export_busy");
    release();
    await running;
    expect((await comparison(request(f))).ok).toBe(true);
  });
});
