/**
 * Time in the store's tests: fake timers for the debounce, backoff and timeouts (setTimeout /
 * setInterval only), while setImmediate stays real so fetch bodies and listener effects can run.
 */
import { vi } from "vitest";

// Node's setImmediate (the renderer's types are DOM-only)
const immediate = (callback: () => void): void => {
  (globalThis as unknown as { setImmediate: (cb: () => void) => void }).setImmediate(callback);
};

export function useStoreTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
}

/** Advance the fake clock by `ms`, then let the pending I/O turns run. */
export async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 20; i += 1) {
    await new Promise<void>((resolve) => immediate(() => resolve()));
  }
}

/**
 * Let pending I/O run until `done()` holds, for at most `ms` of real time: WebCrypto's digest
 * finishes on Node's thread pool, so a fixed number of turns is not enough on a busy machine.
 */
export async function until(done: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) {
    await new Promise<void>((resolve) => immediate(() => resolve()));
  }
}
