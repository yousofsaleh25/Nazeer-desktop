import { render, screen } from "@testing-library/react";
import { TriangleAlert } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Badge, Chip } from "./Chip";

describe("Chip and Badge", () => {
  it("take the tone's text, tint and border classes", () => {
    render(
      <>
        <Chip tone="warning" icon={TriangleAlert}>
          flag
        </Chip>
        <Badge tone="side">SIDE</Badge>
      </>,
    );
    const chip = screen.getByText("flag").parentElement!;
    expect(chip).toHaveAttribute("data-tone", "warning");
    expect(chip).toHaveClass(
      "rounded-full",
      "text-warning-text",
      "bg-warning-soft",
      "border-warning-border",
    );
    expect(chip.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const badge = screen.getByText("SIDE");
    expect(badge).toHaveClass("rounded-sm", "text-bucket-side-text");
  });

  it("neutral by default", () => {
    render(<Chip>x</Chip>);
    expect(screen.getByText("x").parentElement).toHaveAttribute("data-tone", "neutral");
  });
});
