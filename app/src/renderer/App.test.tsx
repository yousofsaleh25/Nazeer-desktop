import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { setBilingual, setLang } from "./store/slices/ui";
import { makeStore } from "./store/store";

describe("App", () => {
  it("starts in Arabic, right-to-left, and switches language and direction", () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );
    const heading = screen.getByRole("heading", { level: 1 });
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
    expect(screen.getByText("نظير")).toHaveAttribute("lang", "ar");
    expect(screen.getByText("Nazeer")).toHaveAttribute("lang", "en");
  });
});
