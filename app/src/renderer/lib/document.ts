/** <html lang dir data-theme> follow the UI preferences; Arabic (RTL) is the default. */
import { useLayoutEffect, useSyncExternalStore } from "react";
import { dirOf, type Lang } from "@/design/language";
import type { ThemePreference } from "@/store/slices/ui";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function darkQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const query = darkQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

export function useDocumentPreferences(lang: Lang, theme: ThemePreference): "light" | "dark" {
  const systemDark = useSyncExternalStore(
    subscribe,
    () => darkQuery()?.matches ?? false,
    () => false,
  );
  const resolved = resolveTheme(theme, systemDark);
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = dirOf(lang);
    html.dataset["theme"] = resolved;
  }, [lang, resolved]);
  return resolved;
}
