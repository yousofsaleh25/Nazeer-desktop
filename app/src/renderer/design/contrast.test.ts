import { describe, expect, it } from "vitest";
import { contrastRatio, parseThemeTokens, relativeLuminance } from "./contrast";
import { COLOR_FAMILIES, CONTRAST_PAIRS } from "./index";
import tokensCss from "./tokens.css?raw";

const themes = parseThemeTokens(tokensCss);

describe("WCAG contrast maths", () => {
  it("matches reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 6);
    expect(contrastRatio("#2a1f18", "#2a1f18")).toBe(1);
    expect(relativeLuminance("#fff")).toBeCloseTo(1, 9);
    // the classic grey that just fails AA on white
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("tokens.css", () => {
  it("defines the same colour tokens in both themes", () => {
    expect(Object.keys(themes.light).length).toBeGreaterThan(40);
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });

  it("defines every token of the registry in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const { tokens } of COLOR_FAMILIES) {
        for (const token of tokens) {
          expect(themes[theme][`--nz-${token}`], `${theme} --nz-${token}`).toMatch(
            /^#[0-9a-f]{6}$/,
          );
        }
      }
    }
  });

  it.each(["light", "dark"] as const)(
    "%s theme: every text and control pair reaches WCAG AA",
    (theme) => {
      const failures = CONTRAST_PAIRS.flatMap((pair) => {
        const fg = themes[theme][`--nz-${pair.fg}`];
        const bg = themes[theme][`--nz-${pair.bg}`];
        if (fg === undefined || bg === undefined) return [`${pair.fg} / ${pair.bg}: missing token`];
        const ratio = contrastRatio(fg, bg);
        return ratio < pair.min
          ? [`${pair.fg} on ${pair.bg}: ${ratio.toFixed(2)} < ${pair.min} (${pair.use})`]
          : [];
      });
      expect(failures).toEqual([]);
    },
  );
});
