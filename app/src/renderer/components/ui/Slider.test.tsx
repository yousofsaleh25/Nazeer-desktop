import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithStore } from "@/test/render";
import { Slider } from "./Slider";

describe("Slider", () => {
  it("is a labelled slider moved with the keyboard", async () => {
    const onValueChange = vi.fn();
    renderWithStore(
      <Slider
        value={50}
        min={0}
        max={100}
        step={10}
        label="opacity"
        valueText="50 %"
        onValueChange={onValueChange}
      />,
    );
    const slider = screen.getByRole("slider", { name: "opacity" });
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("50 %")).toBeInTheDocument();
    slider.focus();
    await userEvent.keyboard("{Home}");
    expect(onValueChange).toHaveBeenLastCalledWith(0);
    await userEvent.keyboard("{End}");
    expect(onValueChange).toHaveBeenLastCalledWith(100);
  });
});
