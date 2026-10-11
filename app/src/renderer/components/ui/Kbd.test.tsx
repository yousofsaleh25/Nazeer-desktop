import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Kbd } from "./Kbd";

describe("Kbd", () => {
  it("a key is always left to right", () => {
    render(<Kbd>Ctrl+Z</Kbd>);
    const key = screen.getByText("Ctrl+Z");
    expect(key.tagName).toBe("KBD");
    expect(key).toHaveAttribute("dir", "ltr");
  });
});
