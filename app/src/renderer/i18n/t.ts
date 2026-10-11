/**
 * Chrome strings (ar.json / en.json). Codes that /meta/labels labels are never translated here.
 * Codes it does not label are: API error codes (open set: unknown → raw code + engine message),
 * History index states and job stages (closed unions from the API types: a missing key is a
 * compile error in indexStateLabel / jobStageLabel). D9, i18n.test.ts.
 */
import { useCallback } from "react";
import type { components } from "@shared/api";
import type { BiText } from "@/components/ui/Bi";
import { useLanguage, type Lang } from "@/design/language";
import ar from "./ar.json";
import en from "./en.json";

export type Messages = typeof en;

/** Typed so the Arabic catalogue must have every key of the English one. */
const catalogs: Record<Lang, Messages> = { ar, en };

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;

function lookup(messages: Messages, key: MessageKey): string {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    node =
      typeof node === "object" && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  return typeof node === "string" ? node : key;
}

export function translate(lang: Lang, key: MessageKey): string {
  return lookup(catalogs[lang], key);
}

/** Both halves, for <Bi {...messagePair(key)} />. */
export function messagePair(key: MessageKey): BiText {
  return { ar: translate("ar", key), en: translate("en", key) };
}

/** `t(key)` in the selected UI language (for attributes such as aria-label and title). */
export function useT(): (key: MessageKey) => string {
  const { lang } = useLanguage();
  return useCallback((key: MessageKey) => translate(lang, key), [lang]);
}

/** A bilingual text as one plain string in the UI language (aria-label, title, alt). */
export function useBiString(): (text: BiText) => string {
  const { lang } = useLanguage();
  return useCallback((text: BiText) => text[lang], [lang]);
}

type IndexState = NonNullable<components["schemas"]["SessionView"]["index_state"]>;
type JobStage = components["schemas"]["JobSnapshot"]["stage"];

export function indexStateLabel(state: IndexState): BiText {
  return { ar: ar.indexStates[state], en: en.indexStates[state] };
}

export function jobStageLabel(stage: JobStage): BiText {
  return { ar: ar.jobStages[stage], en: en.jobStages[stage] };
}

/**
 * The bilingual label of an error code: the engine's codes (`errors`) and the app's own checks
 * (`appErrors`: network failure, unexpected response, overlay hash); null when the code is unknown.
 */
export function errorLabel(code: string): BiText | null {
  for (const group of ["errors", "appErrors"] as const) {
    const arText = (ar[group] as Record<string, string>)[code];
    const enText = (en[group] as Record<string, string>)[code];
    if (arText !== undefined && enText !== undefined) return { ar: arText, en: enText };
  }
  return null;
}
