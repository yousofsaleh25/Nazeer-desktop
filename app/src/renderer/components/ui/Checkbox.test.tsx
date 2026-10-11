import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithStore } from "@/test/render";
import { Checkbox } from "./Checkbox";

const label = { ar: "إظهار القناع", en: "Show the mask" };

describe("Checkbox", () => {
  it("toggles from its label and reports a boolean", async () => {
    const onCheckedChange = vi.fn();
    renderWithStore(<Checkbox checked={false} onCheckedChange={onCheckedChange} label={label} />);
    const box = screen.getByRole("checkbox", { name: label.ar });
    expect(box).toHaveAttribute("aria-checked", "false");
    await userEvent.click(screen.getByText(label.ar));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("indeterminate is announced as mixed", () => {
    renderWithStore(<Checkbox checked="indeterminate" onCheckedChange={() => {}} label={label} />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed");
  });
});
