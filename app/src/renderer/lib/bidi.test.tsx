import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import labels from "../../../fixtures/labels.json";
import { isolateLatin, latinRuns } from "./bidi";

function runs(text: string): string[] {
  return latinRuns(text).map(([start, end]) => text.slice(start, end));
}

describe("Latin runs in Arabic text", () => {
  it("isolates an engine label's trailing Latin fragment with its brackets", () => {
    expect(runs("نقطة بعيدة عن مستوى Z_ref (> 10 %)")).toEqual(["Z_ref (> 10 %)"]);
  });

  it("leaves a closing bracket that belongs to the Arabic text outside", () => {
    expect(runs("مسافة ثنائية الأبعاد (مستوى Z_ref)")).toEqual(["Z_ref"]);
    expect(runs("مُقرَّب إلى الجمل (KNN): حلقة مفرغة")).toEqual(["KNN"]);
  });

  it("ends a run at a closer it did not open, and goes on after it (the report's frame block)", () => {
    // "(MSE) 0.0231" printed as "MSE) 0.0231(" while ")" was inside the run
    expect(runs("تباين العمق (MSE) 0.0231 م²")).toEqual(["MSE", "0.0231"]);
    expect(runs("x 29–1273، y 107–719 بكسل")).toEqual(["x 29–1273", "y 107–719"]);
    expect(runs("ولا يُطبَّق (نموذج ثقب الإبرة) fx 642.9")).toEqual(["fx 642.9"]);
    expect(runs("2.329 م: وسيط 182,862 قيمة (96.4% من 189,733 بكسل)، MAD 0.069 م")).toEqual([
      "2.329",
      "182,862",
      "96.4%",
      "189,733",
      "MAD 0.069",
    ]);
  });

  it("isolates numbers, acronyms and key names", () => {
    expect(runs("الجيران بعيدون (> 10 سم)")).toEqual(["10"]);
    expect(runs("جميع الأزواج تحقق مستوى WCAG AA في المظهرين.")).toEqual(["WCAG AA"]);
    expect(runs("اضغط Tab: كل عنصر")).toEqual(["Tab"]);
    expect(runs("مباشر 2.153 م")).toEqual(["2.153"]);
  });

  it("keeps a number's sign with it (angles, uncertainties), not a hyphen inside a word", () => {
    expect(runs("+155.7°")).toEqual(["+155.7°"]);
    expect(runs("-12.5°")).toEqual(["-12.5°"]);
    expect(runs("± 5.9 سم")).toEqual(["± 5.9"]);
    expect(runs("الزاوية (+9.9°)")).toEqual(["+9.9°"]);
    expect(runs("جمل-مرحلة-6")).toEqual(["6"]);
    expect(runs("P1–P2")).toEqual(["P1–P2"]);
  });

  it("leaves pure Arabic text untouched", () => {
    expect(runs("قياس أبعاد جسم الجمل")).toEqual([]);
    expect(isolateLatin("قياس أبعاد جسم الجمل")).toBe("قياس أبعاد جسم الجمل");
  });

  it("never changes the characters: every engine label renders to its own text", () => {
    const groups = [
      labels.flags,
      labels.rejections,
      labels.kinds,
      labels.sources,
      labels.candidate_flags,
    ];
    for (const group of groups) {
      for (const label of Object.values(group)) {
        const { container, unmount } = render(<span>{isolateLatin(label.ar)}</span>);
        expect(container.textContent).toBe(label.ar);
        container
          .querySelectorAll("bdi")
          .forEach((bdi) => expect(bdi).toHaveAttribute("dir", "ltr"));
        unmount();
      }
    }
  });
});
