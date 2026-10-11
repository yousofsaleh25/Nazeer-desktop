import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("is decorative without a label", () => {
    const { container } = render(<Spinner />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("is announced with a label and stops under reduced motion", () => {
    render(<Spinner label="Loading" />);
    const status = screen.getByRole("status", { name: "Loading" });
    expect(status.querySelector("svg")).toHaveClass("animate-spin", "motion-reduce:animate-none");
  });
});
