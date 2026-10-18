/**
 * The app's own settings: `<userData>\app-settings.json` (main only; the renderer never reads
 * files). Today: the capture folders the bag scan looks in, and for "Save as" (D12) the folder it
 * used last and the copies it wrote. Each field is read on its own: a missing or damaged field (or
 * one damaged saved-copy record) falls back alone, and the log says so. Writes are atomic (temp
 * file + rename), and the rename is tried again while another program (an antivirus scan) holds
 * the file.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MAX_SAFE_INT, SESSION_ID_RE, SHA256_HEX_RE } from "@shared/ids";
import type { ReportKind } from "@shared/ipc";
import { isAbsolutePathString, validateCaptureFolders } from "@shared/ipcValidate";

/** A copy of a sealed PDF that "Save as" wrote and verified (D12 F1). */
export interface SavedCopyRecord {
  kind: ReportKind;
  id: string;
  version: number;
  path: string;
  sha256: string;
  bytes: number;
  /** the file's size and modification time right after writing (a later change shows) */
  size: number;
  mtimeMs: number;
  /** ISO 8601 */
  savedAt: string;
}

export interface AppSettings {
  captureFolders: string[];
  /** the folder "Save as" wrote to last (the next Save dialog opens there) */
  lastSaveFolder: string | null;
  /** the newest copy per report version, newest last */
  savedCopies: SavedCopyRecord[];
}

export const SETTINGS_FILE_NAME = "app-settings.json";
export const MAX_SAVED_COPIES = 500;
/** waits between rename attempts while the settings file is held (then the write fails) */
export const SETTINGS_RENAME_RETRIES_MS = [50, 150, 450] as const;

const ISO_INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

function defaults(): AppSettings {
  return { captureFolders: [], lastSaveFolder: null, savedCopies: [] };
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** One saved-copy record as stored, or null when any field is wrong. */
export function parseSavedCopyRecord(value: unknown): SavedCopyRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const { kind, id, version, path: file, sha256, bytes, size, mtimeMs, savedAt } = r;
  if (kind !== "session" && kind !== "comparison") return null;
  if (typeof id !== "string" || !SESSION_ID_RE.test(id)) return null;
  if (!count(version) || version < 1 || version > MAX_SAFE_INT) return null;
  if (!isAbsolutePathString(file) || !file.toLowerCase().endsWith(".pdf")) return null;
  if (typeof sha256 !== "string" || !SHA256_HEX_RE.test(sha256)) return null;
  if (!count(bytes) || !count(size)) return null;
  if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs) || mtimeMs < 0) return null;
  if (typeof savedAt !== "string" || !ISO_INSTANT.test(savedAt)) return null;
  return { kind, id, version, path: file, sha256, bytes, size, mtimeMs, savedAt };
}

/** Synchronous pause (the settings are written synchronously from IPC handlers). */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function retriable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

export interface SettingsFs {
  readFile(file: string): string;
  writeFile(file: string, text: string): void;
  rename(from: string, to: string): void;
  remove(file: string): void;
}

const NODE_FS: SettingsFs = {
  readFile: (file) => readFileSync(file, "utf8"),
  writeFile: (file, text) => writeFileSync(file, text, "utf8"),
  rename: (from, to) => renameSync(from, to),
  remove: (file) => rmSync(file, { force: true }),
};

export class SettingsStore {
  readonly file: string;
  private current: AppSettings;

  constructor(
    dir: string,
    private readonly log: (line: string) => void = () => undefined,
    private readonly fs: SettingsFs = NODE_FS,
  ) {
    this.file = path.join(dir, SETTINGS_FILE_NAME);
    this.current = this.load();
  }

  get(): AppSettings {
    return {
      captureFolders: [...this.current.captureFolders],
      lastSaveFolder: this.current.lastSaveFolder,
      savedCopies: this.current.savedCopies.map((record) => ({ ...record })),
    };
  }

  setCaptureFolders(folders: string[]): string[] {
    const next: AppSettings = { ...this.current, captureFolders: validateCaptureFolders(folders) };
    this.write(next);
    this.current = next;
    return [...next.captureFolders];
  }

  /** The newest recorded copy of that report version, or null. */
  savedCopy(kind: ReportKind, id: string, version: number): SavedCopyRecord | null {
    for (let i = this.current.savedCopies.length - 1; i >= 0; i -= 1) {
      const record = this.current.savedCopies[i];
      if (record?.kind === kind && record.id === id && record.version === version) {
        return { ...record };
      }
    }
    return null;
  }

  /**
   * Remember a copy "Save as" wrote and verified, and its folder for the next dialog. One record
   * per report version (the newest); a copy written over another recorded path replaces that
   * record (the older file is gone); the newest 500 are kept. The app keeps the record for this
   * run even when the file cannot be written; then it returns false (the copy itself is fine).
   */
  recordSavedCopy(record: SavedCopyRecord): boolean {
    const parsed = parseSavedCopyRecord(record);
    if (parsed === null) throw new Error("the saved-copy record is not valid");
    const samePath = parsed.path.toLowerCase();
    const others = this.current.savedCopies.filter(
      (r) =>
        r.path.toLowerCase() !== samePath &&
        !(r.kind === parsed.kind && r.id === parsed.id && r.version === parsed.version),
    );
    const savedCopies = [...others, parsed].slice(-MAX_SAVED_COPIES);
    const next: AppSettings = {
      ...this.current,
      lastSaveFolder: path.win32.dirname(parsed.path),
      savedCopies,
    };
    this.current = next;
    try {
      this.write(next);
      return true;
    } catch (error) {
      this.log(`settings: the saved copy could not be recorded in ${this.file} (${String(error)})`);
      return false;
    }
  }

  private write(next: AppSettings): void {
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      this.fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
      for (let attempt = 0; ; attempt += 1) {
        try {
          this.fs.rename(tmp, this.file);
          return;
        } catch (error) {
          const wait = SETTINGS_RENAME_RETRIES_MS[attempt];
          if (wait === undefined || !retriable(error)) throw error;
          pause(wait);
        }
      }
    } catch (error) {
      try {
        this.fs.remove(tmp);
      } catch {
        // the temp file stays behind; the next write replaces it
      }
      throw error;
    }
  }

  private load(): AppSettings {
    let raw: string;
    try {
      raw = this.fs.readFile(this.file);
    } catch {
      return defaults();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.log(`settings: ${this.file} is not valid JSON (${String(error)}); using the defaults`);
      return defaults();
    }
    const record =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const out = defaults();
    try {
      out.captureFolders = validateCaptureFolders(record["captureFolders"] ?? []);
    } catch (error) {
      this.log(
        `settings: captureFolders in ${this.file} is not valid (${String(error)}); using the defaults`,
      );
    }
    const folder = record["lastSaveFolder"];
    if (isAbsolutePathString(folder)) out.lastSaveFolder = folder;
    else if (folder !== undefined && folder !== null) {
      this.log(`settings: lastSaveFolder in ${this.file} is not an absolute path; ignored`);
    }
    const copies = record["savedCopies"];
    if (Array.isArray(copies)) {
      const kept = copies.map(parseSavedCopyRecord);
      const dropped = kept.filter((r) => r === null).length;
      if (dropped > 0) {
        this.log(
          `settings: ${dropped} saved-copy record(s) in ${this.file} are not valid; dropped`,
        );
      }
      out.savedCopies = kept
        .filter((r): r is SavedCopyRecord => r !== null)
        .slice(-MAX_SAVED_COPIES);
    } else if (copies !== undefined) {
      this.log(`settings: savedCopies in ${this.file} is not a list; ignored`);
    }
    return out;
  }
}
