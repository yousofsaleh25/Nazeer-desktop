import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LICENSE_FILE_NAME, LicenseStore, MAX_MARKER_BYTES } from "./store";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "nazeer-license-store-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("LicenseStore", () => {
  it("reads nothing before activation, then the written marker", () => {
    const dir = tempDir();
    const store = new LicenseStore(dir);
    expect(store.read()).toBeNull();
    store.write("NZL1.a.b", new Date("2026-10-12T12:00:00Z"));
    expect(store.read()).toEqual({
      v: 1,
      key: "NZL1.a.b",
      activatedAt: "2026-10-12T12:00:00.000Z",
    });
    expect(readdirSync(dir)).toEqual([LICENSE_FILE_NAME]); // no temp file left behind
  });

  it("ignores a damaged, wrongly shaped or oversized marker and says so", () => {
    const dir = tempDir();
    const lines: string[] = [];
    const store = new LicenseStore(dir, (line) => lines.push(line));
    const file = path.join(dir, LICENSE_FILE_NAME);
    for (const content of [
      "{not json",
      JSON.stringify({ v: 2, key: "NZL1.a.b", activatedAt: "x" }),
      JSON.stringify({ v: 1, key: "", activatedAt: "x" }),
      JSON.stringify({ v: 1, key: "k".repeat(5000), activatedAt: "x" }),
      JSON.stringify([1]),
    ]) {
      writeFileSync(file, content, "utf8");
      expect(store.read(), content.slice(0, 30)).toBeNull();
    }
    writeFileSync(file, " ".repeat(MAX_MARKER_BYTES + 1), "utf8");
    expect(store.read()).toBeNull();
    expect(lines).toHaveLength(6);
    expect(lines.at(-1)).toContain("ignored");
  });

  it("a write into a missing folder throws (the service reports 'not saved')", () => {
    const store = new LicenseStore(path.join(tempDir(), "missing"));
    expect(() => store.write("NZL1.a.b", new Date())).toThrow();
    expect(existsSync(store.file)).toBe(false);
  });
});
