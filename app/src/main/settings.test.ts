import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_SAVED_COPIES,
  parseSavedCopyRecord,
  SETTINGS_FILE_NAME,
  SettingsStore,
  type SavedCopyRecord,
  type SettingsFs,
} from "./settings";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "nazeer-settings-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const EMPTY = { captureFolders: [], lastSaveFolder: null, savedCopies: [] };

function copy(overrides: Partial<SavedCopyRecord> = {}): SavedCopyRecord {
  return {
    kind: "session",
    id: "20261014_101500_abc123",
    version: 1,
    path: "D:\\تقارير\\ناقة-7_2026-10-14.pdf",
    sha256: "a".repeat(64),
    bytes: 2_568_840,
    size: 2_568_840,
    mtimeMs: 1_760_000_000_000,
    savedAt: "2026-10-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("SettingsStore", () => {
  it("starts from the defaults when there is no file", () => {
    expect(new SettingsStore(tempDir()).get()).toEqual(EMPTY);
  });

  it("stores capture folders atomically and reads them back", () => {
    const dir = tempDir();
    const store = new SettingsStore(dir);
    expect(store.setCaptureFolders(["D:\\captures", "d:\\CAPTURES", "E:\\اختبار"])).toEqual([
      "D:\\captures",
      "E:\\اختبار",
    ]);
    const onDisk: unknown = JSON.parse(readFileSync(path.join(dir, SETTINGS_FILE_NAME), "utf8"));
    expect(onDisk).toEqual({ ...EMPTY, captureFolders: ["D:\\captures", "E:\\اختبار"] });
    expect(new SettingsStore(dir).get().captureFolders).toEqual(["D:\\captures", "E:\\اختبار"]);
  });

  it("refuses invalid folders without touching the stored list", () => {
    const store = new SettingsStore(tempDir());
    store.setCaptureFolders(["D:\\captures"]);
    expect(() => store.setCaptureFolders(["relative\\path"])).toThrow();
    expect(store.get().captureFolders).toEqual(["D:\\captures"]);
  });

  it("falls back to the defaults on a damaged file, and says so", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, SETTINGS_FILE_NAME), "{not json", "utf8");
    const lines: string[] = [];
    expect(new SettingsStore(dir, (line) => lines.push(line)).get()).toEqual(EMPTY);
    expect(lines[0]).toContain("using the defaults");
  });

  it("reads each field on its own: one damaged field or record falls back alone", () => {
    const dir = tempDir();
    writeFileSync(
      path.join(dir, SETTINGS_FILE_NAME),
      JSON.stringify({
        captureFolders: ["relative"],
        lastSaveFolder: "D:\\تقارير",
        savedCopies: [copy(), { ...copy({ version: 2 }), sha256: "not a hash" }, 7],
      }),
      "utf8",
    );
    const lines: string[] = [];
    const store = new SettingsStore(dir, (line) => lines.push(line));
    expect(store.get()).toEqual({
      captureFolders: [],
      lastSaveFolder: "D:\\تقارير",
      savedCopies: [copy()],
    });
    expect(lines.join("\n")).toContain("captureFolders");
    expect(lines.join("\n")).toContain("2 saved-copy record(s)");
  });
});

describe("saved copies (D12)", () => {
  it("records a copy and its folder, and finds the newest copy of a report version", () => {
    const dir = tempDir();
    const store = new SettingsStore(dir);
    expect(store.recordSavedCopy(copy())).toBe(true);
    expect(store.get().lastSaveFolder).toBe("D:\\تقارير");
    expect(store.savedCopy("session", "20261014_101500_abc123", 1)).toEqual(copy());
    expect(store.savedCopy("session", "20261014_101500_abc123", 2)).toBeNull();
    // a second copy of the same version replaces the first record
    const again = copy({ path: "E:\\usb\\ناقة.pdf", savedAt: "2026-10-17T11:00:00.000Z" });
    store.recordSavedCopy(again);
    expect(store.savedCopy("session", "20261014_101500_abc123", 1)).toEqual(again);
    expect(store.get().lastSaveFolder).toBe("E:\\usb");
    // and it survives a restart
    expect(new SettingsStore(dir).savedCopy("session", "20261014_101500_abc123", 1)).toEqual(again);
  });

  it("drops the record of another report whose file was written over", () => {
    const store = new SettingsStore(tempDir());
    store.recordSavedCopy(copy({ id: "20261014_101500_aaaaaa" }));
    store.recordSavedCopy(
      copy({ id: "20261014_101500_bbbbbb", path: "d:\\تقارير\\ناقة-7_2026-10-14.PDF" }),
    );
    expect(store.savedCopy("session", "20261014_101500_aaaaaa", 1)).toBeNull();
    expect(store.get().savedCopies).toHaveLength(1);
  });

  it("keeps the newest 500", () => {
    const store = new SettingsStore(tempDir());
    for (let v = 1; v <= MAX_SAVED_COPIES + 3; v += 1) {
      store.recordSavedCopy(copy({ version: v, path: `D:\\r\\${v}.pdf` }));
    }
    const kept = store.get().savedCopies;
    expect(kept).toHaveLength(MAX_SAVED_COPIES);
    expect(kept[0]?.version).toBe(4);
    expect(kept.at(-1)?.version).toBe(MAX_SAVED_COPIES + 3);
  });

  it("refuses an invalid record (a path from nowhere, a non-PDF, a bad hash)", () => {
    const store = new SettingsStore(tempDir());
    for (const bad of [
      copy({ path: "relative.pdf" }),
      copy({ path: "D:\\x.exe" }),
      copy({ sha256: "A".repeat(64) }),
      copy({ id: "../evil" }),
      copy({ version: 0 }),
    ]) {
      expect(() => store.recordSavedCopy(bad)).toThrow();
      expect(parseSavedCopyRecord(bad)).toBeNull();
    }
  });

  it("keeps the record for this run but answers false when the file cannot be written", () => {
    const dir = tempDir();
    // a folder where the temp file should go: every write fails
    mkdirSync(path.join(dir, `${SETTINGS_FILE_NAME}.${process.pid}.tmp`));
    const lines: string[] = [];
    const store = new SettingsStore(dir, (line) => lines.push(line));
    expect(store.recordSavedCopy(copy())).toBe(false);
    expect(store.savedCopy("session", "20261014_101500_abc123", 1)).toEqual(copy());
    expect(lines[0]).toContain("could not be recorded");
  });

  it("tries the rename again while another program holds the file, then gives up", () => {
    const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
    const written = new Map<string, string>();
    let renames = 0;
    let failFirst = 2;
    const fs: SettingsFs = {
      readFile: () => {
        throw Object.assign(new Error("none"), { code: "ENOENT" });
      },
      writeFile: (file, text) => written.set(file, text),
      rename: (from, to) => {
        renames += 1;
        if (failFirst > 0) {
          failFirst -= 1;
          throw busy;
        }
        written.set(to, written.get(from) ?? "");
        written.delete(from);
      },
      remove: (file) => written.delete(file),
    };
    const store = new SettingsStore("C:\\settings", () => undefined, fs);
    expect(store.recordSavedCopy(copy())).toBe(true);
    expect(renames).toBe(3);
    failFirst = 99;
    renames = 0;
    expect(store.recordSavedCopy(copy({ version: 2 }))).toBe(false);
    expect(renames).toBe(4);
    expect([...written.keys()].some((file) => file.endsWith(".tmp"))).toBe(false);
  });
});
