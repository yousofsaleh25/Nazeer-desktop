/**
 * The app's own settings: `<userData>\app-settings.json` (main only; the renderer never reads
 * files). Today: the capture folders the bag scan looks in. A missing or damaged file means the
 * defaults (and is said so in the log); writes are atomic (temp file + rename).
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateCaptureFolders } from "@shared/ipcValidate";

export interface AppSettings {
  captureFolders: string[];
}

export const SETTINGS_FILE_NAME = "app-settings.json";

const DEFAULTS: AppSettings = { captureFolders: [] };

export class SettingsStore {
  readonly file: string;
  private current: AppSettings;

  constructor(
    dir: string,
    private readonly log: (line: string) => void = () => undefined,
  ) {
    this.file = path.join(dir, SETTINGS_FILE_NAME);
    this.current = this.load();
  }

  get(): AppSettings {
    return { captureFolders: [...this.current.captureFolders] };
  }

  setCaptureFolders(folders: string[]): string[] {
    const next: AppSettings = { ...this.current, captureFolders: validateCaptureFolders(folders) };
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    renameSync(tmp, this.file);
    this.current = next;
    return [...next.captureFolders];
  }

  private load(): AppSettings {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch {
      return { ...DEFAULTS };
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      const folders =
        typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>)["captureFolders"]
          : undefined;
      return { captureFolders: validateCaptureFolders(folders ?? []) };
    } catch (error) {
      this.log(`settings: ${this.file} is not valid (${String(error)}); using the defaults`);
      return { ...DEFAULTS };
    }
  }
}
