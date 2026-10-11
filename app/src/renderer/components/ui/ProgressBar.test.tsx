import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("announces the fraction as a percentage and fills from the inline start", () => {
    render(<ProgressBar value={0.374} label="Walk" />);
    const bar = screen.getByRole("progressbar", { name: "Walk" });
    expect(bar).toHaveAttribute("aria-valuenow", "37");
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill).toHaveClass("start-0");
    expect(fill.style.width).toBe("37.4%");
  });

  it("clamps out-of-range values", () => {
    render(<ProgressBar value={1.7} label="x" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("is indeterminate (no value announced) when the total is unknown", () => {
    render(<ProgressBar value={null} label="Opening" />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });
});
