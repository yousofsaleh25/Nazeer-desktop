/**
 * The bounded capture-folder scan (C2 bag discovery, D9): lists `.bag` files under the configured
 * folders by path and stat only (the renderer never reads a bag; the engine opens it). Bounded:
 * depth ≤ 3 below each folder, ≤ 2 000 directory entries in total, ≤ 200 bags, ≤ 3 s — the time
 * bound holds even while one listing hangs (an unreachable network share): the scan stops waiting
 * for it; links and junctions are never followed. Hitting any bound sets `truncated`. Newest bags
 * first.
 */
import { readdir, stat } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import type { CaptureScan, ScannedBag } from "@shared/ipc";

/** The two file-system calls the scan makes (tests replace them). */
export interface ScanFs {
  readdir(dir: string): Promise<Dirent[]>;
  stat(file: string): Promise<Stats>;
}

const NODE_FS: ScanFs = {
  readdir: (dir) => readdir(dir, { withFileTypes: true }),
  stat: (file) => stat(file),
};

const TIMED_OUT = Symbol("timed out");

/**
 * The call's answer, or TIMED_OUT once the scan's remaining time has passed. A file-system call
 * cannot be cancelled: it ends in the background, and its answer (or error) is dropped.
 */
async function within<T>(work: Promise<T>, remainingMs: number): Promise<T | typeof TIMED_OUT> {
  work.catch(() => undefined);
  if (remainingMs <= 0) return TIMED_OUT;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), remainingMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface ScanLimits {
  maxDepth: number;
  maxEntries: number;
  maxBags: number;
  timeBudgetMs: number;
}

export const SCAN_LIMITS: ScanLimits = {
  maxDepth: 3,
  maxEntries: 2_000,
  maxBags: 200,
  timeBudgetMs: 3_000,
};

export async function scanCaptureFolders(
  folders: readonly string[],
  limits: ScanLimits = SCAN_LIMITS,
  now: () => number = Date.now,
  fs: ScanFs = NODE_FS,
): Promise<CaptureScan> {
  const started = now();
  const remaining = () => limits.timeBudgetMs - (now() - started);
  const bags: ScannedBag[] = [];
  const seen = new Set<string>();
  const errors: CaptureScan["errors"] = [];
  let entries = 0;
  let truncated = false;

  scan: for (const folder of folders) {
    const queue: { dir: string; depth: number }[] = [{ dir: folder, depth: 0 }];
    while (queue.length > 0) {
      if (remaining() < 0) {
        truncated = true;
        break scan;
      }
      const { dir, depth } = queue.shift()!;
      let dirents;
      try {
        dirents = await within(fs.readdir(dir), remaining());
      } catch (error) {
        // a folder the operator configured is reported; an unreadable subfolder is skipped
        if (depth === 0) errors.push({ folder, message: (error as Error).message });
        continue;
      }
      if (dirents === TIMED_OUT) {
        if (depth === 0) {
          errors.push({ folder, message: `no answer within ${limits.timeBudgetMs} ms` });
        }
        truncated = true;
        break scan;
      }
      for (const dirent of dirents) {
        entries += 1;
        if (entries > limits.maxEntries) {
          truncated = true;
          break scan;
        }
        if (dirent.isSymbolicLink()) continue; // Windows junctions are reported as links too
        const full = path.join(dir, dirent.name);
        if (dirent.isDirectory()) {
          if (depth < limits.maxDepth) queue.push({ dir: full, depth: depth + 1 });
          else truncated = true;
          continue;
        }
        if (!dirent.isFile() || !dirent.name.toLowerCase().endsWith(".bag")) continue;
        const key = full.toLowerCase();
        if (seen.has(key)) continue;
        if (bags.length >= limits.maxBags) {
          truncated = true;
          break scan;
        }
        try {
          const info = await within(fs.stat(full), remaining());
          if (info === TIMED_OUT) {
            truncated = true;
            break scan;
          }
          seen.add(key);
          bags.push({
            path: full,
            name: dirent.name,
            sizeBytes: info.size,
            modifiedAt: info.mtime.toISOString(),
            folder,
          });
        } catch {
          // vanished between the listing and the stat
        }
      }
    }
  }

  bags.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.path.localeCompare(b.path));
  return { folders: [...folders], bags, truncated, elapsedMs: now() - started, errors };
}
