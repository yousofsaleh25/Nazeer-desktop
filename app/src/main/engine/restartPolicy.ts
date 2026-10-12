/**
 * When to restart an engine that crashed after it was ready (pure; unit-tested).
 *
 * Delays grow 1 → 2 → 4 → 8 → 16 → 30 s with each consecutive crash and reset once a run stayed
 * ready for the whole window (5 min). More than 5 restarts inside any 5-minute window is a crash
 * loop: the supervisor gives up and shows the fatal screen (the operator can retry from there).
 */

export const RESTART_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
export const RESTART_WINDOW_MS = 5 * 60_000;
export const MAX_RESTARTS_IN_WINDOW = 5;

export type RestartDecision =
  | { kind: "restart"; delayMs: number; attempt: number }
  | { kind: "give_up"; restartsInWindow: number };

export class RestartPolicy {
  private restarts: number[] = [];
  private consecutive = 0;

  /** A run that stayed ready for at least the window resets the backoff. */
  noteStableRun(readyForMs: number): void {
    if (readyForMs >= RESTART_WINDOW_MS) this.consecutive = 0;
  }

  /** Called when a ready engine exited unexpectedly at `now` (ms). */
  onCrash(now: number): RestartDecision {
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restarts.length >= MAX_RESTARTS_IN_WINDOW) {
      return { kind: "give_up", restartsInWindow: this.restarts.length };
    }
    const index = Math.min(this.consecutive, RESTART_DELAYS_MS.length - 1);
    const delayMs = RESTART_DELAYS_MS[index] ?? RESTART_DELAYS_MS[RESTART_DELAYS_MS.length - 1]!;
    this.consecutive += 1;
    this.restarts.push(now);
    return { kind: "restart", delayMs, attempt: this.consecutive };
  }

  /** The operator retried from the fatal screen: start counting afresh. */
  reset(): void {
    this.restarts = [];
    this.consecutive = 0;
  }
}
