/**
 * The activation marker (D11): `<userData>\app-license.json` = `{v: 1, key, activatedAt}`. The
 * key inside is verified again at every start (the marker itself proves nothing). Written
 * atomically (temp file + rename); a missing, oversized or damaged file reads as no marker, with
 * a log line for the last two.
 */
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MAX_LICENSE_INPUT_CHARS } from "@shared/ipcValidate";

export const LICENSE_FILE_NAME = "app-license.json";
export const MAX_MARKER_BYTES = 64 * 1024;

export interface LicenseMarker {
  v: 1;
  key: string;
  /** ISO 8601 */
  activatedAt: string;
}

export interface LicenseMarkerStore {
  read(): LicenseMarker | null;
  write(key: string, activatedAt: Date): void;
}

export class LicenseStore implements LicenseMarkerStore {
  readonly file: string;

  constructor(
    dir: string,
    private readonly log: (line: string) => void = () => undefined,
  ) {
    this.file = path.join(dir, LICENSE_FILE_NAME);
  }

  read(): LicenseMarker | null {
    let size: number;
    try {
      size = statSync(this.file).size;
    } catch {
      return null; // never activated
    }
    if (size > MAX_MARKER_BYTES) {
      this.log(`licence: ${this.file} is ${size} bytes (over ${MAX_MARKER_BYTES}); ignored`);
      return null;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      const record =
        typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
      const { v, key, activatedAt } = record;
      if (
        v !== 1 ||
        typeof key !== "string" ||
        key.length === 0 ||
        key.length > MAX_LICENSE_INPUT_CHARS ||
        typeof activatedAt !== "string"
      ) {
        throw new Error("not a licence marker");
      }
      return { v: 1, key, activatedAt };
    } catch (error) {
      this.log(`licence: ${this.file} is not valid (${String(error)}); ignored`);
      return null;
    }
  }

  write(key: string, activatedAt: Date): void {
    const marker: LicenseMarker = { v: 1, key, activatedAt: activatedAt.toISOString() };
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    renameSync(tmp, this.file);
  }
}
