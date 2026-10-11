import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScrollArea } from "./ScrollArea";

describe("ScrollArea", () => {
  it("a labelled region is focusable for keyboard scrolling", () => {
    render(
      <ScrollArea label="measurements" viewportClassName="max-h-40">
        <p>row</p>
      </ScrollArea>,
    );
    const viewport = screen.getByLabelText("measurements");
    expect(viewport).toHaveAttribute("tabindex", "0");
    expect(viewport).toHaveClass("max-h-40");
    expect(screen.getByText("row")).toBeInTheDocument();
  });

  it("without a label it is not a tab stop", () => {
    const { container } = render(<ScrollArea>content</ScrollArea>);
    expect(container.querySelector("[tabindex='0']")).toBeNull();
  });
});
