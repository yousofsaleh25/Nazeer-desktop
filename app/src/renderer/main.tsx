import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { App } from "./App";
import { createAppStore } from "./store/store";
import "./design/fonts.css";
import "./app.css";

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing from index.html");

const store = createAppStore();

createRoot(root).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);
