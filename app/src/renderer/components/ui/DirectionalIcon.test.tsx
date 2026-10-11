import { render } from "@testing-library/react";
import { ChevronRight } from "lucide-react";
import { describe, expect, it } from "vitest";
import { DirectionalIcon } from "./DirectionalIcon";

describe("DirectionalIcon", () => {
  it("mirrors in RTL and is hidden from assistive technology", () => {
    const { container } = render(<DirectionalIcon icon={ChevronRight} className="size-6" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveClass("rtl:-scale-x-100", "size-6");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
