/**
 * Latin fragments inside Arabic text — engine labels such as "… مستوى Z_ref (> 10 %)", chrome
 * strings such as "… WCAG AA …" — are wrapped in LTR isolates at render time, so the Unicode
 * bidi algorithm cannot move or mirror their punctuation (the CLAUDE.md pitfall: the closing
 * parenthesis of "Z_ref (> 10 %)" jumps to the start of an RTL line). The characters are not
 * changed: the isolates are <bdi> elements, so the text a PDF's text layer carries — and what the
 * engine's text probe reads — is exactly the input string.
 */
import type { ReactNode } from "react";

/** A run starts at a Latin letter or digit and ends at a letter, digit, %, ° or a bracket. */
const LATIN_RUN = /[A-Za-z0-9](?:[A-Za-z0-9_\s.,:;%+\-–/<>=()[\]°±×#]*[A-Za-z0-9_%)\]°])?/g;

/** Drop trailing closers that belong to the surrounding Arabic text ("(مستوى Z_ref)"). */
function balanced(run: string): string {
  let text = run;
  const count = (s: string, ch: string) => s.split(ch).length - 1;
  while (
    (text.endsWith(")") && count(text, ")") > count(text, "(")) ||
    (text.endsWith("]") && count(text, "]") > count(text, "["))
  ) {
    text = text.slice(0, -1).replace(/[\s.,:;]+$/, "");
  }
  return text;
}

/** Latin runs of `text` as [start, end) index pairs (exported for the tests). */
export function latinRuns(text: string): [number, number][] {
  const runs: [number, number][] = [];
  for (const match of text.matchAll(LATIN_RUN)) {
    const run = balanced(match[0]);
    if (run.length > 0) runs.push([match.index, match.index + run.length]);
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
