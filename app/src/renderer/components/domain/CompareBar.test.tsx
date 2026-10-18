import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithStore, uiState } from "@/test/render";
import { CompareBar } from "./CompareBar";

function setup(count: number, max: number | null, lang: "en" | "ar" = "en") {
  const props = { onClear: vi.fn(), onCompare: vi.fn() };
  renderWithStore(<CompareBar count={count} max={max} {...props} />, {
    preloadedState: uiState(lang),
  });
  return props;
}

describe("CompareBar", () => {
  it("shows nothing while no camel is ticked", () => {
    setup(0, 20);
    expect(screen.queryByTestId("compare-bar")).toBeNull();
  });

  it("counts the ticked camels against the engine's maximum; Clear and Compare", async () => {
    const props = setup(3, 20);
    expect(screen.getByRole("status")).toHaveTextContent("Camels selected3 / 20");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(props.onClear).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Compare 3" }));
    expect(props.onCompare).toHaveBeenCalled();
  });

  it("says when the selection is full (Arabic)", () => {
    setup(20, 20, "ar");
    expect(screen.getByRole("status")).toHaveTextContent("بلغ الاختيار الحد الأقصى");
  });

  it("an unknown maximum shows the count alone", () => {
    setup(2, null);
    expect(screen.getByRole("status")).not.toHaveTextContent("/");
  });
});
