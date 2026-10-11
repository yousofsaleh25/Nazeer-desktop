/** UI preferences: language, bilingual labels, theme (only these may persist across runs). */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Lang } from "@/design/language";

export type ThemePreference = "light" | "dark" | "system";

export interface UiState {
  lang: Lang;
  /** "show both languages": every bilingual label renders its Arabic and English halves */
  bilingual: boolean;
  theme: ThemePreference;
}

export const UI_DEFAULTS: UiState = { lang: "ar", bilingual: false, theme: "light" };

const uiSlice = createSlice({
  name: "ui",
  initialState: UI_DEFAULTS,
  reducers: {
    setLang(state, action: PayloadAction<Lang>) {
      state.lang = action.payload;
    },
    setBilingual(state, action: PayloadAction<boolean>) {
      state.bilingual = action.payload;
    },
    setTheme(state, action: PayloadAction<ThemePreference>) {
      state.theme = action.payload;
    },
  },
});

export const { setLang, setBilingual, setTheme } = uiSlice.actions;
export const uiReducer = uiSlice.reducer;
