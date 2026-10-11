import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Lang } from "@/design/language";
import type { ThemePreference } from "@/store/slices/ui";
import { resolveTheme, useDocumentPreferences } from "./document";

function Probe({ lang, theme }: { lang: Lang; theme: ThemePreference }) {
  useDocumentPreferences(lang, theme);
  return null;
}

describe("document preferences", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("sets <html lang dir data-theme>", () => {
    const { rerender } = render(<Probe lang="ar" theme="light" />);
    const html = document.documentElement;
    expect([html.lang, html.dir, html.dataset["theme"]]).toEqual(["ar", "rtl", "light"]);
    rerender(<Probe lang="en" theme="dark" />);
    expect([html.lang, html.dir, html.dataset["theme"]]).toEqual(["en", "ltr", "dark"]);
  });

  it("system follows the operating system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
