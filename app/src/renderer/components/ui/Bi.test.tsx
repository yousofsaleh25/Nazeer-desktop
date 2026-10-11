import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "@/design/language";
import { Bi } from "./Bi";

const label = { ar: "مسافة ثلاثية الأبعاد", en: "3D distance" };

describe("Bi", () => {
  it("mode ar: only the Arabic half, as an RTL isolate", () => {
    render(<Bi {...label} mode="ar" />);
    const ar = screen.getByText(label.ar);
    expect(ar).toHaveAttribute("lang", "ar");
    expect(ar).toHaveAttribute("dir", "rtl");
    expect(screen.queryByText(label.en)).toBeNull();
  });

  it("mode en: only the English half, as an LTR isolate", () => {
    render(<Bi {...label} mode="en" />);
    const en = screen.getByText(label.en);
    expect(en).toHaveAttribute("lang", "en");
    expect(en).toHaveAttribute("dir", "ltr");
    expect(screen.queryByText(label.ar)).toBeNull();
  });

  it("mode both: each half in its own isolate, Arabic first, a hidden separator between", () => {
    const { container } = render(<Bi {...label} mode="both" />);
    const halves = container.querySelectorAll("[lang]");
    expect([...halves].map((el) => [el.getAttribute("lang"), el.getAttribute("dir")])).toEqual([
      ["ar", "rtl"],
      ["en", "ltr"],
    ]);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent("·");
  });

  it("block: stacked halves without a separator", () => {
    const { container } = render(<Bi {...label} mode="both" block />);
    expect(container.firstElementChild).toHaveClass("flex-col");
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("follows the UI language and the 'show both languages' setting", () => {
    const { rerender } = render(
      <LanguageProvider lang="en" bilingual={false}>
        <Bi {...label} />
      </LanguageProvider>,
    );
    expect(screen.getByText(label.en)).toBeInTheDocument();
    expect(screen.queryByText(label.ar)).toBeNull();
    rerender(
      <LanguageProvider lang="en" bilingual>
        <Bi {...label} />
      </LanguageProvider>,
    );
    expect(screen.getByText(label.ar)).toBeInTheDocument();
    expect(screen.getByText(label.en)).toBeInTheDocument();
  });

  it("isolates Latin fragments inside the Arabic half without changing its text", () => {
    const { container } = render(<Bi ar="نقطة بعيدة عن مستوى Z_ref (> 10 %)" en="x" mode="ar" />);
    expect(container.textContent).toBe("نقطة بعيدة عن مستوى Z_ref (> 10 %)");
    expect(container.querySelector("bdi")).toHaveTextContent("Z_ref (> 10 %)");
  });

  it("defaults to Arabic without a provider (RTL first)", () => {
    render(<Bi {...label} />);
    expect(screen.getByText(label.ar)).toBeInTheDocument();
  });
});
