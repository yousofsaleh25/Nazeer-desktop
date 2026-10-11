import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatNumber } from "@/lib/format";
import { Ltr, NBSP, Num, PathText } from "./Ltr";

describe("Num", () => {
  it("isolates the number left-to-right and lets the unit follow in the text's direction", () => {
    render(
      <p dir="rtl">
        ارتفاع <Num value={1.84236} digits={3} unit="م" />
      </p>,
    );
    const num = screen.getByText("1.842");
    expect(num.tagName).toBe("BDI");
    expect(num).toHaveAttribute("dir", "ltr");
    expect(num).toHaveClass("tabular-nums");
    // the Arabic unit stays outside the isolate (reads "1.842 م" right to left), joined by a NBSP
    expect(num.parentElement?.textContent).toBe(`1.842${NBSP}م`);
    expect(num.parentElement).toHaveClass("whitespace-nowrap");
  });

  it("shows the engine placeholder for a missing value, without a unit", () => {
    render(<Num value={null} unit="m" />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });
});

describe("formatNumber", () => {
  it("uses ASCII digits, fixed decimals and optional grouping", () => {
    expect(formatNumber(269033)).toBe("269033");
    expect(formatNumber(269033, { grouping: true })).toBe("269,033");
    expect(formatNumber(0.1, { digits: 3 })).toBe("0.100");
    expect(formatNumber(Number.NaN)).toBe("--");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("--");
    expect(formatNumber(undefined)).toBe("--");
  });
});

describe("Ltr", () => {
  it("isolates ids and paths left-to-right", () => {
    render(<Ltr>20261011_152956_e20a7c</Ltr>);
    expect(screen.getByText("20261011_152956_e20a7c")).toHaveAttribute("dir", "ltr");
  });
});

describe("PathText", () => {
  it("isolates every folder, so an Arabic folder cannot reorder the rest of the path", () => {
    const path = "D:\\captures\\اختبار\\20260414_181203-007.bag";
    const { container } = render(<PathText path={path} />);
    const outer = container.firstElementChild!;
    expect(outer).toHaveAttribute("dir", "ltr");
    expect(outer).toHaveAttribute("title", path);
    expect(outer.textContent).toBe(path); // characters unchanged
    const segments = [...outer.querySelectorAll("bdi")].map((b) => [
      b.textContent,
      b.getAttribute("dir"),
    ]);
    expect(segments).toEqual([
      ["D:", "auto"],
      ["captures", "auto"],
      ["اختبار", "auto"],
      ["20260414_181203-007.bag", "auto"],
    ]);
  });

  it("keeps forward slashes and a leading separator", () => {
    const { container } = render(<PathText path="/sessions/x/report_v1.pdf" />);
    expect(container.textContent).toBe("/sessions/x/report_v1.pdf");
  });
});
