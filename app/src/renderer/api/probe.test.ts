import { describe, expect, it } from "vitest";
import { fixtures } from "@/design/fixtures";
import { sampleProbeDrift } from "@/design/samples";
import { summarizeProbe } from "./probe";

describe("summarizeProbe", () => {
  it("reads the engine's real PASS probe", () => {
    const s = summarizeProbe(fixtures.probePass);
    expect(s.verdict).toBe("PASS");
    expect(s.pages).toBe(5);
    expect(s.pixel).toEqual({ ok: true, reason: "", page: 2, maxAbsDiff: 0 });
    expect(s.text.ok).toBe(true);
    expect(s.text.names).toHaveLength(13);
    expect(s.text.names.every((n) => n.ok && n.runs.every((r) => r.found))).toBe(true);
    expect(s.fonts).toEqual({
      ok: true,
      fonts: ["/AAAAAA+IBMPlexSansArabic"],
      type3: false,
      required: "IBMPlexSansArabic",
    });
    expect(s.attachments.files.map((f) => [f.name, f.matches])).toEqual([
      ["overlay_v1.png", true],
      ["session.json", true],
      ["report_model.json", true],
    ]);
  });

  it("a DRIFT probe keeps its failures and hints", () => {
    const s = summarizeProbe(sampleProbeDrift());
    expect(s.verdict).toBe("DRIFT");
    expect(s.hardFailures).toEqual(["text_probe_failed", "font_probe_failed"]);
    expect(s.hints).toEqual(["synthesized_face"]);
    expect(s.text.names[0]?.runs.map((r) => r.found)).toEqual([true, false, true, true]);
  });

  it("anything missing reads as not checked, never as a pass", () => {
    const s = summarizeProbe({});
    expect(s.verdict).toBe("UNKNOWN");
    expect([s.pixel.ok, s.text.ok, s.fonts.ok, s.attachments.ok]).toEqual([null, null, null, null]);
  });
});
