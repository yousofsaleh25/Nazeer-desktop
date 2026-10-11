import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// RTL first: renderer and print code use logical utilities only. A line that must stay physical
// (image space on the measuring canvas, always LTR) carries a `physical-ok` comment.
const SRC = resolve(__dirname, "../..");
const ROOTS = [join(SRC, "renderer"), join(SRC, "print")];

const PHYSICAL_PREFIX =
  /^-?(?:m[lr]|p[lr]|left|right|inset-[lr]|border-[lr]|rounded-[lr]|rounded-[tb][lr]|scroll-m[lr]|scroll-p[lr])-/;
const PHYSICAL_EXACT = new Set([
  "text-left",
  "text-right",
  "float-left",
  "float-right",
  "clear-left",
  "clear-right",
  "border-l",
  "border-r",
  "rounded-l",
  "rounded-r",
  "rounded-tl",
  "rounded-tr",
  "rounded-bl",
  "rounded-br",
]);
const CSS_PHYSICAL =
  /\b(?:margin|padding|border)-(?:left|right)\b|(?:^|[\s;{])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)\b|float\s*:\s*(?:left|right)\b/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Comments blanked out, line breaks kept (so line numbers still match the file). */
function withoutComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Physical-direction utilities or CSS properties in one file (as "line: token"). */
function physicalUses(code: string, isCss: boolean): string[] {
  const found: string[] = [];
  const exempt = new Set(
    code.split("\n").flatMap((line, index) => (line.includes("physical-ok") ? [index] : [])),
  );
  withoutComments(code)
    .split("\n")
    .forEach((text, index) => {
      if (exempt.has(index)) return;
      if (isCss) {
        if (CSS_PHYSICAL.test(text)) found.push(`${index + 1}: ${text.trim()}`);
        return;
      }
      for (const token of text.match(/[\w\-:[\]./%!#()]+/g) ?? []) {
        const base = (token.split(":").pop() ?? "").replace(/^!/, "");
        if (PHYSICAL_PREFIX.test(base) || PHYSICAL_EXACT.has(base))
          found.push(`${index + 1}: ${token}`);
      }
    });
  return found;
}

describe("logical properties only (RTL first)", () => {
  it("the scanner catches physical utilities and properties", () => {
    expect(physicalUses('<div className="ml-2 hover:pr-4 text-left">', false)).toEqual([
      "1: ml-2",
      "1: hover:pr-4",
      "1: text-left",
    ]);
    expect(
      physicalUses('<div className="ms-2 pe-4 text-start rtl:-scale-x-100 top-0">', false),
    ).toEqual([]);
    expect(physicalUses("a { margin-left: 4px; }", true)).toHaveLength(1);
    expect(physicalUses("a { left: 0 } /* physical-ok: image space */", true)).toEqual([]);
  });

  it("renderer and print sources use none", () => {
    const offenders = ROOTS.flatMap((root) =>
      files(root).flatMap((file) =>
        physicalUses(readFileSync(file, "utf8"), file.endsWith(".css")).map(
          (hit) => `${relative(SRC, file)}:${hit}`,
        ),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
