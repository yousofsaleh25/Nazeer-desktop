import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RotatingLog } from "./logs";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "nazeer-log-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("RotatingLog", () => {
  it("appends timestamped lines with their source, creating the folder", () => {
    const dir = path.join(tempDir(), "logs");
    const log = new RotatingLog(dir);
    log.write("supervisor", "start #1");
    log.write("engine", "INFO serving\n");
    const lines = readFileSync(log.file, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z \[supervisor\] start #1$/);
    expect(lines[1]).toMatch(/\[engine\] INFO serving$/);
  });

  it("rotates once to .1 when the next line would pass the size limit", () => {
    const dir = tempDir();
    const log = new RotatingLog(dir, 200);
    for (let i = 0; i < 6; i += 1) log.write("engine", `line ${i} ${"x".repeat(40)}`);
    expect(existsSync(`${log.file}.1`)).toBe(true);
    const current = readFileSync(log.file, "utf8");
    expect(Buffer.byteLength(current)).toBeLessThanOrEqual(200);
    expect(current).toContain("line 5");
    expect(readFileSync(`${log.file}.1`, "utf8")).not.toContain("line 5");
  });

  it("continues an existing file's size count across restarts of the app", () => {
    const dir = tempDir();
    new RotatingLog(dir, 150).write("supervisor", "a".repeat(100));
    const again = new RotatingLog(dir, 150);
    again.write("supervisor", "b".repeat(100));
    expect(readFileSync(`${again.file}.1`, "utf8")).toContain("a".repeat(100));
  });
});
