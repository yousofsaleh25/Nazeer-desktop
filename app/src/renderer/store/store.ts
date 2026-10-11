/** The Redux store. Stage 2: the `ui` slice; the engine/session/history/report slices join in Stage 5. */
import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { loadUiPrefs, saveUiPrefs } from "./prefs";
import { uiReducer } from "./slices/ui";

const rootReducer = combineReducers({ ui: uiReducer });

export type RootState = ReturnType<typeof rootReducer>;

export function makeStore(preloadedState?: Partial<RootState>) {
  return configureStore({ reducer: rootReducer, preloadedState });
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore["dispatch"];

/** The app's store: preferences restored, and saved whenever they change. */
export function createAppStore(): AppStore {
  const store = makeStore({ ui: loadUiPrefs() });
  let last = store.getState().ui;
  store.subscribe(() => {
    const ui = store.getState().ui;
    if (ui !== last) {
      last = ui;
      saveUiPrefs(ui);
    }
  });
  return store;
}
