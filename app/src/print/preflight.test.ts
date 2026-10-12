import { describe, expect, it } from "vitest";
import {
  faceCovers,
  nameRuns,
  normalizeText,
  PRINT_FONT_FAMILY,
  runPreflight,
  uncovered,
  type PreflightInput,
} from "./preflight";

const ch = (...codes: number[]) => String.fromCodePoint(...codes);
const FSI_TO_PDI = (text: string) => `${ch(0x2068)}${text}${ch(0x2069)}`;

describe("the engine's text-probe normalisation, ported (pdf_finalize.py)", () => {
  // the engine's own cases (engine/tests/test_pdf_finalize.py)
  it("matches the engine's test cases", () => {
    const presentation = ch(0xfec3, 0xfeee, 0xfedd, 0x20, 0xfe8d, 0xfedf, 0xfea0, 0xfeb4, 0xfee2);
    expect(normalizeText(presentation)).toBe("طولالجسم");
    expect(normalizeText("قُرِّبت")).toBe("قربت");
    expect(normalizeText(`${FSI_TO_PDI("طول")} ${ch(0x200e)}1`)).toBe("طول1");
    expect(nameRuns("Ahmed أحمد 12")).toEqual(["Ahmed", "أحمد", "12"]);
    expect(nameRuns("جمل-7")).toEqual(["جمل", "7"]);
    expect(nameRuns("قُرِّبت")).toEqual(["قربت"]);
    expect(nameRuns("(KNN) 2.0")).toEqual(["KNN", "2", "0"]);
    expect(nameRuns("   ")).toEqual([]);
  });

  // outputs of the engine's functions for the same inputs (computed with the engine venv)
  it("agrees with the engine on mixed, decorated and compatibility text", () => {
    const cases: [string, string[], string][] = [
      ["جمل-تجربة-1", ["جمل", "تجربة", "1"], "جمل-تجربة-1"],
      [
        "مزاين الإبل - تشغيل تجريبي",
        ["مزاين", "الإبل", "تشغيل", "تجريبي"],
        "مزاينالإبل-تشغيلتجريبي",
      ],
      ["C-1", ["C", "1"], "C-1"],
      ["Height 2D", ["Height", "2D"], "Height2D"],
      ["جمـــل", ["جمل"], "جمل"],
      [`${ch(0xfb01)}ne`, ["fine"], "fine"],
      [ch(0x661, 0x662), [ch(0x661, 0x662)], ch(0x661, 0x662)],
      [ch(0xff21, 0xff22), ["AB"], "AB"],
      ["P1–P5", ["P1", "P5"], "P1–P5"],
      ["x 29–1273", ["x", "29", "1273"], "x29–1273"],
      ["snapped 7.8 cm", ["snapped", "7", "8", "cm"], "snapped7.8cm"],
      [`Ahmed${ch(0xa0)}أحمد`, ["Ahmed", "أحمد"], "Ahmedأحمد"],
      [`a${ch(0xad)}b`, ["a", "b"], `a${ch(0xad)}b`],
    ];
    for (const [input, runs, normalized] of cases) {
      expect(nameRuns(input), input).toEqual(runs);
      expect(normalizeText(input), input).toBe(normalized);
    }
  });
});

describe("the face's coverage (plex-cmap.json)", () => {
  it("covers Arabic, Latin and the report's symbols; not Greek capitals or emoji", () => {
    for (const text of ["معرّف الجمل", "Camel ID", "± 4.3 cm", "155.7°", "m²", "x 29–1273 · …"]) {
      expect(uncovered(text), text).toEqual([]);
    }
    expect(faceCovers("Δ")).toBe(false);
    expect(uncovered("جمل 🐪 Δz")).toEqual(["🐪", "Δ"]);
  });

  it("needs nothing drawn for spaces and default-ignorable characters", () => {
    for (const code of [0x20, 0xa0, 0x200b, 0x200e, 0x2066, 0x2069, 0xad, 0xfe0f]) {
      expect(faceCovers(ch(code)), code.toString(16)).toBe(true);
    }
  });
});

/** jsdom has no layout: computed styles are stubbed per element. */
function page(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

function input(root: HTMLElement, overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    root,
    face: { status: "loaded" } as FontFace,
    fontsCheck: () => true,
    requiredTexts: [],
    overlay: { width: 4, height: 3 },
    getStyle: () =>
      ({
        fontFamily: `"${PRINT_FONT_FAMILY}"`,
        fontWeight: "400",
        fontStyle: "normal",
        opacity: "1",
        filter: "none",
        mixBlendMode: "normal",
        objectFit: "fill",
      }) as CSSStyleDeclaration,
    ...overrides,
  };
}

function withOverlay(root: HTMLElement, width = 4, height = 3): void {
  const img = root.querySelector<HTMLImageElement>('img[data-role="overlay"]');
  if (img === null) throw new Error("no overlay");
  Object.defineProperty(img, "complete", { value: true });
  Object.defineProperty(img, "naturalWidth", { value: width });
  Object.defineProperty(img, "naturalHeight", { value: height });
}

const OVERLAY = '<img data-role="overlay" src="blob:x" alt="">';

describe("runPreflight", () => {
  it("passes a page whose names are present, in the face, at weight 400", () => {
    const root = page(
      `<p><bdi dir="auto">جمل-تجربة-1</bdi> <bdi dir="auto">Height 2D</bdi></p>${OVERLAY}`,
    );
    withOverlay(root);
    const result = runPreflight(input(root, { requiredTexts: ["جمل-تجربة-1", "Height 2D", " "] }));
    expect(result).toMatchObject({ ok: true, problems: [], warnings: [] });
    expect(result.checked).toMatchObject({ requiredTexts: 2, images: 1 });
  });

  it("refuses a missing name, a bold or another face, and a name the face cannot draw", () => {
    const root = page(`<p><b>Height 2D</b> جمل 🐪</p>${OVERLAY}`);
    withOverlay(root);
    const result = runPreflight(
      input(root, {
        requiredTexts: ["رأس الجمل", "جمل 🐪"],
        getStyle: () =>
          ({
            fontFamily: "Segoe UI, sans-serif",
            fontWeight: "700",
            fontStyle: "normal",
            opacity: "1",
            filter: "none",
            mixBlendMode: "normal",
            objectFit: "fill",
          }) as CSSStyleDeclaration,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.code)).toEqual([
      "print_face_mismatch",
      "print_synthesized_face",
      "print_required_text_missing",
      "print_glyph_missing",
    ]);
    // the emoji is in a required name: a problem there, not also a warning
    expect(result.warnings).toEqual([]);
  });

  it("only warns about a character outside the face in text the probe does not check", () => {
    const root = page(`<p>note: Δz</p>${OVERLAY}`);
    withOverlay(root);
    const result = runPreflight(input(root));
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(["print_glyph_fallback"]);
    expect(JSON.stringify(result.warnings[0]?.details)).toContain("U+0394");
  });

  it("refuses an unloaded face, a missing overlay, and an overlay of another size", () => {
    const noOverlay = runPreflight(input(page("<p>x</p>"), { face: null }));
    expect(noOverlay.problems.map((p) => p.code)).toEqual([
      "print_font_not_loaded",
      "print_overlay_missing",
    ]);
    const root = page(OVERLAY);
    withOverlay(root, 2, 2);
    const resized = runPreflight(input(root));
    expect(resized.problems.map((p) => p.code)).toEqual(["print_overlay_altered"]);
  });
});
