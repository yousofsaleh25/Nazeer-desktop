import { describe, expect, it } from "vitest";
import { MEASURE_PALETTE } from "./index";
import tokensCss from "./tokens.css?raw";

// engine geometry.py: assign_color(i) = colorsys.hls_to_rgb((i / GOLDEN_RATIO) % 1, 0.46, 0.62)
const GOLDEN_RATIO = 1.6180339887498949;
const LIGHTNESS = 0.46;
const SATURATION = 0.62;

function component(m1: number, m2: number, hue: number): number {
  const h = hue - Math.floor(hue); // Python's hue % 1.0 (always >= 0)
  if (h < 1 / 6) return m1 + (m2 - m1) * h * 6;
  if (h < 0.5) return m2;
  if (h < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - h) * 6;
  return m1;
}

/** A port of the engine's assign_color (Python colorsys + int() truncation). */
function assignColor(index: number): string {
  const hue = (index / GOLDEN_RATIO) % 1;
  const m2 =
    LIGHTNESS <= 0.5
      ? LIGHTNESS * (1 + SATURATION)
      : LIGHTNESS + SATURATION - LIGHTNESS * SATURATION;
  const m1 = 2 * LIGHTNESS - m2;
  const rgb = [
    component(m1, m2, hue + 1 / 3),
    component(m1, m2, hue),
    component(m1, m2, hue - 1 / 3),
  ];
  return `#${rgb
    .map((c) =>
      Math.trunc(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

describe("measurement palette", () => {
  it("the port reproduces the engine's pinned colours", () => {
    expect(assignColor(0)).toBe("#be2c2c");
    expect(assignColor(10)).toBe("#b2be2c");
    expect(assignColor(21)).toBe("#be2c3f");
  });

  it("MEASURE_PALETTE is assign_color(0..11)", () => {
    expect([...MEASURE_PALETTE]).toEqual(Array.from({ length: 12 }, (_, i) => assignColor(i)));
  });

  it("tokens.css --color-measure-N equals MEASURE_PALETTE[N]", () => {
    const fromCss = new Map(
      [...tokensCss.matchAll(/--color-measure-(\d+):\s*(#[0-9a-f]{6})/g)].map(([, n, hex]) => [
        Number(n),
        hex,
      ]),
    );
    expect(fromCss.size).toBe(12);
    MEASURE_PALETTE.forEach((hex, i) => expect(fromCss.get(i), `measure-${i}`).toBe(hex));
  });
});
