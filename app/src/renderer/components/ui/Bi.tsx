/**
 * A bilingual label (engine labels from /meta/labels, chrome strings from i18n): each language in
 * its own `lang` + `dir` isolate, so an Arabic half and an English half never reorder each other;
 * Latin fragments inside the Arabic half get their own LTR isolates (lib/bidi.tsx).
 */
import { isolateLatin } from "@/lib/bidi";
import { cn } from "@/lib/cn";
import { useLanguage, type BiMode } from "@/design/language";

export interface BiText {
  ar: string;
  en: string;
}

export interface BiProps extends BiText {
  /** defaults to the UI setting (selected language, or both when "show both languages" is on) */
  mode?: BiMode;
  /** stack the two halves instead of joining them with " · " */
  block?: boolean;
  className?: string;
}

export function Bi({ ar, en, mode, block = false, className }: BiProps) {
  const ui = useLanguage();
  const shown = mode ?? ui.mode;
  if (shown !== "both") {
    return (
      <span lang={shown} dir={shown === "ar" ? "rtl" : "ltr"} className={className}>
        {shown === "ar" ? isolateLatin(ar) : en}
      </span>
    );
  }
  return (
    <span className={cn(block ? "inline-flex flex-col items-start" : "inline", className)}>
      <span lang="ar" dir="rtl">
        {isolateLatin(ar)}
      </span>
      {block ? null : (
        <span aria-hidden="true" className="text-ink-muted">
          {" · "}
        </span>
      )}
      <span lang="en" dir="ltr" className={block ? "text-[0.92em] text-ink-secondary" : undefined}>
        {en}
      </span>
    </span>
  );
}
