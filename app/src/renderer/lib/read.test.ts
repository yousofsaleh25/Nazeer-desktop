import { describe, expect, it } from "vitest";
import view from "../../../fixtures/session_view.json";
import {
  asBox,
  asPoint,
  readArray,
  readBoolean,
  readNumber,
  readPoint,
  readRecord,
  readString,
  readStrings,
} from "./read";

describe("readers for free-form engine objects", () => {
  it("read the real frame block", () => {
    expect(readNumber(view.frame.z_ref, "z_ref_m")).toBeCloseTo(2.329, 3);
    expect(readString(view.frame.z_ref, "statistic")).toBe("median");
    expect(readBoolean(view.frame.z_ref, "erosion_fallback")).toBe(false);
    expect(readNumber(view.frame.ground, "drawn_row")).toBe(691);
    expect(readString(view.frame.ground, "badge")).toBeNull();
    expect(readRecord(view.frame, "knn")).toHaveProperty("k", 9);
    expect(asBox(view.frame.depth_valid_bbox)).toEqual([29, 107, 1273, 719]);
  });

  it("return null for a missing field or the wrong type, never a made-up value", () => {
    expect(readNumber({ a: "1" }, "a")).toBeNull();
    expect(readNumber({ a: Number.NaN }, "a")).toBeNull();
    expect(readNumber(null, "a")).toBeNull();
    expect(readString({ a: 1 }, "a")).toBeNull();
    expect(readRecord({ a: [1] }, "a")).toBeNull();
    expect(readArray({ a: {} }, "a")).toBeNull();
    expect(readStrings({ a: ["x", 1, "y"] }, "a")).toEqual(["x", "y"]);
  });

  it("points and boxes need finite numbers", () => {
    expect(asPoint([841.57, 338.84])).toEqual([841.57, 338.84]);
    expect(asPoint([1])).toBeNull();
    expect(asPoint([1, null])).toBeNull();
    expect(readPoint({ p: [1, 2] }, "p")).toEqual([1, 2]);
    expect(asBox([1, 2, 3])).toBeNull();
    expect(asBox([1, 2, 3, Number.POSITIVE_INFINITY])).toBeNull();
  });
});
