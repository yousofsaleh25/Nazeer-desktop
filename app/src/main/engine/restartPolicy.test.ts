import { describe, expect, it } from "vitest";
import { MAX_RESTARTS_IN_WINDOW, RESTART_WINDOW_MS, RestartPolicy } from "./restartPolicy";

describe("RestartPolicy", () => {
  it("backs off 1-2-4-8-16 s and gives up on the 6th crash within 5 minutes", () => {
    const policy = new RestartPolicy();
    let t = 0;
    const delays: number[] = [];
    for (let i = 0; i < MAX_RESTARTS_IN_WINDOW; i += 1) {
      const decision = policy.onCrash(t);
      expect(decision.kind).toBe("restart");
      if (decision.kind === "restart") {
        delays.push(decision.delayMs);
        t += decision.delayMs + 1_000; // the replacement ran for a second
      }
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(policy.onCrash(t)).toEqual({ kind: "give_up", restartsInWindow: 5 });
  });

  it("caps the delay at 30 s for crashes spread out enough to stay under the window limit", () => {
    const policy = new RestartPolicy();
    const delays: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const decision = policy.onCrash(i * 2 * 60_000); // one crash every 2 minutes
      if (decision.kind === "restart") delays.push(decision.delayMs);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it("forgets old restarts after the window and resets the backoff after a stable run", () => {
    const policy = new RestartPolicy();
    for (let i = 0; i < 5; i += 1) policy.onCrash(i);
    expect(policy.onCrash(10).kind).toBe("give_up");
    // the window slid past the first five crashes
    const later = policy.onCrash(RESTART_WINDOW_MS + 10);
    expect(later).toMatchObject({ kind: "restart", delayMs: 30_000 });
    policy.noteStableRun(RESTART_WINDOW_MS);
    expect(policy.onCrash(RESTART_WINDOW_MS * 3)).toMatchObject({
      kind: "restart",
      delayMs: 1_000,
    });
  });

  it("a short run does not reset the backoff; reset() does", () => {
    const policy = new RestartPolicy();
    policy.onCrash(0);
    policy.noteStableRun(60_000);
    expect(policy.onCrash(70_000)).toMatchObject({ delayMs: 2_000 });
    policy.reset();
    expect(policy.onCrash(80_000)).toMatchObject({ delayMs: 1_000, attempt: 1 });
  });
});
