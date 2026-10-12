import { act, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it } from "vitest";
import { setEngineConnection } from "@/api/connection";
import { connectFixtureEngine, engineState } from "@/test/engine";
import { App } from "./App";
import { setBilingual, setLang } from "./store/slices/ui";
import { makeStore } from "./store/store";

afterEach(() => {
  setEngineConnection(null);
});

describe("App", () => {
  it("starts in Arabic, right-to-left, and switches language and direction", async () => {
    connectFixtureEngine();
    const store = makeStore({ engine: engineState() });
    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("نظير");
    expect(document.documentElement.dir).toBe("rtl");

    act(() => {
      store.dispatch(setLang("en"));
    });
    expect(heading).toHaveTextContent("Nazeer");
    expect(document.documentElement.dir).toBe("ltr");

    act(() => {
      store.dispatch(setBilingual(true));
    });
    expect(within(heading).getByText("نظير")).toHaveAttribute("lang", "ar");
    expect(within(heading).getByText("Nazeer")).toHaveAttribute("lang", "en");
  });

  it("shows the engine waiting panel, not a screen, until the engine is ready", () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("status", { name: "المحرك يبدأ التشغيل" })).toBeInTheDocument();
  });
});
