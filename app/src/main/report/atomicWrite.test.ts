import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RENAME_RETRIES_MS,
  retriableWriteError,
  tempNameFor,
  writeFileAtomic,
} from "./atomicWrite";

const dirs: string[] = [];
function tempDir(): string {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "nazeer-atomic-")), "مجلد عربي");
  mkdirSync(dir);
  dirs.push(path.dirname(dir));
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const BYTES = new TextEncoder().encode("%PDF-1.7 copy");
const noWait = () => Promise.resolve();

describe("writeFileAtomic", () => {
  it("writes into an Arabic folder, replaces an older file, and leaves no temp file", async () => {
    const dir = tempDir();
    const file = path.join(dir, "ناقة-7_2026-10-14.pdf");
    writeFileSync(file, "older and longer contents");
    await writeFileAtomic(file, BYTES);
    expect(new Uint8Array(readFileSync(file))).toEqual(BYTES);
    expect(readdirSync(dir)).toEqual(["ناقة-7_2026-10-14.pdf"]);
  });

  it("writes the temp file beside the target, then renames it over the target", async () => {
    const dir = tempDir();
    const file = path.join(dir, "a.pdf");
    const moves: [string, string][] = [];
    await writeFileAtomic(file, BYTES, {
      rename: async (from, to) => {
        moves.push([from, to]);
        // the temp file holds the full bytes before the rename
        expect(new Uint8Array(readFileSync(from))).toEqual(BYTES);
        await rename(from, to);
      },
    });
    expect(moves).toHaveLength(1);
    const [from, to] = moves[0] ?? ["", ""];
    expect(to).toBe(file);
    expect(path.dirname(from)).toBe(dir);
    expect(path.basename(from)).toMatch(/^\.a\.pdf\.\d+\.[0-9a-f]{8}\.tmp$/);
    expect(tempNameFor(file)).not.toBe(tempNameFor(file));
  });

  it("tries the rename again while another program holds the target", async () => {
    const dir = tempDir();
    const file = path.join(dir, "a.pdf");
    const busy = Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    let left = 2;
    const sleep = vi.fn<(ms: number) => Promise<void>>(noWait);
    await writeFileAtomic(file, BYTES, {
      sleep,
      rename: (from, to) => {
        if (left > 0) {
          left -= 1;
          return Promise.reject(busy);
        }
        return rename(from, to);
      },
    });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
      RENAME_RETRIES_MS[0],
      RENAME_RETRIES_MS[1],
    ]);
    expect(new Uint8Array(readFileSync(file))).toEqual(BYTES);
  });

  it("gives up after the retries (or at once for another error) and removes the temp file", async () => {
    const dir = tempDir();
    const file = path.join(dir, "a.pdf");
    const held = Object.assign(new Error("EPERM"), { code: "EPERM" });
    const attempts = vi.fn(() => Promise.reject(held));
    await expect(writeFileAtomic(file, BYTES, { sleep: noWait, rename: attempts })).rejects.toBe(
      held,
    );
    expect(attempts).toHaveBeenCalledTimes(RENAME_RETRIES_MS.length + 1);
    expect(readdirSync(dir)).toEqual([]);

    const gone = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const once = vi.fn(() => Promise.reject(gone));
    await expect(writeFileAtomic(file, BYTES, { sleep: noWait, rename: once })).rejects.toBe(gone);
    expect(once).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("fails for a folder that does not exist (nothing is created)", async () => {
    const missing = path.join(tempDir(), "لا يوجد", "a.pdf");
    await expect(writeFileAtomic(missing, BYTES)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("knows which errors are worth a retry", () => {
    expect(retriableWriteError({ code: "EBUSY" })).toBe(true);
    expect(retriableWriteError({ code: "EPERM" })).toBe(true);
    expect(retriableWriteError({ code: "EACCES" })).toBe(true);
    expect(retriableWriteError({ code: "ENOSPC" })).toBe(false);
    expect(retriableWriteError(null)).toBe(false);
  });
});
