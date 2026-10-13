import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EngineConnection, ExportRequest, ExportResult } from "@shared/ipc";
import {
  headlessRequest,
  parseExportArgs,
  removeStaleExportFolders,
  runHeadlessExport,
  sessionLocation,
  type HeadlessDeps,
} from "./cli";

const ID = "20261011_152956_e20a7c";
const ROOT = String.raw`D:\nazeer\data`;
const DIR = String.raw`D:\nazeer\data\sessions\20261011_152956_e20a7c`;
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const SHA = createHash("sha256").update(PNG).digest("hex");

function view(overrides: Record<string, unknown> = {}, outputs: Record<string, unknown> = {}) {
  return {
    session_id: ID,
    status: "exported",
    outputs_stale: false,
    outputs: {
      overlay: { version: 2, sha256: SHA, url: `/sessions/${ID}/assets/overlay_v2.png?v=2` },
      report_model: { version: 3, sha256: "b".repeat(64), url: "/m" },
      report: { version: 1, overlay_version: 2, url: "/r" },
      ...outputs,
    },
    ...overrides,
  };
}

describe("parseExportArgs", () => {
  it("is null without --export; reads the session folder and --out", () => {
    expect(parseExportArgs(["electron.exe", "."])).toBeNull();
    expect(
      parseExportArgs(["electron.exe", ".", "--export", DIR, "--out", String.raw`D:\r.json`]),
    ).toEqual({
      sessionDir: DIR,
      out: String.raw`D:\r.json`,
    });
    const usage = parseExportArgs(["x", "--export"]);
    expect(usage !== null && "error" in usage ? usage.error : "").toContain("usage");
    expect(parseExportArgs(["x", "--export", DIR, "--out"])).toEqual({
      error: "--out needs a file name",
    });
  });
});

describe("removeStaleExportFolders", () => {
  it("removes earlier exports' throwaway folders, not recent ones or anything else", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "nz-cli-test-"));
    try {
      for (const name of [
        "nazeer-export-old",
        "nazeer-export-logs-old",
        "nazeer-export-new",
        "other",
      ]) {
        mkdirSync(path.join(tmp, name));
      }
      const hourAgo = new Date(Date.now() - 2 * 3_600_000);
      utimesSync(path.join(tmp, "nazeer-export-old"), hourAgo, hourAgo);
      utimesSync(path.join(tmp, "nazeer-export-logs-old"), hourAgo, hourAgo);
      utimesSync(path.join(tmp, "other"), hourAgo, hourAgo);
      expect(removeStaleExportFolders(tmp).sort()).toEqual([
        "nazeer-export-logs-old",
        "nazeer-export-old",
      ]);
      expect(readdirSync(tmp).sort()).toEqual(["nazeer-export-new", "other"]);
      expect(removeStaleExportFolders(path.join(tmp, "missing"))).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("sessionLocation", () => {
  it("finds the data root two folders up from <root>\\sessions\\<id>", () => {
    expect(sessionLocation(DIR)).toEqual({ dataRoot: ROOT, sessionId: ID });
    expect(sessionLocation(`${DIR}\\`)).toEqual({ dataRoot: ROOT, sessionId: ID });
  });

  it("refuses a folder that is not a session folder", () => {
    expect(sessionLocation(String.raw`D:\nazeer\data\sessions\notes`)).toHaveProperty("error");
    expect(sessionLocation(String.raw`D:\nazeer\data\trash\20261011_152956_e20a7c`)).toHaveProperty(
      "error",
    );
  });
});

describe("headlessRequest", () => {
  it("prints again only what was approved and sealed from the current overlay version", () => {
    const planned = headlessRequest(view(), PNG);
    expect(planned).toEqual({
      request: {
        sessionId: ID,
        overlay: { version: 2, sha256: SHA, bytes: PNG },
        reportModel: { version: 3, sha256: "b".repeat(64) },
      },
    });
  });

  it("refuses an open or stale session, an overlay never sealed, and bytes that do not hash", () => {
    expect(headlessRequest(view({ status: "open" }), PNG)).toMatchObject({
      error: { code: "status_not_finalized" },
    });
    expect(headlessRequest(view({ outputs_stale: true }), PNG)).toMatchObject({
      error: { code: "status_not_finalized" },
    });
    expect(headlessRequest(view({}, { report: null }), PNG)).toMatchObject({
      error: { code: "export_needs_approval" },
    });
    expect(
      headlessRequest(view({}, { report: { version: 1, overlay_version: 1, url: "/r" } }), PNG),
    ).toMatchObject({ error: { code: "export_needs_approval" } });
    expect(headlessRequest(view(), new Uint8Array([1]))).toMatchObject({
      error: { code: "overlay_hash_mismatch" },
    });
  });
});

const CONN = { baseUrl: "http://127.0.0.1:5000", token: "t" } as EngineConnection;

function deps(overrides: Partial<HeadlessDeps> = {}) {
  const out: string[] = [];
  const written: [string, string][] = [];
  const exportPdf = vi.fn((_request: ExportRequest): Promise<ExportResult> =>
    Promise.resolve({
      ok: true,
      session: { outputs: { report: { version: 2, file: "report_v2.pdf" } } },
      probe: { verdict: "PASS" },
      preflight: null as never,
      pdfBytes: 10,
      timingsMs: { print: 1 },
    }),
  );
  const stopEngine = vi.fn(() => Promise.resolve());
  const d: HeadlessDeps = {
    startEngine: () => Promise.resolve({ connection: CONN }),
    stopEngine,
    fetch: (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname;
      if (path === `/sessions/${ID}`) {
        return Promise.resolve(new Response(JSON.stringify(view()), { status: 200 }));
      }
      return Promise.resolve(new Response(PNG, { status: 200 }));
    },
    exportPdf,
    licenseActive: () => true,
    writeOut: (file, text) => {
      written.push([file, text]);
      return Promise.resolve();
    },
    stdout: (text) => out.push(text),
    ...overrides,
  };
  return { d, out, written, exportPdf, stopEngine };
}

describe("runHeadlessExport", () => {
  it("exports with its own engine, writes the result and stops the engine: exit 0 on PASS", async () => {
    const { d, out, written, exportPdf, stopEngine } = deps();
    const code = await runHeadlessExport({ sessionDir: DIR, out: String.raw`D:\r.json` }, d);
    expect(code).toBe(0);
    expect(exportPdf.mock.calls[0]?.[0].overlay.bytes).toEqual(PNG);
    const result = JSON.parse(out.join("")) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: true, session_id: ID, verdict: "PASS", error: null });
    expect(result["report"]).toEqual({ version: 2, file: "report_v2.pdf" });
    expect(written[0]?.[0]).toBe(String.raw`D:\r.json`);
    expect(stopEngine).toHaveBeenCalledTimes(1);
  });

  it("asks to close the app when its engine holds the data root (never stops it)", async () => {
    const { d, out, exportPdf } = deps({
      startEngine: () =>
        Promise.resolve({
          fatal: { code: "engine_already_running", message: "locked by pid 9" },
        }),
    });
    expect(await runHeadlessExport({ sessionDir: DIR, out: null }, d)).toBe(4);
    const result = JSON.parse(out.join("")) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("engine_already_running");
    expect(result.error.message).toContain("close");
    expect(exportPdf).not.toHaveBeenCalled();
  });

  it("refuses without a licence, and with a folder that is not a session's", async () => {
    const unlicensed = deps({ licenseActive: () => false });
    expect(await runHeadlessExport({ sessionDir: DIR, out: null }, unlicensed.d)).toBe(3);
    const usage = deps();
    expect(await runHeadlessExport({ sessionDir: String.raw`D:\x`, out: null }, usage.d)).toBe(2);
    expect(await runHeadlessExport({ error: "usage: --export <dir>" }, usage.d)).toBe(2);
  });

  it("a result file that cannot be written: exit 1, said on stdout, the engine stopped", async () => {
    const { d, out, stopEngine } = deps({
      writeOut: () => Promise.reject(new Error("ENOENT: no such file or directory")),
    });
    const code = await runHeadlessExport(
      { sessionDir: DIR, out: String.raw`Z:\missing\r.json` },
      d,
    );
    expect(code).toBe(1);
    const result = JSON.parse(out.join("")) as Record<string, unknown>;
    expect(result).toMatchObject({
      ok: false,
      verdict: "PASS",
      error: { code: "out_write_failed" },
      report: { version: 2, file: "report_v2.pdf" },
    });
    expect(JSON.stringify(result["error"])).toContain(String.raw`Z:\\missing\\r.json`);
    expect(stopEngine).toHaveBeenCalledTimes(1);
  });

  it("a refused PDF whose result file cannot be written keeps the refusal as its error", async () => {
    const { d, out } = deps({
      exportPdf: () =>
        Promise.resolve({
          ok: false,
          error: { status: 409, code: "text_probe_failed", message: "x", details: {} },
          probe: { verdict: "DRIFT" },
          preflight: null,
          timingsMs: {},
        }),
      writeOut: () => Promise.reject(new Error("EACCES")),
    });
    expect(await runHeadlessExport({ sessionDir: DIR, out: String.raw`D:\r.json` }, d)).toBe(1);
    const result = JSON.parse(out.join("")) as {
      error: { code: string; details: Record<string, unknown> };
    };
    expect(result.error.code).toBe("text_probe_failed");
    expect(String(result.error.details["out_write_failed"])).toContain("EACCES");
  });

  it("a refused PDF is exit 1 with the engine's verdict", async () => {
    const { d, out } = deps({
      exportPdf: () =>
        Promise.resolve({
          ok: false,
          error: { status: 409, code: "text_probe_failed", message: "x", details: {} },
          probe: { verdict: "DRIFT" },
          preflight: null,
          timingsMs: {},
        }),
    });
    expect(await runHeadlessExport({ sessionDir: DIR, out: null }, d)).toBe(1);
    expect(JSON.parse(out.join(""))).toMatchObject({
      verdict: "DRIFT",
      error: { code: "text_probe_failed" },
    });
  });
});
