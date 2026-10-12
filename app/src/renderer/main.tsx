import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import type { NazeerApi } from "@shared/ipc";
import { App } from "./App";
import { connectEngineBridge } from "./store/engineBridge";
import { flushAutosave } from "./store/session/flush";
import { createAppStore } from "./store/store";
import "./design/fonts.css";
import "./app.css";

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing from index.html");

const store = createAppStore();
const bridge = (window as { nazeer?: NazeerApi }).nazeer;
connectEngineBridge(store, bridge?.engine);
// quitting: the pending autosave goes out first; main asks the operator if work stays unsaved
bridge?.app.onBeforeQuit(() => flushAutosave(store));

createRoot(root).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);
