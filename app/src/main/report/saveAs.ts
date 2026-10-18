/**
 * "Save as" for a sealed PDF (D12 F1): main's half. The renderer names the report and suggests a
 * file name; main reads what the engine sealed — for a session `session.json` as a file (no
 * depth-lookup context, unlike `GET /sessions/{id}`), for a comparison its view (which builds none);
 * then the manifest —, fetches the PDF and checks its SHA-256, asks where
 * to save it (the operator window's Save dialog, or the development test switch), forces `.pdf`,
 * refuses the engine's data root, writes the copy atomically, reads it back and checks it again,
 * and records it in app-settings.json. Expected failures resolve with a coded answer; nothing
 * throws. Orchestration only: the engine, the dialogs and the file system are injected
 * (unit-tested in saveAs.test.ts; the Node file system is in atomicWrite.ts).
 *
 * Electron 44 on Windows (measured 2026-10-17): the Save dialog asks "Confirm Save As" before it
 * returns an existing file, and appends the filter's `.pdf` to a name typed without an extension;
 * a name with another extension ("x.txt") comes back unchanged, so main appends `.pdf` and asks
 * itself when that file exists. A file is never replaced silently.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { ensurePdfExtension, sanitizeSuggestedName } from "@shared/fileNames";
import type { EngineConnection, ExportError, SaveAsRequest, SaveAsResult } from "@shared/ipc";
import { call, json, type Fetched } from "../print/exportPdf";
import type { SavedCopyRecord } from "../settings";

/** What the operator is told when the copy could not be written (main's message box). */
export type WriteProblem = "busy" | "denied" | "other";
export type AfterWriteFailure = "retry" | "elsewhere" | "cancel";

export interface SaveAsDialogs {
  /** The Save dialog: the chosen path, or null when cancelled (`attempt` 0 = this save's first). */
  choosePath(defaultPath: string, attempt: number): Promise<string | null>;
  /** Main added ".pdf" and a file of that name exists: replace it? */
  confirmReplace(file: string): Promise<boolean>;
  /** The chosen folder is inside the engine's data root. */
  insideDataRoot(file: string): Promise<"elsewhere" | "cancel">;
  /** The copy could not be written, even after the retries. */
  writeFailed(problem: WriteProblem, file: string, detail: string): Promise<AfterWriteFailure>;
}

export interface SaveAsFs {
  isDirectory(dir: string): Promise<boolean>;
  exists(file: string): Promise<boolean>;
  realpath(p: string): Promise<string>;
  /** the folder's identity (volume serial + file id), null when unknown */
  identity(p: string): Promise<string | null>;
  /** temp file in the target's folder → write → fsync → close → rename (retried while held) */
  writeAtomic(file: string, bytes: Uint8Array): Promise<void>;
  readFile(file: string): Promise<Uint8Array>;
  stat(file: string): Promise<{ size: number; mtimeMs: number }>;
  remove(file: string): Promise<void>;
}

export interface SaveAsDeps {
  connection(): EngineConnection | null;
  fetch: typeof fetch;
  /** the engine's data root (copies are never written inside it) */
  dataRoot: string;
  /** where the first Save dialog opens when no folder was used yet */
  documentsDir: string;
  lastSaveFolder(): string | null;
  /** remember the copy; false when the record could not be stored (the copy is fine) */
  record(copy: SavedCopyRecord): boolean;
  dialogs: SaveAsDialogs;
  fs: SaveAsFs;
  now?: () => Date;
  log?: (line: string) => void;
}

/** A safety net against a dialog that keeps answering the same refused path. */
export const MAX_SAVE_DIALOGS = 20;

function failure(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): SaveAsResult {
  return { state: "failed", error: { status: null, code, message, details } };
}

function failed(error: ExportError): SaveAsResult {
  return { state: "failed", error };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface Sealed {
  version: number;
  file: string;
  sha256: string;
  bytes: Uint8Array;
}

/** What the engine records as sealed for the report, and where to read its manifest and bytes. */
interface SealedRecord {
  version: number;
  file: string;
  sha256: string;
  manifestPath: string | null;
  reportPath: string;
}

/** A session's sealed report, from `session.json` (read as a file). */
async function sessionRecord(
  request: SaveAsRequest,
  conn: EngineConnection,
  deps: SaveAsDeps,
): Promise<{ record: SealedRecord | null } | { error: SaveAsResult }> {
  const id = encodeURIComponent(request.id);
  const doc: Fetched = await call(deps, conn, `/sessions/${id}/assets/session.json`);
  if (!doc.ok) return { error: failed(doc.error) };
  const parsed = json(doc.bytes);
  const outputs = isRecord(parsed) && isRecord(parsed["outputs"]) ? parsed["outputs"] : null;
  if (outputs === null) {
    return { error: failure("invalid_response", "the session's session.json is not readable") };
  }
  const version = outputs["report_version"];
  const file = outputs["report_file"];
  const sha256 = outputs["report_sha256"];
  if (
    typeof version !== "number" ||
    version < 1 ||
    typeof file !== "string" ||
    typeof sha256 !== "string"
  ) {
    return { record: null };
  }
  return {
    record: {
      version,
      file,
      sha256,
      manifestPath: `/sessions/${id}/assets/report.manifest.json`,
      reportPath: `/sessions/${id}/report?v=${version}`,
    },
  };
}

/** A comparison's sealed report, from its view (D12: the view reads no frame). */
async function comparisonRecord(
  request: SaveAsRequest,
  conn: EngineConnection,
  deps: SaveAsDeps,
): Promise<{ record: SealedRecord | null } | { error: SaveAsResult }> {
  const id = encodeURIComponent(request.id);
  const view: Fetched = await call(deps, conn, `/comparisons/${id}`);
  if (!view.ok) return { error: failed(view.error) };
  const parsed = json(view.bytes);
  const outputs = isRecord(parsed) && isRecord(parsed["outputs"]) ? parsed["outputs"] : null;
  if (outputs === null) {
    return { error: failure("invalid_response", "the engine's comparison view is not readable") };
  }
  const report = outputs["report"];
  if (
    !isRecord(report) ||
    typeof report["version"] !== "number" ||
    report["version"] < 1 ||
    typeof report["file"] !== "string" ||
    typeof report["sha256"] !== "string"
  ) {
    return { record: null };
  }
  const manifest = outputs["manifest_url"];
  return {
    record: {
      version: report["version"],
      file: report["file"],
      sha256: report["sha256"],
      manifestPath: typeof manifest === "string" ? manifest : null,
      reportPath: `/comparisons/${id}/report?v=${report["version"]}`,
    },
  };
}

/** The sealed report the request names, its bytes checked against the engine's records. */
async function readSealed(
  request: SaveAsRequest,
  conn: EngineConnection,
  deps: SaveAsDeps,
): Promise<{ sealed: Sealed } | { error: SaveAsResult }> {
  const read =
    request.kind === "comparison"
      ? await comparisonRecord(request, conn, deps)
      : await sessionRecord(request, conn, deps);
  if ("error" in read) return read;
  if (read.record === null) {
    return { error: failure("save_as_no_report", `this ${request.kind} has no sealed report`) };
  }
  const { version, file, sha256 } = read.record;
  if (version !== request.version) {
    return {
      error: failure(
        "save_as_report_changed",
        `the sealed report is version ${version} now, not ${request.version}`,
        { requested: request.version, current: version },
      ),
    };
  }
  // the manifest names the same PDF unless the session was finalized again since (files.pdf null);
  // without a manifest the engine's fingerprint alone checks the bytes
  const manifest =
    read.record.manifestPath === null ? null : await call(deps, conn, read.record.manifestPath);
  if (manifest?.ok === true) {
    const record = json(manifest.bytes);
    const pdf =
      isRecord(record) && isRecord(record["files"]) && isRecord(record["files"]["pdf"])
        ? record["files"]["pdf"]
        : null;
    if (pdf !== null && pdf["file"] === file && pdf["sha256"] !== sha256) {
      return {
        error: failure(
          "save_as_report_mismatch",
          `the manifest and the ${request.kind}'s record name different fingerprints for the ` +
            "sealed report",
          { file, recorded: sha256, manifest: pdf["sha256"] },
        ),
      };
    }
  } else if (manifest?.ok === false && manifest.error.status !== 404) {
    return { error: failed(manifest.error) };
  }
  const pdf = await call(deps, conn, read.record.reportPath, { timeoutMs: 120_000 });
  if (!pdf.ok) return { error: failed(pdf.error) };
  const computed = sha256Hex(pdf.bytes);
  if (computed !== sha256) {
    return {
      error: failure(
        "save_as_report_mismatch",
        "the sealed report's bytes do not match the engine's fingerprint",
        { file, expected: sha256, computed },
      ),
    };
  }
  return { sealed: { version, file, sha256, bytes: pdf.bytes } };
}

/** `\\?\C:\x` → `C:\x`, `\\?\UNC\server\share` → `\\server\share`. */
function plainPath(p: string): string {
  return p.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
}

/** `child` is `parent` or below it (Windows paths: case-insensitive, either separator). */
export function isInsideFolder(child: string, parent: string): boolean {
  const relative = path.win32.relative(
    plainPath(parent).toLowerCase(),
    plainPath(child).toLowerCase(),
  );
  // ".." or "..\x" leaves the parent; a child folder named "..x" does not
  const leaves =
    relative === ".." ||
    relative.startsWith("..\\") ||
    relative.startsWith("../") ||
    path.win32.isAbsolute(relative);
  return !leaves;
}

/**
 * The chosen file's folder inside the data root? By path (junctions and 8.3 names resolved), then
 * by identity: a share of this machine (`\\localhost\E$\…`, a mapped drive) keeps its UNC path
 * through realpath but has the data root's volume serial and file id at one of its folders.
 */
async function insideDataRoot(file: string, deps: SaveAsDeps): Promise<boolean> {
  const folder = path.win32.dirname(file);
  const real = await deps.fs.realpath(folder).catch(() => folder);
  const root = await deps.fs.realpath(deps.dataRoot).catch(() => deps.dataRoot);
  if (isInsideFolder(real, root) || isInsideFolder(folder, deps.dataRoot)) return true;
  const rootId = await deps.fs.identity(root).catch(() => null);
  if (rootId === null) return false;
  for (let dir = real; ;) {
    if ((await deps.fs.identity(dir).catch(() => null)) === rootId) return true;
    const parent = path.win32.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export function writeProblem(error: unknown): WriteProblem {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "EBUSY") return "busy";
  if (code === "EPERM" || code === "EACCES" || code === "EROFS") return "denied";
  return "other";
}

async function defaultFolder(deps: SaveAsDeps): Promise<string> {
  const last = deps.lastSaveFolder();
  if (last !== null && (await deps.fs.isDirectory(last).catch(() => false))) return last;
  return deps.documentsDir;
}

/** Ask, write, verify: the copy written and recorded, the operator's cancel, or why it failed. */
async function writeCopy(
  request: SaveAsRequest,
  sealed: Sealed,
  deps: SaveAsDeps,
): Promise<SaveAsResult> {
  const log = deps.log ?? (() => undefined);
  const name = sanitizeSuggestedName(request.suggestedName);
  let folder = await defaultFolder(deps);
  for (let attempt = 0; attempt < MAX_SAVE_DIALOGS; attempt += 1) {
    const chosen = await deps.dialogs.choosePath(path.win32.join(folder, name), attempt);
    if (chosen === null) return { state: "cancelled" };
    const target = ensurePdfExtension(chosen);
    folder = path.win32.dirname(target);
    if (
      target !== chosen &&
      (await deps.fs.exists(target)) &&
      !(await deps.dialogs.confirmReplace(target))
    ) {
      continue;
    }
    if (await insideDataRoot(target, deps)) {
      if ((await deps.dialogs.insideDataRoot(target)) === "elsewhere") continue;
      return { state: "cancelled" };
    }
    let written = false;
    let elsewhere = false;
    while (!written) {
      try {
        await deps.fs.writeAtomic(target, sealed.bytes);
        written = true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const problem = writeProblem(error);
        log(`save-as ${request.id} v${sealed.version}: writing ${target} failed (${detail})`);
        const answer = await deps.dialogs.writeFailed(problem, target, detail);
        if (answer === "retry") continue;
        if (answer === "elsewhere") {
          elsewhere = true;
          break;
        }
        return failure("save_as_write_failed", `the copy could not be written: ${detail}`, {
          path: target,
          problem,
        });
      }
    }
    if (elsewhere) continue;
    // read the copy back: what is on disk must be the sealed report, byte for byte
    let check: string;
    try {
      check = sha256Hex(await deps.fs.readFile(target));
    } catch (error) {
      check = `unreadable: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (check !== sealed.sha256) {
      await deps.fs.remove(target).catch(() => undefined);
      return failure(
        "save_as_copy_mismatch",
        "the written copy does not match the sealed report; it was removed",
        { path: target, expected: sealed.sha256, found: check },
      );
    }
    const stat = await deps.fs
      .stat(target)
      .catch(() => ({ size: sealed.bytes.byteLength, mtimeMs: 0 }));
    const savedAt = (deps.now?.() ?? new Date()).toISOString();
    let recorded = false;
    try {
      recorded = deps.record({
        kind: request.kind,
        id: request.id,
        version: sealed.version,
        path: target,
        sha256: sealed.sha256,
        bytes: sealed.bytes.byteLength,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        savedAt,
      });
    } catch (error) {
      log(`save-as ${request.id}: the copy's record was refused (${String(error)})`);
    }
    log(`save-as ${request.id} v${sealed.version}: ${sealed.bytes.byteLength} bytes to ${target}`);
    return {
      state: "saved",
      path: target,
      version: sealed.version,
      bytes: sealed.bytes.byteLength,
      sha256: sealed.sha256,
      savedAt,
      recorded,
    };
  }
  return { state: "cancelled" };
}

export async function saveReportAs(
  request: SaveAsRequest,
  deps: SaveAsDeps,
): Promise<SaveAsResult> {
  const conn = deps.connection();
  if (conn === null) return failure("engine_not_ready", "the engine is not connected");
  const read = await readSealed(request, conn, deps);
  if ("error" in read) return read.error;
  return writeCopy(request, read.sealed, deps);
}

/** One save at a time: a second request while a Save dialog is open is refused. */
export function oneSaveAtATime(
  run: (request: SaveAsRequest) => Promise<SaveAsResult>,
): (request: SaveAsRequest) => Promise<SaveAsResult> {
  let busy = false;
  return async (request) => {
    if (busy) return failure("save_as_busy", "another Save dialog is open");
    busy = true;
    try {
      return await run(request);
    } finally {
      busy = false;
    }
  };
}

/**
 * The development test switch `NAZEER_E2E_SAVE_DIALOG` (D12; production builds never read it):
 * `cancel`, `file:<absolute path>` or `folder:<absolute folder>` (the suggested name inside it).
 * It answers only this save's first dialog (a refused path ends the save as cancelled) and never
 * replaces a file main would have asked about. Everything after the dialog runs as usual.
 */
export function testSaveDialogs(value: string, log: (line: string) => void): SaveAsDialogs {
  const absolute = (p: string) => /^([A-Za-z]:[\\/]|\\\\)/.test(p);
  const file = value.startsWith("file:") ? value.slice(5) : null;
  const folder = value.startsWith("folder:") ? value.slice(7) : null;
  return {
    choosePath: (defaultPath, attempt) => {
      log(`save-as test dialog (${value}): default ${defaultPath}`);
      if (attempt > 0) return Promise.resolve(null);
      if (file !== null && absolute(file)) return Promise.resolve(file);
      if (folder !== null && absolute(folder)) {
        return Promise.resolve(path.win32.join(folder, path.win32.basename(defaultPath)));
      }
      return Promise.resolve(null);
    },
    confirmReplace: () => Promise.resolve(false),
    insideDataRoot: () => Promise.resolve("cancel"),
    writeFailed: () => Promise.resolve("cancel"),
  };
}
