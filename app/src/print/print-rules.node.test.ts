/** Rules of the print page that hold for its sources (ADR-D7; CLAUDE.md "Arabic in the PDF"). */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import cmap from "./plex-cmap.json";
import { PRINT_FONT_FAMILY } from "./face";

const printDir = resolve(__dirname);
const sources = readdirSync(printDir)
  .filter((name) => /\.(ts|tsx|css|html)$/.test(name) && !/\.test\./.test(name))
  .map((name) => ({ name, text: readFileSync(join(printDir, name), "utf8") }));

describe("the print page's sources", () => {
  it("read no stored state: language and names come from the report model only", () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    }
  });

  it("have no print-only rules and nothing that hides or clamps text", () => {
    const css = sources.find((s) => s.name === "print.css")?.text ?? "";
    expect(css).not.toMatch(/@media\s+print/);
    expect(css).not.toMatch(/content-visibility|line-clamp|text-overflow/);
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/\b(truncate|line-clamp-\d|uppercase|lowercase|capitalize)\b/);
    }
  });

  it("name one face, the one main.tsx adds from the engine's TTF bytes", () => {
    const css = sources.find((s) => s.name === "print.css")?.text ?? "";
    expect(css).toContain(`font-family: "${PRINT_FONT_FAMILY}";`);
    expect(css).toContain("font-synthesis: none");
    expect(css).toMatch(/size:\s*A4/);
    expect(css).toMatch(/margin:\s*12mm/);
  });

  it("check against the cmap of the engine's pinned TTF (npm run gen:cmap after a font change)", () => {
    const ttf = resolve(
      __dirname,
      "../../../engine/nazeer_engine/assets/fonts/IBMPlexSansArabic-Regular.ttf",
    );
    const sha = createHash("sha256").update(readFileSync(ttf)).digest("hex");
    expect(cmap.sha256).toBe(sha);
    let last = -1;
    for (const [start, end] of cmap.ranges as [number, number][]) {
      expect(start).toBeGreaterThan(last);
      expect(end).toBeGreaterThanOrEqual(start);
      last = end;
    }
  });
});
