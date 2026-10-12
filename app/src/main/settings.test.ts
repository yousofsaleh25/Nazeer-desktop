import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS_FILE_NAME, SettingsStore } from "./settings";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "nazeer-settings-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SettingsStore", () => {
  it("starts from the defaults when there is no file", () => {
    expect(new SettingsStore(tempDir()).get()).toEqual({ captureFolders: [] });
  });

  it("stores capture folders atomically and reads them back", () => {
    const dir = tempDir();
    const store = new SettingsStore(dir);
    expect(store.setCaptureFolders(["D:\\captures", "d:\\CAPTURES", "E:\\اختبار"])).toEqual([
      "D:\\captures",
      "E:\\اختبار",
    ]);
    const onDisk: unknown = JSON.parse(readFileSync(path.join(dir, SETTINGS_FILE_NAME), "utf8"));
    expect(onDisk).toEqual({ captureFolders: ["D:\\captures", "E:\\اختبار"] });
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
    writeFileSync(path.join(dir, SETTINGS_FILE_NAME), '{"captureFolders": ["relative"]}', "utf8");
    const lines: string[] = [];
    expect(new SettingsStore(dir, (line) => lines.push(line)).get()).toEqual({
      captureFolders: [],
    });
    expect(lines[0]).toContain("using the defaults");
  });
});
