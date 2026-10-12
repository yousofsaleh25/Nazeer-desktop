/**
 * The print page's own checks before main prints it (ADR-D7), so a page the engine would refuse
 * is not printed, and the operator learns why in the app's words:
 * - the face: the engine's TTF loaded as "Nazeer Print Plex";
 * - every text node: drawn in that face, weight 400, normal style (no synthesized bold/italic);
 * - every required string (SessionView.required_report_texts): on the page verbatim, and found by
 *   the same run matching as the engine's text probe (`normalizeText` / `nameRuns` port);
 * - every character: in the face's cmap (plex-cmap.json; default-ignorables and spaces skipped).
 *   A required string with a character the face lacks stops the print (it could only be drawn in
 *   a fallback face); elsewhere (a note, an observation) it is a warning and prints anyway;
 * - every image decoded; the overlay at its natural size, full width, no filter or opacity.
 */
import type { PreflightProblem, PrintPreflight } from "@shared/ipc";
import { PRINT_FONT_FAMILY } from "./face";
import cmap from "./plex-cmap.json";

export { PRINT_FONT_FAMILY };

// --- the engine's pdf_finalize.normalize_text / name_runs, ported -----------------------------

type Range = readonly [number, number];

const STRIP_RANGES: readonly Range[] = [
  [0x064b, 0x065f], // harakat
  [0x0670, 0x0670], // superscript alef
  [0x0640, 0x0640], // tatweel
  [0x200b, 0x200f], // zero-width space .. right-to-left mark
  [0x202a, 0x202e], // bidi embeddings / overrides
  [0x2066, 0x2069], // bidi isolates
];

const ARABIC_RANGES: readonly Range[] = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];

/** Python's str.isspace() (what `\s` matches in the engine's patterns). */
const PY_SPACE: readonly Range[] = [
  [0x09, 0x0d],
  [0x1c, 0x20],
  [0x85, 0x85],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];

function inRanges(cp: number, ranges: readonly Range[]): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const range = ranges[mid] as Range;
    if (cp < range[0]) hi = mid - 1;
    else if (cp > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

const isSpace = (cp: number) => inRanges(cp, PY_SPACE);
const isStripped = (cp: number) => isSpace(cp) || STRIP_RANGES.some(([a, b]) => cp >= a && cp <= b);
const isArabic = (cp: number) => ARABIC_RANGES.some(([a, b]) => cp >= a && cp <= b);
const LETTER_OR_NUMBER = /^[\p{L}\p{N}]$/u;

/** NFKC, then harakat, tatweel, bidi controls and all whitespace removed. */
export function normalizeText(text: string): string {
  let out = "";
  for (const ch of (text ?? "").normalize("NFKC")) {
    if (!isStripped(ch.codePointAt(0) as number)) out += ch;
  }
  return out;
}

/** Maximal runs of Arabic letters or of other letters/digits, normalised (punctuation and
 * symbols separate runs: the bidi algorithm decides where they land in the text layer). */
export function nameRuns(name: string): string[] {
  const runs: string[] = [];
  let current = "";
  let currentKind: "arabic" | "other" | null = null;
  for (const ch of (name ?? "").normalize("NFKC")) {
    const cp = ch.codePointAt(0) as number;
    let kind: "arabic" | "other" | null;
    if (isSpace(cp)) kind = null;
    else if (isStripped(cp)) continue;
    else if (isArabic(cp)) kind = "arabic";
    else if (LETTER_OR_NUMBER.test(ch)) kind = "other";
    else kind = null;
    if (kind !== currentKind && current) {
      runs.push(current);
      current = "";
    }
    currentKind = kind;
    if (kind !== null) current += ch;
  }
  if (current) runs.push(current);
  return runs.map(normalizeText).filter((run) => run.length > 0);
}

// --- the face's coverage ------------------------------------------------------------------------

const COVERED: readonly Range[] = (cmap.ranges as [number, number][]).map(([a, b]): Range => [
  a,
  b,
]);
const IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;

/** True when the face draws `ch` (or nothing has to be drawn for it). */
export function faceCovers(ch: string): boolean {
  const cp = ch.codePointAt(0) as number;
  if (isSpace(cp) || IGNORABLE.test(ch)) return true;
  return inRanges(cp, COVERED);
}

/** The characters of `text` the face cannot draw (each once, in order). */
export function uncovered(text: string): string[] {
  const missing: string[] = [];
  for (const ch of text) if (!faceCovers(ch) && !missing.includes(ch)) missing.push(ch);
  return missing;
}

export const cmapSha256: string = cmap.sha256;

const hex = (ch: string) =>
  `U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}`;

// --- the page checks ----------------------------------------------------------------------------

export interface PreflightInput {
  /** the page's root (document.body in the print window) */
  root: HTMLElement;
  face: FontFace | null;
  fontsCheck: (font: string) => boolean;
  requiredTexts: readonly string[];
  overlay: { width: number; height: number };
  getStyle?: (element: Element) => CSSStyleDeclaration;
}

const SAMPLES = 8;

function firstFamily(fontFamily: string): string {
  const first = fontFamily.split(",")[0] ?? "";
  return first.trim().replace(/^["']|["']$/g, "");
}

export function runPreflight(input: PreflightInput): PrintPreflight {
  const { root, requiredTexts } = input;
  const style = input.getStyle ?? ((element: Element) => getComputedStyle(element));
  const problems: PreflightProblem[] = [];
  const warnings: PreflightProblem[] = [];

  // the face
  if (input.face === null || input.face.status !== "loaded") {
    problems.push({
      code: "print_font_not_loaded",
      message: "the report's face did not load",
      details: { status: input.face?.status ?? "missing" },
    });
  } else if (!input.fontsCheck(`12px "${PRINT_FONT_FAMILY}"`)) {
    problems.push({
      code: "print_font_not_loaded",
      message: "the document does not report the report's face as ready",
      details: {},
    });
  }

  // every text node: the face, weight 400, normal style; collect the characters
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const wrongFace: string[] = [];
  const wrongWeight: string[] = [];
  let textNodes = 0;
  let characters = 0;
  const uncoveredAt = new Map<string, string[]>();
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const value = node.nodeValue ?? "";
    if (value.trim() === "") continue;
    const parent = node.parentElement;
    if (parent === null) continue;
    textNodes += 1;
    characters += [...value].length;
    const cs = style(parent);
    if (firstFamily(cs.fontFamily) !== PRINT_FONT_FAMILY && wrongFace.length < SAMPLES) {
      wrongFace.push(`${cs.fontFamily}: ${value.slice(0, 40)}`);
    }
    if ((cs.fontWeight !== "400" || cs.fontStyle !== "normal") && wrongWeight.length < SAMPLES) {
      wrongWeight.push(`${cs.fontWeight} ${cs.fontStyle}: ${value.slice(0, 40)}`);
    }
    for (const ch of uncovered(value)) {
      const where = uncoveredAt.get(ch) ?? [];
      if (where.length < 3) where.push(value.slice(0, 60));
      uncoveredAt.set(ch, where);
    }
  }
  if (wrongFace.length > 0) {
    problems.push({
      code: "print_face_mismatch",
      message: `text is not drawn in "${PRINT_FONT_FAMILY}"`,
      details: { samples: wrongFace },
    });
  }
  if (wrongWeight.length > 0) {
    problems.push({
      code: "print_synthesized_face",
      message: "text asks for a bold or italic face, which would be synthesized (Type3 glyphs)",
      details: { samples: wrongWeight },
    });
  }

  // the required strings: verbatim, and by the engine's run matching
  const content = root.textContent ?? "";
  const haystack = normalizeText(root.innerText ?? content);
  const notVerbatim: string[] = [];
  const runsMissing: { text: string; runs: string[] }[] = [];
  const glyphsMissing: { text: string; characters: string[] }[] = [];
  for (const text of requiredTexts) {
    if (text.trim() === "") continue;
    if (!content.includes(text)) notVerbatim.push(text);
    const missing = nameRuns(text).filter((run) => !haystack.includes(run));
    if (missing.length > 0) runsMissing.push({ text, runs: missing });
    const lacking = uncovered(text);
    if (lacking.length > 0) glyphsMissing.push({ text, characters: lacking.map(hex) });
  }
  if (notVerbatim.length > 0 || runsMissing.length > 0) {
    problems.push({
      code: "print_required_text_missing",
      message: "a name the engine's text probe requires is not on the page as given",
      details: { not_verbatim: notVerbatim, runs_missing: runsMissing },
    });
  }
  if (glyphsMissing.length > 0) {
    problems.push({
      code: "print_glyph_missing",
      message: "a required name has a character the report's face cannot draw",
      details: { names: glyphsMissing },
    });
  }
  const required = new Set(requiredTexts.flatMap((text) => uncovered(text)));
  const elsewhere = [...uncoveredAt.entries()].filter(([ch]) => !required.has(ch));
  if (elsewhere.length > 0) {
    warnings.push({
      code: "print_glyph_fallback",
      message: "some characters are drawn in a fallback face (not in IBM Plex Sans Arabic)",
      details: {
        characters: elsewhere.map(([ch, where]) => ({ code_point: hex(ch), char: ch, in: where })),
      },
    });
  }

  // images: decoded; the overlay at its natural size, full width, untouched
  const images = [...root.querySelectorAll("img")];
  const broken = images
    .filter((img) => !img.complete || img.naturalWidth === 0)
    .map((img) => img.src);
  if (broken.length > 0) {
    problems.push({
      code: "print_image_not_decoded",
      message: "an image on the page did not decode",
      details: { images: broken.length },
    });
  }
  const overlay = root.querySelector<HTMLImageElement>('img[data-role="overlay"]');
  if (overlay === null) {
    problems.push({
      code: "print_overlay_missing",
      message: "the overlay is not on the page",
      details: {},
    });
  } else {
    const cs = style(overlay);
    const issues: string[] = [];
    if (
      overlay.naturalWidth !== input.overlay.width ||
      overlay.naturalHeight !== input.overlay.height
    ) {
      issues.push(
        `natural size ${overlay.naturalWidth} x ${overlay.naturalHeight}, ` +
          `expected ${input.overlay.width} x ${input.overlay.height}`,
      );
    }
    if (cs.opacity !== "1") issues.push(`opacity ${cs.opacity}`);
    if (cs.filter !== "none") issues.push(`filter ${cs.filter}`);
    if (cs.mixBlendMode !== "normal") issues.push(`blend ${cs.mixBlendMode}`);
    if (cs.objectFit !== "fill") issues.push(`object-fit ${cs.objectFit}`);
    if (issues.length > 0) {
      problems.push({
        code: "print_overlay_altered",
        message: "the overlay would not print as the approved pixels",
        details: { issues },
      });
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    checked: {
      requiredTexts: requiredTexts.filter((text) => text.trim() !== "").length,
      textNodes,
      characters,
      images: images.length,
    },
  };
}

/** A failed result for a page that could not be laid out at all. */
export function failedPreflight(code: string, message: string, details = {}): PrintPreflight {
  return {
    ok: false,
    problems: [{ code, message, details }],
    warnings: [],
    checked: { requiredTexts: 0, textNodes: 0, characters: 0, images: 0 },
  };
}
