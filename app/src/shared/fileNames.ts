/**
 * Default file names for the user's copy of a sealed PDF (D12 F1.5): pure, shared by the renderer
 * (which builds the suggested name) and main (which sanitises whatever arrives again before the
 * Save dialog shows it).
 *
 * - a session: `<camel id, else session id>_<YYYY-MM-DD>.pdf`, the day the camel was measured (the
 *   session's `created_at`, local time); `_v<N>` for a report version N > 1;
 * - a comparison: `مقارنة_<n>_<date>.pdf` / `comparison_<n>_camels_<date>.pdf` by UI language.
 *
 * Sanitising keeps Arabic letters and spaces and makes the name safe on Windows: illegal
 * characters and controls become `_`; Unicode format characters (`\p{Cf}`: bidi controls, zero
 * widths) are removed, since a right-to-left override can make `evil_fdp.exe` read as a PDF;
 * reserved device names get a `_` prefix; trailing dots and spaces go (Windows drops them
 * silently); the name before `.pdf` is cut to 120 code points, never inside a surrogate pair.
 */

export const MAX_BASE_CODE_POINTS = 120;
export const PDF_EXTENSION = ".pdf";
const FALLBACK_BASE = "report";

/** CON, PRN, AUX, NUL, COM0–9, LPT0–9, and COM/LPT with a superscript 1–3 (Windows reserves all). */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const ILLEGAL = /[<>:"/\\|?*\p{Cc}]/gu;
const FORMAT = /\p{Cf}/gu;

function codePoints(text: string): string[] {
  return Array.from(text);
}

/** A file name without its extension, safe on Windows (see the module comment). */
export function sanitizeBaseName(raw: string): string {
  let name = raw.normalize("NFC").replace(FORMAT, "").replace(ILLEGAL, "_");
  name = name.replace(/\s+/gu, " ").replace(/_{2,}/g, "_").trim();
  // Windows drops trailing dots and spaces; a name made only of them is empty
  name = name.replace(/[. ]+$/u, "");
  const points = codePoints(name);
  if (points.length > MAX_BASE_CODE_POINTS) {
    name = points
      .slice(0, MAX_BASE_CODE_POINTS)
      .join("")
      .replace(/[. ]+$/u, "");
  }
  if (name === "") name = FALLBACK_BASE;
  // "CON", "con.backup" and "COM1" name devices whatever extension follows
  const stem = name.split(".")[0] ?? name;
  if (RESERVED.test(stem.trim())) name = `_${name}`;
  return name;
}

/** `name` with a `.pdf` extension (one is added unless it already ends in `.pdf`, any case). */
export function ensurePdfExtension(name: string): string {
  return name.toLowerCase().endsWith(PDF_EXTENSION) ? name : `${name}${PDF_EXTENSION}`;
}

/** A suggested name from anywhere, made safe: any folder part dropped, sanitised, `.pdf`. */
export function sanitizeSuggestedName(raw: string): string {
  const last = raw.split(/[\\/]/).pop() ?? "";
  const base = last.toLowerCase().endsWith(PDF_EXTENSION)
    ? last.slice(0, -PDF_EXTENSION.length)
    : last;
  return `${sanitizeBaseName(base)}${PDF_EXTENSION}`;
}

/** `YYYY-MM-DD` of an ISO instant in the computer's local time; `now` when it does not parse. */
export function localDateStamp(iso: string | null | undefined, now: Date = new Date()): string {
  const parsed = iso ? new Date(iso) : null;
  const date = parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : now;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function versionSuffix(version: number): string {
  return Number.isSafeInteger(version) && version > 1 ? `_v${version}` : "";
}

export interface SessionNameInput {
  camelId: string;
  sessionId: string;
  /** the session's `created_at` (ISO, UTC) */
  createdAt: string | null;
  /** the sealed report's version */
  version: number;
}

/** `<camel id, else session id>_<measuring day>[_v<N>].pdf`. */
export function sessionReportFileName(input: SessionNameInput, now?: Date): string {
  const base = input.camelId.trim() || input.sessionId;
  const date = localDateStamp(input.createdAt, now);
  return `${sanitizeBaseName(`${base}_${date}${versionSuffix(input.version)}`)}${PDF_EXTENSION}`;
}

/** The Arabic word for "comparison" (the default name in the Arabic UI). */
export const COMPARISON_WORD_AR = "مقارنة";

export interface ComparisonNameInput {
  /** how many camels the comparison holds */
  members: number;
  /** the comparison's `created_at` (ISO, UTC) */
  createdAt: string | null;
  version: number;
  lang: "ar" | "en";
}

/** `مقارنة_<n>_<date>.pdf` or `comparison_<n>_camels_<date>.pdf` (`_v<N>` for N > 1). */
export function comparisonReportFileName(input: ComparisonNameInput, now?: Date): string {
  const date = localDateStamp(input.createdAt, now);
  const n = String(Math.max(0, Math.floor(input.members)));
  const base =
    input.lang === "ar" ? `${COMPARISON_WORD_AR}_${n}_${date}` : `comparison_${n}_camels_${date}`;
  return `${sanitizeBaseName(`${base}${versionSuffix(input.version)}`)}${PDF_EXTENSION}`;
}
