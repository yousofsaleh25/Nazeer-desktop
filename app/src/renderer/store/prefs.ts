/**
 * UI preferences in localStorage (per Windows user). Only language, bilingual and theme are
 * stored: report inputs never are (D7). Storage may be missing or throw; both mean "defaults".
 */
import { UI_DEFAULTS, type UiState } from "./slices/ui";

export const UI_PREFS_KEY = "nazeer.ui.v1";

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored preferences merged over the defaults; anything malformed is ignored. */
export function loadUiPrefs(store: Storage | undefined = storage()): UiState {
  let raw: unknown;
  try {
    raw = JSON.parse(store?.getItem(UI_PREFS_KEY) ?? "null");
  } catch {
    return { ...UI_DEFAULTS };
  }
  if (typeof raw !== "object" || raw === null) return { ...UI_DEFAULTS };
  const v = raw as Record<string, unknown>;
  return {
    lang: v["lang"] === "ar" || v["lang"] === "en" ? v["lang"] : UI_DEFAULTS.lang,
    bilingual: typeof v["bilingual"] === "boolean" ? v["bilingual"] : UI_DEFAULTS.bilingual,
    theme:
      v["theme"] === "light" || v["theme"] === "dark" || v["theme"] === "system"
        ? v["theme"]
        : UI_DEFAULTS.theme,
  };
}

export function saveUiPrefs(state: UiState, store: Storage | undefined = storage()): void {
  try {
    store?.setItem(UI_PREFS_KEY, JSON.stringify(state));
  } catch {
    // a full or blocked storage only loses the preference
  }
}
