/**
 * The operator window's renderer is gone (`render-process-gone`): reload it — its unsaved edits
 * are lost either way, and the engine keeps every saved revision — but only a few times. A
 * renderer that keeps failing, or cannot start at all (a reload never cures those), would
 * otherwise spin in a reload loop behind a window that never shows while the engine runs on, so
 * the operator is told instead (pure; unit-tested; windows.ts applies it).
 */

/** At most this many reloads within RELOAD_WINDOW_MS, then the operator decides. */
export const RELOAD_LIMIT = 3;
export const RELOAD_WINDOW_MS = 5 * 60_000;

/** Reasons a reload cannot cure (Electron's RenderProcessGoneDetails.reason). */
const NOT_RELOADABLE = new Set(["launch-failed", "integrity-failure"]);

export type RendererGoneAction = "ignore" | "reload" | "ask";

export class RendererRecovery {
  private reloads: number[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  onGone(reason: string): RendererGoneAction {
    if (reason === "clean-exit") return "ignore";
    if (NOT_RELOADABLE.has(reason)) return "ask";
    const t = this.now();
    this.reloads = this.reloads.filter((at) => t - at < RELOAD_WINDOW_MS);
    if (this.reloads.length >= RELOAD_LIMIT) return "ask";
    this.reloads.push(t);
    return "reload";
  }

  /** The operator chose to try again: count afresh. */
  reset(): void {
    this.reloads = [];
  }
}
