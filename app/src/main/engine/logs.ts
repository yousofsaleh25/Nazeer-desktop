/**
 * The supervisor's log: the engine's stderr plus the supervisor's own lifecycle lines (spawn,
 * ready, exit, restart, stop), in `<userData>\logs\app-engine-stderr.log`. The engine keeps its
 * own `<data root>\logs\engine.log`. Synchronous appends (low volume; nothing is lost when the
 * app is killed); one rotation to `.1` at 5 MiB, so the folder holds at most about 10 MiB.
 */
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const LOG_FILE_NAME = "app-engine-stderr.log";
export const LOG_MAX_BYTES = 5 * 1024 * 1024;

export class RotatingLog {
  readonly file: string;
  private size: number;
  private broken = false;

  constructor(
    readonly dir: string,
    private readonly maxBytes = LOG_MAX_BYTES,
    name = LOG_FILE_NAME,
  ) {
    this.file = path.join(dir, name);
    try {
      mkdirSync(dir, { recursive: true });
      this.size = statSync(this.file).size;
    } catch {
      this.size = 0;
    }
  }

  /** One line, prefixed with an ISO timestamp and the source (`engine` | `supervisor`). */
  write(source: "engine" | "supervisor" | "stdout", line: string): void {
    if (this.broken) return;
    const text = `${new Date().toISOString()} [${source}] ${line.replace(/\r?\n$/, "")}\n`;
    const bytes = Buffer.byteLength(text, "utf8");
    try {
      if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
      appendFileSync(this.file, text, "utf8");
      this.size += bytes;
    } catch {
      // a log that cannot be written must never take the app down; stop trying
      this.broken = true;
    }
  }

  private rotate(): void {
    const previous = `${this.file}.1`;
    rmSync(previous, { force: true });
    renameSync(this.file, previous);
    this.size = 0;
  }
}
