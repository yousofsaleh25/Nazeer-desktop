/**
 * Which language the UI speaks and how bilingual labels render, fed from the `ui` slice. (The
 * print page has its own, smaller context: src/print/text.tsx, from the report model's explicit
 * `language` input.)
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

export type Lang = "ar" | "en";
/** `both` = each half in its own direction isolate, Arabic first (the PDF's "both" layout). */
export type BiMode = Lang | "both";

export interface LanguageState {
  lang: Lang;
  mode: BiMode;
}

const LanguageContext = createContext<LanguageState>({ lang: "ar", mode: "ar" });

export function dirOf(lang: Lang): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

export function LanguageProvider({
  lang,
  bilingual,
  children,
}: {
  lang: Lang;
  bilingual: boolean;
  children: ReactNode;
}) {
  const value = useMemo<LanguageState>(
    () => ({ lang, mode: bilingual ? "both" : lang }),
    [lang, bilingual],
  );
  return <LanguageContext value={value}>{children}</LanguageContext>;
}

export function useLanguage(): LanguageState {
  return useContext(LanguageContext);
}
