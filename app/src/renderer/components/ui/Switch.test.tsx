import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithStore } from "@/test/render";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("is a labelled switch that toggles with Space", async () => {
    const onCheckedChange = vi.fn();
    renderWithStore(
      <Switch checked onCheckedChange={onCheckedChange} label={{ ar: "التسميات", en: "Labels" }} />,
    );
    const toggle = screen.getByRole("switch", { name: "التسميات" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    toggle.focus();
    await userEvent.keyboard(" ");
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("the thumb slides toward the inline end in both directions", () => {
    renderWithStore(<Switch checked onCheckedChange={() => {}} label={{ ar: "س", en: "x" }} />);
    const thumb = screen.getByRole("switch").firstElementChild;
    expect(thumb).toHaveClass(
      "data-[state=checked]:translate-x-4",
      "rtl:data-[state=checked]:-translate-x-4",
    );
  });
});
