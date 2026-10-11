import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithStore } from "@/test/render";
import { ToggleGroup, ToggleGroupItem, Toolbar, ToolbarSeparator } from "./Toolbar";

describe("Toolbar and ToggleGroup", () => {
  it("one tab stop for the group; arrows move; activating reports the value", async () => {
    const onValueChange = vi.fn();
    renderWithStore(
      <Toolbar label="tools">
        <ToggleGroup<"a" | "b"> value="a" onValueChange={onValueChange} label="kind">
          <ToggleGroupItem value="a" label="2D">
            A
          </ToggleGroupItem>
          <ToggleGroupItem value="b" label="3D">
            B
          </ToggleGroupItem>
        </ToggleGroup>
        <ToolbarSeparator />
      </Toolbar>,
    );
    expect(screen.getByRole("toolbar", { name: "tools" })).toBeInTheDocument();
    const a = screen.getByRole("radio", { name: "2D" });
    expect(a).toHaveAttribute("aria-checked", "true");
    await userEvent.tab();
    expect(a).toHaveFocus();
    // Arabic is the default direction: the next item is to the left
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "3D" })).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("deselecting the active item reports null", async () => {
    const onValueChange = vi.fn();
    renderWithStore(
      <ToggleGroup<"a"> value="a" onValueChange={onValueChange} label="kind">
        <ToggleGroupItem value="a" label="2D">
          A
        </ToggleGroupItem>
      </ToggleGroup>,
    );
    await userEvent.click(screen.getByRole("radio", { name: "2D" }));
    expect(onValueChange).toHaveBeenCalledWith(null);
  });
});
