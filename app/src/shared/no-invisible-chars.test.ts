import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Bidi controls, zero-width characters and unusual spaces are invisible in an editor, so source
// never contains them literally: build them with String.fromCharCode (CLAUDE.md "Python style"
// rule, applied to the app; the engine has the same test).
const APP = resolve(__dirname, "../..");
const ROOTS = ["src", "scripts", "e2e"].map((dir) => join(APP, dir));
const FORMAT = /\p{Cf}/u;
const ODD_SPACES = new Set([
  0xa0, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x202f, 0x205f, 0x3000,
]);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(tsx?|mjs|css|html|json|md)$/.test(entry.name) ? [full] : [];
  });
}

describe("source files", () => {
  it("contain no invisible format characters or unusual spaces", () => {
    const hits: string[] = [];
    for (const file of ROOTS.flatMap(files)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const ch of line) {
            const code = ch.codePointAt(0) ?? 0;
            if (FORMAT.test(ch) || ODD_SPACES.has(code)) {
              hits.push(
                `${relative(APP, file)}:${index + 1}: U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
              );
            }
          }
        });
    }
    expect(hits).toEqual([]);
  });
});
