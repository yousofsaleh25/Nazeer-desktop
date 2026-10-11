// Every error code the engine can put in {"error": {"code": …}} — including the sidecar's fatal
// line and the PDF probe's failure codes (an upload's 409 carries the first hard failure) — read
// from engine/nazeer_engine/**/*.py. /meta/labels has no labels for these, so the app's i18n
// carries them (D9); src/renderer/i18n/i18n.test.ts fails when one is missing.
//
//   node scripts/gen-engine-codes.mjs           write src/shared/engine-codes.json
//   node scripts/gen-engine-codes.mjs --check   exit 1 when the committed file is stale
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = path.resolve(appDir, "..", "engine", "nazeer_engine");
const target = path.join(appDir, "src", "shared", "engine-codes.json");

const PATTERNS = [
  /\bcode(?:\s*:\s*str)?\s*=\s*"([a-z_]+)"/g, // EngineError(code="x") and class attributes
  /"code"\s*:\s*"([a-z_]+)"/g, // literal error bodies and probe hints
  /\b_error\(\s*"([a-z_]+)"/g, // api/app.py helper
  /\b_fatal\(\s*"([a-z_]+)"/g, // the sidecar's fatal line (__main__.py)
  /\b\d{3}:\s*"([a-z_]+)"/g, // api/app.py STATUS_CODES
  /STATUS_CODES\.get\([^,]+,\s*"([a-z_]+)"\)/g, // its fallback
];
// pdf_finalize.py: pixel-probe reasons and the hard / soft failure lists
const PROBE_PATTERNS = [/\breason = "([a-z_]+)"/g, /\.append\("([a-z_]+)"\)/g];

async function pythonFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "__pycache__") out.push(...(await pythonFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".py")) out.push(full);
  }
  return out;
}

const codes = new Set();
for (const file of await pythonFiles(engineDir)) {
  const source = await readFile(file, "utf8");
  const patterns =
    path.basename(file) === "pdf_finalize.py" ? [...PATTERNS, ...PROBE_PATTERNS] : PATTERNS;
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) codes.add(match[1]);
  }
}

const generated = `${JSON.stringify(
  {
    generated_by:
      "app/scripts/gen-engine-codes.mjs from engine/nazeer_engine/**/*.py (npm run gen:codes)",
    errors: [...codes].sort(),
  },
  null,
  2,
)}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(target, "utf8").catch(() => "");
  if (current.replace(/\r\n/g, "\n") !== generated) {
    console.error("src/shared/engine-codes.json is stale: run `npm run gen:codes`");
    process.exit(1);
  }
  console.log("src/shared/engine-codes.json is up to date with the engine source");
} else {
  await writeFile(target, generated, "utf8");
  console.log(`wrote src/shared/engine-codes.json (${codes.size} codes)`);
}
