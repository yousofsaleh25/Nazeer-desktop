/**
 * The Redux store: `ui` (preferences), `engine` (the supervisor's status), `license` (main's
 * licence gate), `bag` (the bag opened), `candidates` (the frame-proposal job and its set),
 * `session` (the open session: draft, autosave, hover and preview), `report` (the overlay check and
 * approval), `history` (History's query) and the RTK Query cache (`engineApi`). The listener
 * middleware runs autosave, the hover and preview channels, finalize and the candidate job
 * (store/listeners); each store gets its own (tests build many).
 */
import { combineReducers, configureStore, createListenerMiddleware } from "@reduxjs/toolkit";
import { engineApi } from "@/api/engineApi";
import type { AppStartListening } from "./listener";
import { startAutosave } from "./listeners/autosave";
import { startCandidateJobs } from "./listeners/candidates";
import { startFinalize } from "./listeners/finalize";
import { startProbes } from "./listeners/probes";
import { loadUiPrefs, saveUiPrefs } from "./prefs";
import { bagReducer } from "./slices/bag";
import { candidatesReducer } from "./slices/candidates";
import { engineReducer } from "./slices/engine";
import { historyReducer } from "./slices/history";
import { licenseReducer } from "./slices/license";
import { reportReducer } from "./slices/report";
import { sessionReducer } from "./slices/session";
import { uiReducer } from "./slices/ui";

const rootReducer = combineReducers({
  ui: uiReducer,
  engine: engineReducer,
  license: licenseReducer,
  bag: bagReducer,
  candidates: candidatesReducer,
  session: sessionReducer,
  report: reportReducer,
  history: historyReducer,
  [engineApi.reducerPath]: engineApi.reducer,
});

export type RootState = ReturnType<typeof rootReducer>;

export function makeStore(preloadedState?: Partial<RootState>) {
  const listener = createListenerMiddleware();
  const store = configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: (getDefault) =>
      getDefault().prepend(listener.middleware).concat(engineApi.middleware),
  });
  const startListening = listener.startListening as AppStartListening;
  startAutosave(startListening);
  startProbes(startListening);
  startFinalize(startListening);
  startCandidateJobs(startListening);
  return store;
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
