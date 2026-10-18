/**
 * The Node file system behind "Save as" (D12 F1). The copy is written beside its target as a temp
 * file, flushed to disk (fsync) and renamed over the target: never written in place, so a program
 * reading the old file (a PDF viewer) never sees half a file, and a link at the target is replaced,
 * not written through. A rename refused while another program holds the target (EBUSY, EPERM,
 * EACCES: a PDF viewer, an antivirus scan, a cloud-sync client) is tried again 3 times; then the
 * error goes to the caller, which asks the operator.
 */
import { randomBytes } from "node:crypto";
import { realpath as realpathCallback } from "node:fs";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { SaveAsFs } from "./saveAs";

/** waits between rename attempts while another program holds the target */
export const RENAME_RETRIES_MS = [100, 300, 900] as const;

/** The Windows final path (junctions and 8.3 short names resolved). */
function realpathNative(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    realpathCallback.native(p, (error, resolved) => (error ? reject(error) : resolve(resolved)));
  });
}

export function retriableWriteError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

export interface AtomicWriteOptions {
  retriesMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
}

/** `.<name>.<pid>.<random>.tmp` in the target's own folder (the rename stays on one volume). */
export function tempNameFor(file: string): string {
  const dir = path.win32.dirname(file);
  const base = path.win32.basename(file);
  return path.win32.join(dir, `.${base}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
}

export async function writeFileAtomic(
  file: string,
  bytes: Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const retries = options.retriesMs ?? RENAME_RETRIES_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const move = options.rename ?? rename;
  const tmp = tempNameFor(file);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tmp, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await move(tmp, file);
        return;
      } catch (error) {
        const wait = retries[attempt];
        if (wait === undefined || !retriableWriteError(error)) throw error;
        await sleep(wait);
      }
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** The real file system for saveReportAs. */
export const NODE_SAVE_AS_FS: SaveAsFs = {
  isDirectory: async (dir) => (await stat(dir)).isDirectory(),
  exists: async (file) =>
    stat(file).then(
      () => true,
      () => false,
    ),
  realpath: (p) => realpathNative(p),
  identity: async (p) => {
    const info = await stat(p, { bigint: true });
    return info.ino === 0n ? null : `${info.dev}:${info.ino}`;
  },
  writeAtomic: (file, bytes) => writeFileAtomic(file, bytes),
  readFile: async (file) => new Uint8Array(await readFile(file)),
  stat: async (file) => {
    const info = await stat(file);
    return { size: info.size, mtimeMs: info.mtimeMs };
  },
  remove: (file) => rm(file, { force: true }),
};
