import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithStore } from "@/test/render";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("appears on keyboard focus and describes its trigger", async () => {
    renderWithStore(
      <Tooltip content="Undo (Ctrl+Z)">
        <button type="button">Undo</button>
      </Tooltip>,
    );
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Undo (Ctrl+Z)");
    expect(screen.getByRole("button", { name: "Undo" })).toHaveAccessibleDescription(
      "Undo (Ctrl+Z)",
    );
  });
});
