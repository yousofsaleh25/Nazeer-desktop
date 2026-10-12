// The print page's face coverage: src/print/plex-cmap.json lists the code points the engine's
// pinned IBM Plex Sans Arabic Regular maps (read with fontTools from the engine venv), with the
// TTF's SHA-256. The print pre-flight refuses a required string with a character outside it (a
// fallback face would draw it), and a test fails when the TTF and this file disagree.
//
//   node scripts/gen-font-cmap.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = path.resolve(appDir, "..", "engine");
const python = path.join(engineDir, ".venv", "Scripts", "python.exe");
const font = path.join(
  engineDir,
  "nazeer_engine",
  "assets",
  "fonts",
  "IBMPlexSansArabic-Regular.ttf",
);
const out = path.join(appDir, "src", "print", "plex-cmap.json");

const READ_CMAP = [
  "import json, sys",
  "from fontTools.ttLib import TTFont",
  "font = TTFont(sys.argv[1])",
  "print(json.dumps(sorted(font.getBestCmap())))",
].join("\n");

const codePoints = JSON.parse(
  execFileSync(python, ["-I", "-c", READ_CMAP, font], { encoding: "utf8" }),
);
const ranges = [];
for (const cp of codePoints) {
  const last = ranges[ranges.length - 1];
  if (last !== undefined && cp === last[1] + 1) last[1] = cp;
  else ranges.push([cp, cp]);
}
const sha256 = createHash("sha256").update(readFileSync(font)).digest("hex");
const data = {
  font: path.basename(font),
  sha256,
  codePoints: codePoints.length,
  ranges,
};
writeFileSync(out, `${JSON.stringify(data)}\n`, "utf8");
console.log(
  `${out}: ${codePoints.length} code points in ${ranges.length} ranges, sha256 ${sha256}`,
);
