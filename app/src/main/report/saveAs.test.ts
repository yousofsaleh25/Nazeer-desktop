import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { EngineConnection, SaveAsRequest } from "@shared/ipc";
import type { SavedCopyRecord } from "../settings";
import { NODE_SAVE_AS_FS } from "./atomicWrite";
import {
  isInsideFolder,
  MAX_SAVE_DIALOGS,
  oneSaveAtATime,
  saveReportAs,
  testSaveDialogs,
  writeProblem,
  type SaveAsDeps,
  type SaveAsDialogs,
  type SaveAsFs,
} from "./saveAs";

const SESSION = "20261014_101500_abc123";
const PDF = new TextEncoder().encode("%PDF-1.7 sealed report bytes");
const SHA = createHash("sha256").update(PDF).digest("hex");

const conn: EngineConnection = {
  baseUrl: "http://127.0.0.1:5555",
  port: 5555,
  token: "t".repeat(64),
  pid: 1,
  dataRoot: "C:\\data",
  engineVersion: "0.1.0",
  modelFile: null,
  modelSha256: null,
  stubModel: true,
  warmupMs: null,
  arabicStackOk: true,
  appVersion: "1.0.0",
  electron: "44.4.5",
  chromium: "152",
  logDir: "C:\\logs",
};

interface EngineFiles {
  outputs?: Record<string, unknown>;
  /** the manifest's files.pdf, or "missing" for a 404 */
  manifestPdf?: Record<string, unknown> | null | "missing";
  pdf?: Uint8Array<ArrayBuffer>;
}

function requestUrl(input: string | URL | Request): URL {
  if (typeof input === "string") return new URL(input);
  return input instanceof URL ? input : new URL(input.url);
}

/** The engine's three answers "Save as" reads: session.json, the manifest, the PDF. */
function engineFetch(files: EngineFiles = {}): typeof fetch {
  const outputs = files.outputs ?? {
    report_version: 2,
    report_file: "report_v2.pdf",
    report_sha256: SHA,
  };
  const manifestPdf =
    files.manifestPdf === undefined ? { file: "report_v2.pdf", sha256: SHA } : files.manifestPdf;
  const pdf = files.pdf ?? PDF;
  return vi.fn((input: string | URL | Request) => {
    const url = requestUrl(input);
    const route = `${url.pathname}${url.search}`;
    const ok = (body: string | Blob, type: string) =>
      Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": type } }));
    if (route === `/sessions/${SESSION}/assets/session.json`) {
      return ok(JSON.stringify({ schema_version: "2.1", outputs }), "application/json");
    }
    if (route === `/sessions/${SESSION}/assets/report.manifest.json`) {
      if (manifestPdf === "missing") {
        const body = {
          error: { code: "asset_not_found", message: "asset not found", details: {} },
        };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 404 }));
      }
      return ok(JSON.stringify({ files: { pdf: manifestPdf } }), "application/json");
    }
    if (route.startsWith(`/sessions/${SESSION}/report?v=`)) {
      return ok(new Blob([pdf]), "application/pdf");
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
}

const dirs: string[] = [];
/** A temp folder with an Arabic name (Arabic paths must work end to end). */
function tempDir(name = "نسخ اختبار"): string {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "nazeer-saveas-")), name);
  mkdirSync(dir);
  dirs.push(path.dirname(dir));
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type DialogMocks = { [K in keyof SaveAsDialogs]: Mock<SaveAsDialogs[K]> };

/** The dialogs as mocks: the Save dialog answers `paths` in turn (then cancels). */
function dialogs(paths: (string | null)[], overrides: Partial<DialogMocks> = {}) {
  const asked: string[] = [];
  const queue = [...paths];
  const m: DialogMocks = {
    choosePath: vi.fn<SaveAsDialogs["choosePath"]>((defaultPath) => {
      asked.push(defaultPath);
      return Promise.resolve(queue.length > 0 ? (queue.shift() ?? null) : null);
    }),
    confirmReplace: vi.fn<SaveAsDialogs["confirmReplace"]>(() => Promise.resolve(false)),
    insideDataRoot: vi.fn<SaveAsDialogs["insideDataRoot"]>(() => Promise.resolve("cancel")),
    writeFailed: vi.fn<SaveAsDialogs["writeFailed"]>(() => Promise.resolve("cancel")),
    ...overrides,
  };
  const d: SaveAsDialogs = { ...m };
  return { d, m, asked };
}

function deps(over: Partial<SaveAsDeps> & { dialogs: SaveAsDialogs }): SaveAsDeps & {
  records: SavedCopyRecord[];
} {
  const records: SavedCopyRecord[] = [];
  return {
    connection: () => conn,
    fetch: engineFetch(),
    dataRoot: "C:\\nowhere\\data-root",
    documentsDir: "C:\\Users\\op\\Documents",
    lastSaveFolder: () => null,
    record: (copy) => {
      records.push(copy);
      return true;
    },
    fs: NODE_SAVE_AS_FS,
    now: () => new Date("2026-10-17T10:00:00.000Z"),
    records,
    ...over,
  };
}

const request: SaveAsRequest = {
  kind: "session",
  id: SESSION,
  version: 2,
  suggestedName: "ناقة-7_2026-10-14_v2.pdf",
};

describe("saveReportAs", () => {
  it("writes the sealed bytes where the dialog says, checks them and records the copy", async () => {
    const dir = tempDir();
    const target = path.join(dir, "ناقة-7_2026-10-14_v2.pdf");
    const { d, asked } = dialogs([target]);
    const run = deps({ dialogs: d, documentsDir: dir });
    const result = await saveReportAs(request, run);
    expect(result).toEqual({
      state: "saved",
      path: target,
      version: 2,
      bytes: PDF.byteLength,
      sha256: SHA,
      savedAt: "2026-10-17T10:00:00.000Z",
      recorded: true,
    });
    expect(new Uint8Array(readFileSync(target))).toEqual(PDF);
    expect(asked).toEqual([target]);
    expect(run.records).toEqual([
      expect.objectContaining({
        kind: "session",
        id: SESSION,
        version: 2,
        path: target,
        sha256: SHA,
      }),
    ]);
  });

  it("saves a comparison's sealed PDF read from its view and manifest (D12)", async () => {
    const COMPARISON = "20261017_120000_c0ffee";
    const base = `/comparisons/${COMPARISON}`;
    const routes: string[] = [];
    const comparisonFetch = (manifestSha: string) =>
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input);
        const route = `${url.pathname}${url.search}`;
        routes.push(route);
        const ok = (body: string | Blob) => Promise.resolve(new Response(body, { status: 200 }));
        if (route === base) {
          return ok(
            JSON.stringify({
              comparison_id: COMPARISON,
              outputs: {
                model: { version: 1 },
                report: {
                  version: 3,
                  file: "report_v3.pdf",
                  sha256: SHA,
                  url: `${base}/report?v=3`,
                },
                manifest_url: `${base}/assets/comparison.manifest.json`,
              },
            }),
          );
        }
        if (route === `${base}/assets/comparison.manifest.json`) {
          return ok(
            JSON.stringify({ files: { pdf: { file: "report_v3.pdf", sha256: manifestSha } } }),
          );
        }
        if (route === `${base}/report?v=3`) return ok(new Blob([PDF]));
        return Promise.resolve(new Response("{}", { status: 404 }));
      });
    const dir = tempDir("مقارنات");
    const target = path.join(dir, "مقارنة_3_2026-10-17_v3.pdf");
    const { d } = dialogs([target]);
    const comparison: SaveAsRequest = {
      kind: "comparison",
      id: COMPARISON,
      version: 3,
      suggestedName: "مقارنة_3_2026-10-17_v3.pdf",
    };
    const run = deps({ dialogs: d, fetch: comparisonFetch(SHA) });
    expect(await saveReportAs(comparison, run)).toMatchObject({ state: "saved", path: target });
    expect(new Uint8Array(readFileSync(target))).toEqual(PDF);
    expect(routes).toEqual([base, `${base}/assets/comparison.manifest.json`, `${base}/report?v=3`]);
    expect(run.records).toEqual([
      expect.objectContaining({ kind: "comparison", id: COMPARISON, version: 3 }),
    ]);
    // a manifest naming another fingerprint is refused before any dialog
    const other = dialogs([target]);
    const refused = await saveReportAs(
      comparison,
      deps({ dialogs: other.d, fetch: comparisonFetch("0".repeat(64)) }),
    );
    expect(refused).toMatchObject({ state: "failed", error: { code: "save_as_report_mismatch" } });
    expect(other.m.choosePath).not.toHaveBeenCalled();
    // a newer sealed version than the screen shows
    const newer = await saveReportAs(
      { ...comparison, version: 2 },
      deps({ dialogs: dialogs([]).d, fetch: comparisonFetch(SHA) }),
    );
    expect(newer).toMatchObject({ state: "failed", error: { code: "save_as_report_changed" } });
  });

  it("cancelling the dialog writes nothing", async () => {
    const { d } = dialogs([null]);
    const run = deps({ dialogs: d });
    expect(await saveReportAs(request, run)).toEqual({ state: "cancelled" });
    expect(run.records).toEqual([]);
  });

  it("opens in the last folder used when it still exists, else in Documents, with a safe name", async () => {
    const last = tempDir("آخر مجلد");
    const { d, asked } = dialogs([null, null]);
    await saveReportAs(
      { ...request, suggestedName: "..\\..\\CON.pdf" },
      deps({ dialogs: d, lastSaveFolder: () => last }),
    );
    expect(asked[0]).toBe(path.join(last, "_CON.pdf"));
    await saveReportAs(request, deps({ dialogs: d, lastSaveFolder: () => "C:\\gone\\folder" }));
    expect(asked[1]).toBe(path.win32.join("C:\\Users\\op\\Documents", request.suggestedName));
  });

  it("adds .pdf, and asks before replacing a file of that name; no answer re-opens the dialog", async () => {
    const dir = tempDir();
    const typed = path.join(dir, "تقرير.txt");
    const added = `${typed}.pdf`;
    writeFileSync(added, "an older file");
    const confirmReplace = vi
      .fn<SaveAsDialogs["confirmReplace"]>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { d } = dialogs([typed, typed], { confirmReplace });
    const result = await saveReportAs(request, deps({ dialogs: d }));
    expect(confirmReplace).toHaveBeenCalledTimes(2);
    expect(confirmReplace).toHaveBeenCalledWith(added);
    expect(result).toMatchObject({ state: "saved", path: added });
    expect(new Uint8Array(readFileSync(added))).toEqual(PDF);
  });

  it("never asks twice about a path the dialog itself returned (it confirmed it already)", async () => {
    const dir = tempDir();
    const target = path.join(dir, "موجود.pdf");
    writeFileSync(target, "older");
    const { d, m } = dialogs([target]);
    expect(await saveReportAs(request, deps({ dialogs: d }))).toMatchObject({ state: "saved" });
    expect(m.confirmReplace).not.toHaveBeenCalled();
  });

  it("refuses the data root, whatever the case, and through a junction", async () => {
    const root = tempDir("بيانات");
    const inside = path.join(root, "sessions");
    mkdirSync(inside);
    const elsewhere = tempDir("مكان آخر");
    const junction = path.join(elsewhere, "رابط");
    symlinkSync(inside, junction, "junction");
    for (const chosen of [
      path.join(inside.toUpperCase(), "x.pdf"),
      path.join(root, "x.pdf"),
      path.join(junction, "x.pdf"),
    ]) {
      const { d, m } = dialogs([chosen]);
      const result = await saveReportAs(request, deps({ dialogs: d, dataRoot: root }));
      expect(result, chosen).toEqual({ state: "cancelled" });
      expect(m.insideDataRoot).toHaveBeenCalledTimes(1);
    }
    // "choose another place" opens the dialog again
    const outside = path.join(elsewhere, "x.pdf");
    const { d } = dialogs([path.join(root, "x.pdf"), outside], {
      insideDataRoot: vi.fn<SaveAsDialogs["insideDataRoot"]>(() => Promise.resolve("elsewhere")),
    });
    expect(await saveReportAs(request, deps({ dialogs: d, dataRoot: root }))).toMatchObject({
      state: "saved",
      path: outside,
    });
  });

  it("refuses a share of this machine that reaches the data root (same volume and file id)", async () => {
    // \\localhost\E$\… keeps its UNC path through realpath (measured 2026-10-18), so only the
    // folder identity shows that it is the data root
    const root = String.raw`E:\nazeer\data`;
    const share = String.raw`\\localhost\E$\nazeer\data`;
    const ids: Record<string, string> = {
      [root.toLowerCase()]: "7:42",
      [share.toLowerCase()]: "7:42",
    };
    const fs: SaveAsFs = {
      ...NODE_SAVE_AS_FS,
      realpath: (p) => Promise.resolve(p),
      isDirectory: () => Promise.resolve(true),
      identity: (p) => Promise.resolve(ids[p.toLowerCase()] ?? null),
    };
    for (const chosen of [
      `${share}\\x.pdf`,
      String.raw`${share}\sessions\x.pdf`,
      String.raw`${share}\..cache\x.pdf`,
    ]) {
      const { d, m } = dialogs([chosen]);
      expect(await saveReportAs(request, deps({ dialogs: d, dataRoot: root, fs })), chosen).toEqual(
        { state: "cancelled" },
      );
      expect(m.insideDataRoot, chosen).toHaveBeenCalledTimes(1);
    }
  });

  it("a copy that cannot be written: the operator retries, saves elsewhere, or cancels", async () => {
    const busy = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    const dir = tempDir();
    const first = path.join(dir, "a.pdf");
    const second = path.join(dir, "b.pdf");
    let failures = 1;
    const fs: SaveAsFs = {
      ...NODE_SAVE_AS_FS,
      writeAtomic: async (file, bytes) => {
        if (failures > 0) {
          failures -= 1;
          throw busy;
        }
        await NODE_SAVE_AS_FS.writeAtomic(file, bytes);
      },
    };
    // retry: the second attempt writes
    const retryAnswer = vi.fn<SaveAsDialogs["writeFailed"]>(() => Promise.resolve("retry"));
    const retry = dialogs([first], { writeFailed: retryAnswer });
    expect(await saveReportAs(request, deps({ dialogs: retry.d, fs }))).toMatchObject({
      state: "saved",
      path: first,
    });
    expect(retryAnswer).toHaveBeenCalledWith("busy", first, busy.message);
    // elsewhere: the dialog opens again
    failures = 1;
    const other = dialogs([first, second], {
      writeFailed: vi.fn<SaveAsDialogs["writeFailed"]>(() => Promise.resolve("elsewhere")),
    });
    expect(await saveReportAs(request, deps({ dialogs: other.d, fs }))).toMatchObject({
      state: "saved",
      path: second,
    });
    // cancel: a coded failure that names the problem
    const cancel = dialogs([first]);
    const denied = Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
    const deniedFs: SaveAsFs = { ...fs, writeAtomic: () => Promise.reject(denied) };
    expect(await saveReportAs(request, deps({ dialogs: cancel.d, fs: deniedFs }))).toMatchObject({
      state: "failed",
      error: { code: "save_as_write_failed", details: { path: first, problem: "denied" } },
    });
  });

  it("a copy that reads back different is removed and is a hard error", async () => {
    const dir = tempDir();
    const target = path.join(dir, "a.pdf");
    const fs: SaveAsFs = {
      ...NODE_SAVE_AS_FS,
      readFile: () => Promise.resolve(new Uint8Array([1])),
    };
    const { d } = dialogs([target]);
    const run = deps({ dialogs: d, fs });
    expect(await saveReportAs(request, run)).toMatchObject({
      state: "failed",
      error: { code: "save_as_copy_mismatch", details: { path: target, expected: SHA } },
    });
    expect(existsSync(target)).toBe(false);
    expect(run.records).toEqual([]);
  });

  it("refuses bytes, or a manifest, that disagree with the sealed report's fingerprint", async () => {
    const { d, m } = dialogs([]);
    const wrongBytes = deps({ dialogs: d, fetch: engineFetch({ pdf: new Uint8Array([9, 9]) }) });
    expect(await saveReportAs(request, wrongBytes)).toMatchObject({
      state: "failed",
      error: { code: "save_as_report_mismatch" },
    });
    const wrongManifest = deps({
      dialogs: d,
      fetch: engineFetch({ manifestPdf: { file: "report_v2.pdf", sha256: "b".repeat(64) } }),
    });
    expect(await saveReportAs(request, wrongManifest)).toMatchObject({
      state: "failed",
      error: { code: "save_as_report_mismatch" },
    });
    expect(m.choosePath).not.toHaveBeenCalled();
  });

  it("reads past a manifest that no longer names the PDF (the session was finalized again)", async () => {
    const dir = tempDir();
    for (const manifestPdf of [null, "missing"] as const) {
      const { d } = dialogs([path.join(dir, `${String(manifestPdf)}.pdf`)]);
      const run = deps({ dialogs: d, fetch: engineFetch({ manifestPdf }) });
      expect(await saveReportAs(request, run)).toMatchObject({ state: "saved" });
    }
  });

  it("refuses another sealed version than the screen shows, and a session without one", async () => {
    const { d } = dialogs([]);
    const newer = deps({
      dialogs: d,
      fetch: engineFetch({
        outputs: { report_version: 3, report_file: "report_v3.pdf", report_sha256: SHA },
      }),
    });
    expect(await saveReportAs(request, newer)).toMatchObject({
      state: "failed",
      error: { code: "save_as_report_changed", details: { requested: 2, current: 3 } },
    });
    const none = deps({
      dialogs: d,
      fetch: engineFetch({
        outputs: { report_version: 0, report_file: null, report_sha256: null },
      }),
    });
    expect(await saveReportAs(request, none)).toMatchObject({
      state: "failed",
      error: { code: "save_as_no_report" },
    });
  });

  it("answers engine_not_ready without an engine", async () => {
    const { d } = dialogs([]);
    expect(await saveReportAs(request, deps({ dialogs: d, connection: () => null }))).toMatchObject(
      { state: "failed", error: { code: "engine_not_ready" } },
    );
  });

  it("a record that cannot be stored still answers saved (recorded: false)", async () => {
    const dir = tempDir();
    const { d } = dialogs([path.join(dir, "a.pdf")]);
    const result = await saveReportAs(request, deps({ dialogs: d, record: () => false }));
    expect(result).toMatchObject({ state: "saved", recorded: false });
  });

  it("stops after a bounded number of dialogs that keep naming a refused path", async () => {
    const root = tempDir("بيانات");
    const choosePath = vi.fn<SaveAsDialogs["choosePath"]>(() =>
      Promise.resolve(path.join(root, "x.pdf")),
    );
    const { d } = dialogs([], {
      choosePath,
      insideDataRoot: vi.fn<SaveAsDialogs["insideDataRoot"]>(() => Promise.resolve("elsewhere")),
    });
    expect(await saveReportAs(request, deps({ dataRoot: root, dialogs: d }))).toEqual({
      state: "cancelled",
    });
    expect(choosePath).toHaveBeenCalledTimes(MAX_SAVE_DIALOGS);
  });
});

describe("oneSaveAtATime", () => {
  it("refuses a second save while one is open", async () => {
    let release: () => void = () => undefined;
    const guarded = oneSaveAtATime(
      () =>
        new Promise((done) => {
          release = () => done({ state: "cancelled" });
        }),
    );
    const first = guarded(request);
    expect(await guarded(request)).toMatchObject({
      state: "failed",
      error: { code: "save_as_busy" },
    });
    release();
    expect(await first).toEqual({ state: "cancelled" });
    // free again afterwards
    const next = guarded(request);
    release();
    expect(await next).toEqual({ state: "cancelled" });
  });
});

describe("helpers", () => {
  it("isInsideFolder: case-insensitive, either separator, long-path prefixes", () => {
    expect(isInsideFolder("C:\\Data\\Root\\x", "c:\\data\\root")).toBe(true);
    expect(isInsideFolder("c:/data/root", "C:\\DATA\\ROOT\\")).toBe(true);
    expect(isInsideFolder("\\\\?\\C:\\data\\root\\x", "C:\\data\\root")).toBe(true);
    expect(isInsideFolder("C:\\data\\rootless", "C:\\data\\root")).toBe(false);
    expect(isInsideFolder("D:\\data\\root", "C:\\data\\root")).toBe(false);
    expect(isInsideFolder("\\\\?\\UNC\\nas\\share\\a", "\\\\nas\\share")).toBe(true);
    // a child folder named "..x" is inside; ".." and "..\x" are not
    expect(isInsideFolder("C:\\data\\root\\..cache\\x", "C:\\data\\root")).toBe(true);
    expect(isInsideFolder("C:\\data\\root\\..", "C:\\data\\root")).toBe(false);
    expect(isInsideFolder("C:\\data", "C:\\data\\root")).toBe(false);
    expect(isInsideFolder("C:\\data\\other", "C:\\data\\root")).toBe(false);
  });

  it("writeProblem: busy, denied, other", () => {
    expect(writeProblem({ code: "EBUSY" })).toBe("busy");
    expect(writeProblem({ code: "EPERM" })).toBe("denied");
    expect(writeProblem({ code: "EACCES" })).toBe("denied");
    expect(writeProblem({ code: "ENOSPC" })).toBe("other");
    expect(writeProblem(new Error("x"))).toBe("other");
  });

  it("the test switch answers the first dialog of a save only, and logs the default path", async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    expect(await testSaveDialogs("cancel", log).choosePath("C:\\d\\a.pdf", 0)).toBeNull();
    expect(await testSaveDialogs("file:E:\\out\\x.pdf", log).choosePath("C:\\d\\a.pdf", 0)).toBe(
      "E:\\out\\x.pdf",
    );
    const folder = testSaveDialogs("folder:E:\\اختبار حفظ", log);
    expect(await folder.choosePath("C:\\d\\ناقة.pdf", 0)).toBe("E:\\اختبار حفظ\\ناقة.pdf");
    expect(await folder.choosePath("C:\\d\\ناقة.pdf", 1)).toBeNull();
    expect(
      await testSaveDialogs("file:relative.pdf", log).choosePath("C:\\d\\a.pdf", 0),
    ).toBeNull();
    expect(await folder.confirmReplace("x")).toBe(false);
    expect(lines[0]).toContain("default C:\\d\\a.pdf");
  });
});
