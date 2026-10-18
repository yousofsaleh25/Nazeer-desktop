import { describe, expect, it, vi } from "vitest";
import type { SavedCopyQuery } from "@shared/ipc";
import type { SavedCopyRecord } from "../settings";
import { openSavedCopy, savedCopyStatus, type SavedCopyDeps } from "./savedCopies";

const query: SavedCopyQuery = { kind: "session", id: "20261014_101500_abc123", version: 2 };
const record: SavedCopyRecord = {
  ...query,
  path: "D:\\تقارير\\ناقة-7_2026-10-14_v2.pdf",
  sha256: "a".repeat(64),
  bytes: 1000,
  size: 1000,
  mtimeMs: 1_760_000_000_123.5,
  savedAt: "2026-10-17T10:00:00.000Z",
};

function deps(over: Partial<SavedCopyDeps> = {}) {
  const openPath = vi.fn<SavedCopyDeps["openPath"]>(() => Promise.resolve(""));
  const showItemInFolder = vi.fn<SavedCopyDeps["showItemInFolder"]>();
  const run: SavedCopyDeps = {
    record: () => record,
    stat: () => Promise.resolve({ size: record.size, mtimeMs: record.mtimeMs }),
    openPath,
    showItemInFolder,
    timeoutMs: 50,
    ...over,
  };
  return Object.assign(run, { mocks: { openPath, showItemInFolder } });
}

describe("savedCopyStatus", () => {
  it("is null when no copy is recorded", async () => {
    expect(await savedCopyStatus(query, deps({ record: () => null }))).toBeNull();
  });

  it("says whether the copy is still there as written", async () => {
    expect(await savedCopyStatus(query, deps())).toEqual({
      path: record.path,
      savedAt: record.savedAt,
      sha256: record.sha256,
      bytes: record.bytes,
      exists: true,
      changed: false,
    });
    const edited = deps({ stat: () => Promise.resolve({ size: 1001, mtimeMs: record.mtimeMs }) });
    expect(await savedCopyStatus(query, edited)).toMatchObject({ exists: true, changed: true });
    const touched = deps({ stat: () => Promise.resolve({ size: 1000, mtimeMs: 1 }) });
    expect(await savedCopyStatus(query, touched)).toMatchObject({ exists: true, changed: true });
    const gone = deps({ stat: () => Promise.reject(new Error("ENOENT")) });
    expect(await savedCopyStatus(query, gone)).toMatchObject({ exists: false, changed: false });
  });

  it("does not wait for a folder that never answers", async () => {
    const lines: string[] = [];
    const silent = deps({ stat: () => new Promise(() => undefined), log: (l) => lines.push(l) });
    expect(await savedCopyStatus(query, silent)).toMatchObject({ exists: false });
    expect(lines[0]).toContain("did not answer");
  });
});

describe("openSavedCopy", () => {
  it("opens or shows the recorded path only", async () => {
    const run = deps();
    expect(await openSavedCopy({ ...query, action: "open" }, run)).toEqual({ ok: true });
    expect(run.mocks.openPath).toHaveBeenCalledWith(record.path);
    expect(await openSavedCopy({ ...query, action: "show" }, run)).toEqual({ ok: true });
    expect(run.mocks.showItemInFolder).toHaveBeenCalledWith(record.path);
  });

  it("answers with a code when there is no record, no file, or the system cannot open it", async () => {
    expect(
      await openSavedCopy({ ...query, action: "open" }, deps({ record: () => null })),
    ).toMatchObject({ ok: false, error: { code: "save_as_no_copy" } });
    const gone = deps({ stat: () => Promise.reject(new Error("ENOENT")) });
    expect(await openSavedCopy({ ...query, action: "show" }, gone)).toMatchObject({
      ok: false,
      error: { code: "save_as_copy_missing", details: { path: record.path } },
    });
    expect(gone.mocks.showItemInFolder).not.toHaveBeenCalled();
    const refused = deps({ openPath: () => Promise.resolve("No application is associated") });
    expect(await openSavedCopy({ ...query, action: "open" }, refused)).toMatchObject({
      ok: false,
      error: { code: "save_as_open_failed" },
    });
  });
});
