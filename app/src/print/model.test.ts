import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/report_model.json";
import { FRAME_ROW_KEYS, ModelError, parsePrintModel } from "./model";

const clone = (): Record<string, unknown> => structuredClone(fixture);

describe("parsePrintModel (report model 1.1)", () => {
  it("reads the engine's real report model: every text the page prints is the engine's", () => {
    const m = parsePrintModel(fixture);
    expect(m.schemaVersion).toBe("1.1");
    expect(m.language).toBe("both");
    expect(m.session.camelId).toBe("جمل-تجربة-1");
    expect(m.rows).toHaveLength(9);
    for (const key of FRAME_ROW_KEYS) {
      expect(m.labels.frameRows[key].ar, key).not.toBe("");
      expect(m.frame.texts[key].en, key).not.toBe("");
    }
    expect(m.frame.texts.z_ref.en.startsWith("2.329 m: median of 182,862 valid depths")).toBe(true);
    expect(m.frame.texts.source.ar).toBe("مؤشر القراءة 1340 · t = 44.69 ث · جانبي");
    expect(m.summary.countsText.en).toBe("Measurements: 9 · rejected: 0 · low confidence: 3");
    expect(m.labels.rejected).toEqual({ ar: "مرفوض", en: "Rejected" });
    const curve = m.rows.find((r) => r.crossCheck !== null);
    expect(curve?.crossCheck?.en.startsWith("2D cross-check ")).toBe(true);
    expect(m.rubric.rows).toHaveLength(11);
    expect(m.regions).toHaveLength(27);
    expect(m.signatureWells.map((w) => w.id)).toEqual(["judge", "council"]);
    expect(m.versions.every(([, version]) => version.length <= 80)).toBe(true);
  });

  it("refuses a 1.0 model: it lacks texts the page would otherwise have to compose", () => {
    const old = clone();
    old["report_model_version"] = "1.0";
    expect(() => parsePrintModel(old)).toThrow(
      new ModelError("report model 1.0: this print page lays out version 1.1"),
    );
  });

  it("names the first field that is missing or wrong", () => {
    const noTexts = clone();
    delete (noTexts["frame"] as Record<string, unknown>)["texts"];
    expect(() => parsePrintModel(noTexts)).toThrow("frame.texts is not an object");

    const badRow = clone();
    const rows = badRow["measurements"] as Record<string, unknown>[];
    (rows[2] as Record<string, unknown>)["value_text"] = { ar: "1 م" };
    expect(() => parsePrintModel(badRow)).toThrow("measurements[2].value_text.en is not a string");

    const badLanguage = clone();
    (badLanguage["inputs"] as Record<string, unknown>)["language"] = "fr";
    expect(() => parsePrintModel(badLanguage)).toThrow("inputs.language is not ar, en or both");
  });
});
