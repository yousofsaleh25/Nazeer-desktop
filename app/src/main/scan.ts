/**
 * The bounded capture-folder scan (C2 bag discovery, D9): lists `.bag` files under the configured
 * folders by path and stat only (the renderer never reads a bag; the engine opens it). Bounded:
 * depth ≤ 3 below each folder, ≤ 2 000 directory entries in total, ≤ 200 bags, ≤ 3 s; links and
 * junctions are never followed. Hitting any bound sets `truncated`. Newest bags first.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { CaptureScan, ScannedBag } from "@shared/ipc";

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
): Promise<CaptureScan> {
  const started = now();
  const bags: ScannedBag[] = [];
  const seen = new Set<string>();
  const errors: CaptureScan["errors"] = [];
  let entries = 0;
  let truncated = false;

  scan: for (const folder of folders) {
    const queue: { dir: string; depth: number }[] = [{ dir: folder, depth: 0 }];
    while (queue.length > 0) {
      if (now() - started > limits.timeBudgetMs) {
        truncated = true;
        break scan;
      }
      const { dir, depth } = queue.shift()!;
      let dirents;
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        // a folder the operator configured is reported; an unreadable subfolder is skipped
        if (depth === 0) errors.push({ folder, message: (error as Error).message });
        continue;
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
          const info = await stat(full);
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
