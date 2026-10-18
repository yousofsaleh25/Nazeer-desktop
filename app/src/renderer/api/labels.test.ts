import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/labels.json";
import { labelOf, LabelsInvalid, parseLabels } from "./labels";

describe("parseLabels", () => {
  it("accepts the engine's real /meta/labels payload", () => {
    const labels = parseLabels(fixture);
    expect(labels.kinds["curve_3d"]).toEqual({
      ar: "طول خط منكسر ثلاثي الأبعاد",
      en: "3D polyline length",
    });
    expect(labels.flags["knn_far"]?.severity).toBe("warn");
    expect(labels.candidate_flags["mask_in_depth_margin"]?.severity).toBe("info");
    expect(labels.constants["KNN_K"]).toBe(9);
  });

  it("names the first problem", () => {
    expect(() => parseLabels(null)).toThrow(LabelsInvalid);
    const withoutSources: Record<string, unknown> = { ...fixture };
    delete withoutSources["sources"];
    expect(() => parseLabels(withoutSources)).toThrow("sources: missing or not an object");
    expect(() => parseLabels({ ...fixture, buckets: { SIDE: { ar: "جانبي" } } })).toThrow(
      "buckets.SIDE: expected {ar, en} strings",
    );
    expect(() =>
      parseLabels({ ...fixture, flags: { knn_far: { ar: "a", en: "b", severity: "error" } } }),
    ).toThrow("flags.knn_far: severity must be warn or info");
    expect(() => parseLabels({ ...fixture, constants: { KNN_K: "9" } })).toThrow(
      "constants.KNN_K: expected a finite number",
    );
  });

  it("keeps D12's comparison groups (eligibility, staleness, status)", () => {
    const labels = parseLabels(fixture);
    expect(labelOf(labels, "comparison_ineligible", "model_outdated")?.en).toBe(
      "its report data is from an older version: reopen and finalize it",
    );
    expect(labelOf(labels, "comparison_stale", "member_reopened")?.ar).toBe(
      "أُعيد فتح جلسة هذا الجمل",
    );
    expect(labelOf(labels, "comparison_statuses", "sealed")?.ar).toBe("مختومة");
    const withoutStale: Record<string, unknown> = { ...fixture };
    delete withoutStale["comparison_stale"];
    expect(() => parseLabels(withoutStale)).toThrow("comparison_stale: missing or not an object");
  });

  it("drops groups it does not know", () => {
    const labels = parseLabels({ ...fixture, future_group: { x: { ar: "س", en: "x" } } });
    expect(labels).not.toHaveProperty("future_group");
  });
});

describe("labelOf", () => {
  const labels = parseLabels(fixture);

  it("returns the pair (without extra fields such as severity)", () => {
    expect(labelOf(labels, "flags", "knn_spread")).toEqual({
      ar: "تباين أعماق الجيران",
      en: "neighbour depths spread",
    });
  });

  it("returns null for an unknown or empty code, or before the labels arrived", () => {
    expect(labelOf(labels, "flags", "no_such_flag")).toBeNull();
    expect(labelOf(labels, "flags", "toString")).toBeNull();
    expect(labelOf(labels, "sources", null)).toBeNull();
    expect(labelOf(null, "sources", "window_median")).toBeNull();
  });
});
