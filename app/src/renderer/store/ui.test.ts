import { afterEach, describe, expect, it } from "vitest";
import { loadUiPrefs, saveUiPrefs, UI_PREFS_KEY } from "./prefs";
import { setBilingual, setLang, setTheme, UI_DEFAULTS, uiReducer } from "./slices/ui";
import { createAppStore } from "./store";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

const throwing = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("quota");
  },
} as unknown as Storage;

describe("ui slice", () => {
  it("starts Arabic, single-language, light", () => {
    expect(uiReducer(undefined, { type: "@@init" })).toEqual({
      lang: "ar",
      bilingual: false,
      theme: "light",
    });
  });

  it("sets language, bilingual mode and theme", () => {
    let state = uiReducer(UI_DEFAULTS, setLang("en"));
    state = uiReducer(state, setBilingual(true));
    state = uiReducer(state, setTheme("system"));
    expect(state).toEqual({ lang: "en", bilingual: true, theme: "system" });
  });
});

describe("UI preference storage", () => {
  afterEach(() => window.localStorage.clear());

  it("round-trips the preferences", () => {
    const storage = memoryStorage();
    saveUiPrefs({ lang: "en", bilingual: true, theme: "dark" }, storage);
    expect(loadUiPrefs(storage)).toEqual({ lang: "en", bilingual: true, theme: "dark" });
  });

  it("falls back to the defaults for missing, malformed or foreign values", () => {
    expect(loadUiPrefs(memoryStorage())).toEqual(UI_DEFAULTS);
    expect(loadUiPrefs(memoryStorage({ [UI_PREFS_KEY]: "{not json" }))).toEqual(UI_DEFAULTS);
    expect(
      loadUiPrefs(
        memoryStorage({ [UI_PREFS_KEY]: '{"lang":"fr","bilingual":"yes","theme":"blue"}' }),
      ),
    ).toEqual(UI_DEFAULTS);
    expect(loadUiPrefs(memoryStorage({ [UI_PREFS_KEY]: '{"theme":"system"}' }))).toEqual({
      ...UI_DEFAULTS,
      theme: "system",
    });
  });

  it("never throws when storage is blocked or full", () => {
    expect(loadUiPrefs(throwing)).toEqual(UI_DEFAULTS);
    expect(() => saveUiPrefs(UI_DEFAULTS, throwing)).not.toThrow();
    expect(loadUiPrefs(undefined)).toEqual(UI_DEFAULTS);
  });

  it("the app store restores and saves the preferences", () => {
    window.localStorage.setItem(
      UI_PREFS_KEY,
      JSON.stringify({ lang: "en", bilingual: false, theme: "dark" }),
    );
    const store = createAppStore();
    expect(store.getState().ui).toEqual({ lang: "en", bilingual: false, theme: "dark" });
    store.dispatch(setLang("ar"));
    expect(JSON.parse(window.localStorage.getItem(UI_PREFS_KEY) ?? "{}")).toEqual({
      lang: "ar",
      bilingual: false,
      theme: "dark",
    });
  });
});
