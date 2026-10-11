import { describe, expect, it } from "vitest";
import { byteSize, formatDateTime, formatNumber } from "./format";

describe("formatNumber", () => {
  it("ASCII digits, fixed decimals, -- for missing values", () => {
    expect(formatNumber(1.8423, { digits: 3 })).toBe("1.842");
    expect(formatNumber(6287637556, { grouping: true })).toBe("6,287,637,556");
    expect(formatNumber(null)).toBe("--");
    expect(formatNumber(Number.NaN)).toBe("--");
  });
});

describe("byteSize", () => {
  it("binary units like Windows Explorer", () => {
    expect(byteSize(6287637556)).toEqual({ value: 6287637556 / 1024 ** 3, digits: 2, unit: "gb" });
    expect(byteSize(1170670).unit).toBe("mb");
    expect(byteSize(2048)).toEqual({ value: 2, digits: 0, unit: "kb" });
    expect(byteSize(12)).toEqual({ value: 12, digits: 0, unit: "b" });
  });
});

describe("formatDateTime", () => {
  it("local YYYY-MM-DD HH:MM", () => {
    const iso = "2026-10-11T15:29:57+00:00";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(formatDateTime(iso)).toBe(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
    expect(formatDateTime(iso)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("-- for a missing or broken timestamp", () => {
    expect(formatDateTime(null)).toBe("--");
    expect(formatDateTime("not a date")).toBe("--");
  });
});
