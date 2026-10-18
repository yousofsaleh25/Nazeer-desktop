import { describe, expect, it, vi } from "vitest";
import { PrintError, withinTime } from "./printWindow";

vi.mock("electron", () => ({}));

describe("withinTime (the print window's phase limits, D12)", () => {
  it("passes a result through that arrives in time", async () => {
    await expect(withinTime(Promise.resolve(7), 1000, "the layout")).resolves.toBe(7);
  });

  it("ends a phase that hangs with print_timeout, naming the phase", async () => {
    vi.useFakeTimers();
    try {
      const hung = withinTime(new Promise<never>(() => undefined), 120_000, "printing to PDF");
      const caught = hung.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(120_000);
      const error = await caught;
      expect(error).toBeInstanceOf(PrintError);
      expect(error).toMatchObject({
        code: "print_timeout",
        message: "printing to PDF took longer than 120000 ms",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a phase's own failure", async () => {
    await expect(
      withinTime(Promise.reject(new PrintError("print_failed", "no printer")), 1000, "x"),
    ).rejects.toMatchObject({ code: "print_failed" });
  });
});
