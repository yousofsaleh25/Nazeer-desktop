/**
 * The print page's three kinds of text (CLAUDE.md "Arabic in the PDF"):
 * - `L`: an engine label in the report's language (`ar`, `en`, or both), each half in its own
 *   bidi isolate so the halves never mix; Latin runs inside the Arabic half get LTR isolates;
 * - `Op`: operator text (names, notes, camel id) in a `dir="auto"` isolate — its own direction
 *   from its first strong character (an English note starting with a digit is not reordered);
 * - `Tech`: identifiers, numbers and versions in an LTR isolate.
 * Isolates are elements, never inserted characters: the text layer carries the input strings.
 */
import { createContext, use, type ReactNode } from "react";
import { isolateLatin } from "@/lib/bidi";
import type { Language, Pair } from "./model";

export const LanguageContext = createContext<Language>("both");

export function L({ label, block = false }: { label: Pair; block?: boolean }) {
  const language = use(LanguageContext);
  // the same text in both languages is technical (a file name and hash, an angle): once, left to
  // right — a right-to-left line would reverse its parts
  if (label.ar === label.en) return <Tech>{label.en}</Tech>;
  const ar = (
    <span lang="ar" dir="rtl">
      {isolateLatin(label.ar)}
    </span>
  );
  if (language === "ar") return ar;
  if (language === "en") {
    return (
      <span lang="en" dir="ltr">
        {label.en}
      </span>
    );
  }
  return (
    <>
      {ar}
      {block ? <br /> : <span className="text-print-faint">{" · "}</span>}
      <span lang="en" dir="ltr" className="text-print-en">
        {label.en}
      </span>
    </>
  );
}

export function Op({ children, block = false }: { children: string; block?: boolean }) {
  return block ? <div dir="auto">{children}</div> : <bdi dir="auto">{children}</bdi>;
}

export function Tech({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={className === undefined ? "ltr" : `ltr ${className}`}>
      {children}
    </span>
  );
}
