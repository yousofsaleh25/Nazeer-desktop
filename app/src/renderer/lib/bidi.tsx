/**
 * Latin fragments inside Arabic text — engine labels such as "… مستوى Z_ref (> 10 %)", chrome
 * strings such as "… WCAG AA …" — are wrapped in LTR isolates at render time, so the Unicode
 * bidi algorithm cannot move or mirror their punctuation (the CLAUDE.md pitfall: the closing
 * parenthesis of "Z_ref (> 10 %)" jumps to the start of an RTL line). The characters are not
 * changed: the isolates are <bdi> elements, so the text a PDF's text layer carries — and what the
 * engine's text probe reads — is exactly the input string.
 */
import type { ReactNode } from "react";

/**
 * A run starts at a Latin letter or digit — or at the sign of a number ("+155.7°", "± 5.9"), when
 * the sign stands at the start, after a space or after "(" (a hyphen inside a word such as
 * "مرحلة-6" stays outside) — and ends at a letter, digit, %, ° or a bracket. Without its sign in
 * the run, a right-to-left line moves the sign to the far side of the number ("155.7°+").
 */
const LATIN_RUN =
  /(?:(?<![^\s(])[+\-−±]\s?(?=\d))?[A-Za-z0-9](?:[A-Za-z0-9_\s.,:;%+\-–/<>=()[\]°±×#]*[A-Za-z0-9_%)\]°])?/g;

/**
 * The run without the closers that belong to the surrounding Arabic text: a run ends before its
 * first unmatched ")" or "]" ("تباين العمق (MSE) 0.0231" isolates "MSE", not "MSE) 0.0231", whose
 * stray ")" would leave the "(" outside to pair with nothing), and trailing punctuation goes.
 */
function balanced(run: string): string {
  let depth = { paren: 0, bracket: 0 };
  let end = run.length;
  for (let i = 0; i < run.length; i += 1) {
    const ch = run[i];
    if (ch === "(") depth = { ...depth, paren: depth.paren + 1 };
    else if (ch === "[") depth = { ...depth, bracket: depth.bracket + 1 };
    else if ((ch === ")" && depth.paren === 0) || (ch === "]" && depth.bracket === 0)) {
      end = i;
      break;
    } else if (ch === ")") depth = { ...depth, paren: depth.paren - 1 };
    else if (ch === "]") depth = { ...depth, bracket: depth.bracket - 1 };
  }
  return run.slice(0, end).replace(/[\s.,:;+\-–/<>=([±×#]+$/, "");
}

/** Latin runs of `text` as [start, end) index pairs (exported for the tests). A run cut at a
 * closer is followed by the next run after it ("MSE", then "0.0231"). */
export function latinRuns(text: string): [number, number][] {
  const runs: [number, number][] = [];
  const pattern = new RegExp(LATIN_RUN.source, "g");
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const run = balanced(match[0]);
    if (run.length > 0) runs.push([match.index, match.index + run.length]);
    pattern.lastIndex = match.index + Math.max(run.length, 1);
  }
  return runs;
}

/** `text` with every Latin run in an LTR isolate; the plain string when there is none. */
export function isolateLatin(text: string): ReactNode {
  const runs = latinRuns(text);
  if (runs.length === 0) return text;
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of runs) {
    if (start > at) nodes.push(text.slice(at, start));
    nodes.push(
      <bdi key={start} dir="ltr">
        {text.slice(start, end)}
      </bdi>,
    );
    at = end;
  }
  if (at < text.length) nodes.push(text.slice(at));
  return nodes;
}
