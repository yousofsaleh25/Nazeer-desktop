import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithStore, uiState } from "@/test/render";
import { SplitPane } from "./SplitPane";

function setup(lang: "ar" | "en") {
  const onSizeChange = vi.fn();
  renderWithStore(
    <SplitPane
      start={<p>list</p>}
      end={<p>canvas</p>}
      defaultSize={360}
      minSize={240}
      maxSize={640}
      label="Resize"
      onSizeChange={onSizeChange}
    />,
    { preloadedState: uiState(lang) },
  );
  const separator = screen.getByRole("separator", { name: "Resize" });
  separator.focus();
  return { separator, onSizeChange };
}

describe("SplitPane", () => {
  it("the separator is a focusable, valued control", () => {
    const { separator } = setup("en");
    expect(separator).toHaveAttribute("aria-valuenow", "360");
    expect(separator).toHaveAttribute("aria-valuemin", "240");
    expect(separator).toHaveAttribute("aria-valuemax", "640");
    expect(screen.getByText("list").parentElement).toHaveStyle({ inlineSize: "360px" });
  });

  it("left to right: ArrowRight grows the start pane, Shift for bigger steps, Home/End clamp", async () => {
    const { separator, onSizeChange } = setup("en");
    await userEvent.keyboard("{ArrowRight}");
    expect(separator).toHaveAttribute("aria-valuenow", "376");
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(separator).toHaveAttribute("aria-valuenow", "312");
    await userEvent.keyboard("{End}");
    expect(onSizeChange).toHaveBeenLastCalledWith(640);
    await userEvent.keyboard("{Home}");
    expect(onSizeChange).toHaveBeenLastCalledWith(240);
  });

  it("right to left: the start pane is on the right, so ArrowLeft grows it", async () => {
    const { separator } = setup("ar");
    await userEvent.keyboard("{ArrowLeft}");
    expect(separator).toHaveAttribute("aria-valuenow", "376");
  });
});
