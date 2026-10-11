import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithStore } from "@/test/render";
import { Card, Skeleton } from "./Card";

describe("Card", () => {
  it("a titled section with header actions", () => {
    renderWithStore(
      <Card
        title={{ ar: "التسجيل", en: "Recording" }}
        level={2}
        actions={<button type="button">Act</button>}
      >
        content
      </Card>,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("التسجيل");
    expect(screen.getByRole("button", { name: "Act" })).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("without a title it renders no header", () => {
    const { container } = renderWithStore(<Card>plain</Card>);
    expect(container.querySelector("header")).toBeNull();
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive technology and stops pulsing under reduced motion", () => {
    const { container } = renderWithStore(<Skeleton className="h-4" />);
    const block = container.firstElementChild!;
    expect(block).toHaveAttribute("aria-hidden", "true");
    expect(block).toHaveClass("motion-reduce:animate-none");
  });
});
