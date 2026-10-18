import { describe, expect, it } from "vitest";
import { dayBound, HISTORY_INITIAL, historyFiltered, historyParams } from "./history";

describe("History's query", () => {
  it("turns a local day into its first and last instants (both inclusive)", () => {
    const start = dayBound("2026-10-17", "start")!;
    const end = dayBound("2026-10-17", "end")!;
    expect(new Date(start).getTime()).toBe(new Date(2026, 9, 17, 0, 0, 0, 0).getTime());
    expect(new Date(end).getTime()).toBe(new Date(2026, 9, 17, 23, 59, 59, 999).getTime());
    expect(start.endsWith("Z")).toBe(true);
    for (const bad of ["", "2026-13-01", "2026-02-30", "17/10/2026", "2026-10-17T00:00"]) {
      expect(dayBound(bad, "start")).toBeUndefined();
    }
  });

  it("sends the event and the measuring dates only when set", () => {
    expect(historyParams(HISTORY_INITIAL)).toMatchObject({
      event: undefined,
      created_from: undefined,
      created_to: undefined,
    });
    const params = historyParams({
      ...HISTORY_INITIAL,
      event: "  مزاين ",
      createdFrom: "2026-10-01",
      createdTo: "2026-10-17",
    });
    expect(params.event).toBe("مزاين");
    expect(params.created_from).toBe(dayBound("2026-10-01", "start"));
    expect(params.created_to).toBe(dayBound("2026-10-17", "end"));
  });

  it("knows when a filter narrows the list", () => {
    expect(historyFiltered(HISTORY_INITIAL)).toBe(false);
    expect(historyFiltered({ ...HISTORY_INITIAL, event: "x" })).toBe(true);
    expect(historyFiltered({ ...HISTORY_INITIAL, createdTo: "2026-10-17" })).toBe(true);
    expect(historyFiltered({ ...HISTORY_INITIAL, event: "   " })).toBe(false);
  });
});
