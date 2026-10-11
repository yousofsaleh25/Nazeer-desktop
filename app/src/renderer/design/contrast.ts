/**
 * WCAG 2.x contrast for the design tokens (pure): reads the --nz-* values per theme straight
 * from tokens.css, so the contrast test and the /design gallery check the shipped values.
 */

export type ThemeName = "light" | "dark";
/** "--nz-ink" → "#2a1f18" (only hex colours; rgb() values such as shadows are skipped). */
export type ThemeValues = Record<string, string>;

const DECLARATION = /(--nz-[a-z0-9-]+)\s*:\s*([^;]+);/g;

function blockAfter(css: string, opener: RegExp): string {
  const match = opener.exec(css);
  if (match === null) throw new Error(`tokens.css: no block for ${String(opener)}`);
  const start = match.index + match[0].length;
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

function hexDeclarations(block: string): ThemeValues {
  const out: ThemeValues = {};
  for (const [, name, value] of block.matchAll(DECLARATION)) {
    const v = (value ?? "").trim();
    if (name !== undefined && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(v))
      out[name] = v.toLowerCase();
  }
  return out;
}

/** The light (`:root, [data-theme="light"]`) and dark (`[data-theme="dark"]`) colour values. */
export function parseThemeTokens(css: string): Record<ThemeName, ThemeValues> {
  return {
    light: hexDeclarations(blockAfter(css, /:root,\s*\[data-theme="light"\]\s*\{/)),
    dark: hexDeclarations(blockAfter(css, /\[data-theme="dark"\]\s*\{/)),
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** (L1 + 0.05) / (L2 + 0.05), lighter over darker: 1 … 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
