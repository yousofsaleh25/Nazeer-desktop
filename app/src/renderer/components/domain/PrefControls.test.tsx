import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithStore } from "@/test/render";
import { PrefControls } from "./PrefControls";

describe("PrefControls", () => {
  it("drive the ui slice: language, both languages, theme", async () => {
    const { store } = renderWithStore(<PrefControls />);
    expect(screen.getByRole("button", { name: "العربية" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(store.getState().ui.lang).toBe("en");
    await userEvent.click(screen.getByRole("switch", { name: "Show both languages" }));
    expect(store.getState().ui.bilingual).toBe(true);
    screen.getByRole("combobox", { name: "Theme" }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("option", { name: /Dark/ }));
    expect(store.getState().ui.theme).toBe("dark");
  });
});
