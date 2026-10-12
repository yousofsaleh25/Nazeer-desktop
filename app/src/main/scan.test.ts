import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCAN_LIMITS, scanCaptureFolders } from "./scan";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "nazeer-scan-"));
  dirs.push(dir);
  return dir;
}

function file(p: string, bytes = 10, mtime?: Date): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, Buffer.alloc(bytes));
  if (mtime) utimesSync(p, mtime, mtime);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scanCaptureFolders", () => {
  it("lists .bag files (any case) to depth 3, newest first, with size and folder", async () => {
    const root = tempDir();
    file(path.join(root, "a.bag"), 5, new Date("2026-04-14T10:00:00Z"));
    file(path.join(root, "اختبار", "b.BAG"), 7, new Date("2026-04-15T10:00:00Z"));
    file(path.join(root, "d1", "d2", "d3", "deep.bag"), 1, new Date("2026-04-13T10:00:00Z"));
    file(path.join(root, "d1", "d2", "d3", "d4", "too-deep.bag"));
    file(path.join(root, "notes.txt"));
    file(path.join(root, "x.bag.part"));

    const scan = await scanCaptureFolders([root]);
    expect(scan.bags.map((b) => b.name)).toEqual(["b.BAG", "a.bag", "deep.bag"]);
    expect(scan.bags[0]).toMatchObject({
      path: path.join(root, "اختبار", "b.BAG"),
      sizeBytes: 7,
      modifiedAt: "2026-04-15T10:00:00.000Z",
      folder: root,
    });
    expect(scan.truncated).toBe(true); // d4 lies below the depth limit
    expect(scan.errors).toEqual([]);
  });

  it("never follows a junction (a link to a folder full of bags)", async () => {
    const root = tempDir();
    const elsewhere = tempDir();
    file(path.join(elsewhere, "linked.bag"));
    symlinkSync(elsewhere, path.join(root, "link"), "junction");
    file(path.join(root, "own.bag"));
    const scan = await scanCaptureFolders([root]);
    expect(scan.bags.map((b) => b.name)).toEqual(["own.bag"]);
  });

  it("reports a missing configured folder and still scans the others", async () => {
    const root = tempDir();
    file(path.join(root, "a.bag"));
    const missing = path.join(root, "nope");
    const scan = await scanCaptureFolders([missing, root]);
    expect(scan.bags).toHaveLength(1);
    expect(scan.errors).toHaveLength(1);
    expect(scan.errors[0]?.folder).toBe(missing);
    expect(scan.errors[0]?.message).toMatch(/ENOENT/);
  });

  it("stops at the bag, entry and time limits and says it was truncated", async () => {
    const root = tempDir();
    for (let i = 0; i < 5; i += 1) file(path.join(root, `b${i}.bag`));
    const byBags = await scanCaptureFolders([root], { ...SCAN_LIMITS, maxBags: 3 });
    expect(byBags.bags).toHaveLength(3);
    expect(byBags.truncated).toBe(true);

    const byEntries = await scanCaptureFolders([root], { ...SCAN_LIMITS, maxEntries: 2 });
    expect(byEntries.bags).toHaveLength(2);
    expect(byEntries.truncated).toBe(true);

    let t = 0;
    const byTime = await scanCaptureFolders([root, root], SCAN_LIMITS, () => (t += 2_000));
    expect(byTime.truncated).toBe(true);
  });

  it("lists a bag once when two configured folders overlap", async () => {
    const root = tempDir();
    file(path.join(root, "sub", "a.bag"));
    const scan = await scanCaptureFolders([root, path.join(root, "sub")]);
    expect(scan.bags).toHaveLength(1);
  });
});
