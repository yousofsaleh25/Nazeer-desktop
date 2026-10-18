/**
 * The copies "Save as" wrote (D12 F1): whether the recorded copy of a report version is still
 * there as written, and opening it or showing it in its folder. Only the path main recorded
 * after writing and verifying the copy is ever opened — never a path from the page — and only a
 * `.pdf`. A folder that does not answer (an unreachable network share) counts as "not there"
 * after a short wait, so the page never hangs on it.
 */
import type {
  ExportError,
  OpenSavedRequest,
  OpenSavedResult,
  SavedCopy,
  SavedCopyQuery,
} from "@shared/ipc";
import type { SavedCopyRecord } from "../settings";

export const SAVED_COPY_STAT_TIMEOUT_MS = 2_000;

export interface SavedCopyDeps {
  record(query: SavedCopyQuery): SavedCopyRecord | null;
  /** rejects when the file is not there */
  stat(file: string): Promise<{ size: number; mtimeMs: number }>;
  /** shell.openPath: "" when opened, else the system's error text */
  openPath(file: string): Promise<string>;
  /** shell.showItemInFolder */
  showItemInFolder(file: string): void;
  timeoutMs?: number;
  log?: (line: string) => void;
}

function error(code: string, message: string, details: Record<string, unknown> = {}): ExportError {
  return { status: null, code, message, details };
}

/** The file's size and modification time, or null when it is not there (or does not answer). */
async function statOrNull(
  file: string,
  deps: SavedCopyDeps,
): Promise<{ size: number; mtimeMs: number } | null> {
  const timeout = deps.timeoutMs ?? SAVED_COPY_STAT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((done) => {
    timer = setTimeout(() => {
      deps.log?.(`saved copy: ${file} did not answer within ${timeout} ms`);
      done(null);
    }, timeout);
  });
  try {
    return await Promise.race([deps.stat(file).catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The recorded copy of that report version with `exists` / `changed`; null when none. */
export async function savedCopyStatus(
  query: SavedCopyQuery,
  deps: SavedCopyDeps,
): Promise<SavedCopy | null> {
  const record = deps.record(query);
  if (record === null) return null;
  const now = await statOrNull(record.path, deps);
  return {
    path: record.path,
    savedAt: record.savedAt,
    sha256: record.sha256,
    bytes: record.bytes,
    exists: now !== null,
    changed: now !== null && (now.size !== record.size || now.mtimeMs !== record.mtimeMs),
  };
}

/** Open the recorded copy (its default PDF program) or show it selected in its folder. */
export async function openSavedCopy(
  request: OpenSavedRequest,
  deps: SavedCopyDeps,
): Promise<OpenSavedResult> {
  const record = deps.record(request);
  if (record === null || !record.path.toLowerCase().endsWith(".pdf")) {
    return {
      ok: false,
      error: error("save_as_no_copy", "no saved copy of this report version is recorded"),
    };
  }
  if ((await statOrNull(record.path, deps)) === null) {
    return {
      ok: false,
      error: error("save_as_copy_missing", "the saved copy is no longer there", {
        path: record.path,
      }),
    };
  }
  if (request.action === "show") {
    deps.showItemInFolder(record.path);
    return { ok: true };
  }
  const problem = await deps.openPath(record.path);
  if (problem !== "") {
    return {
      ok: false,
      error: error("save_as_open_failed", `the copy could not be opened: ${problem}`, {
        path: record.path,
      }),
    };
  }
  return { ok: true };
}
