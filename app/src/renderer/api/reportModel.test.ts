import { describe, expect, it } from "vitest";
import { fixtures } from "@/design/fixtures";
import { reportFormContent } from "./reportModel";

describe("reportFormContent", () => {
  it("reads the engine's observation fields, colour options and variants", () => {
    const content = reportFormContent(fixtures.reportModel)!;
    expect(content.observationFields.map((f) => [f.key, f.kind])).toEqual([
      ["colour", "select"],
      ["age", "text"],
      ["coat", "text"],
      ["gait", "text"],
      ["defects", "textarea"],
      ["manual", "textarea"],
    ]);
    expect(content.colourOptions[0]).toEqual({ ar: "مجاهيم", en: "Mjaheem (black)" });
    expect(content.variants).toEqual({
      mjaheem: { ar: "المجاهيم", en: "Mjaheem" },
      maghateer: { ar: "المغاتير", en: "Maghateer" },
    });
  });

  it("returns null for anything that is not a report model", () => {
    expect(reportFormContent(null)).toBeNull();
    expect(reportFormContent({ static: {} })).toBeNull();
    const model = structuredClone(fixtures.reportModel) as {
      static: { observation_fields: { kind: string }[] };
    };
    model.static.observation_fields[0]!.kind = "slider";
    expect(reportFormContent(model)).toBeNull();
  });
});
