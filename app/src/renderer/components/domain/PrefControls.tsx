/** Language, "show both languages" and theme: the UI preferences in the `ui` slice. */
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setBilingual, setLang, setTheme, type ThemePreference } from "@/store/slices/ui";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { messagePair, useT } from "@/i18n/t";
import { cn } from "@/lib/cn";

const LANGS = ["ar", "en"] as const;
const THEMES: readonly ThemePreference[] = ["light", "dark", "system"];
const THEME_KEYS = {
  light: "prefs.themeLight",
  dark: "prefs.themeDark",
  system: "prefs.themeSystem",
} as const;

export function PrefControls({ className }: { className?: string }) {
  const dispatch = useAppDispatch();
  const ui = useAppSelector((state) => state.ui);
  const t = useT();
  return (
    <div className={cn("flex flex-wrap items-center gap-3 text-sm", className)}>
      <div
        role="group"
        aria-label={t("prefs.language")}
        className="flex overflow-hidden rounded-md border border-border-control"
      >
        {LANGS.map((lang) => (
          <button
            key={lang}
            type="button"
            aria-pressed={ui.lang === lang}
            onClick={() => dispatch(setLang(lang))}
            className={cn(
              "min-h-8 px-3",
              ui.lang === lang ? "bg-primary text-primary-fg" : "bg-surface hover:bg-surface-hover",
            )}
          >
            <span lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
              {t(lang === "ar" ? "prefs.arabic" : "prefs.english")}
            </span>
          </button>
        ))}
      </div>
      <Switch
        checked={ui.bilingual}
        onCheckedChange={(checked) => dispatch(setBilingual(checked))}
        label={messagePair("prefs.bilingual")}
      />
      <Select
        aria-label={t("prefs.theme")}
        value={ui.theme}
        onValueChange={(theme) => dispatch(setTheme(theme))}
        options={THEMES.map((theme) => ({ value: theme, label: messagePair(THEME_KEYS[theme]) }))}
        className="w-auto min-w-28"
      />
    </div>
  );
}
