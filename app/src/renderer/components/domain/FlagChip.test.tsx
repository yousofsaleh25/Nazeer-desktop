import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtures, sessionRows } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { ConfidenceChip, FlagChip, pointTag, RejectionChip } from "./FlagChip";

describe("flag, rejection and confidence chips", () => {
  it("a warn flag is a warning chip with the engine's text (Latin run isolated in Arabic)", () => {
    const flag = sessionRows[0]!.presentation.flags[0]!;
    const { container } = renderWithStore(<FlagChip flag={flag} />);
    expect(container.querySelector("[data-tone]")).toHaveAttribute("data-tone", "warning");
    expect(container.textContent).toBe("نقطة بعيدة عن مستوى Z_ref (> 10 %)");
    expect(container.querySelector("bdi")).toHaveTextContent("Z_ref (> 10 %)");
  });

  it("an info flag is an info chip", () => {
    const { container } = renderWithStore(
      <FlagChip
        flag={{
          code: "outside_depth_fov",
          ar: "خارج تغطية العمق",
          en: "outside depth coverage",
          severity: "info",
        }}
      />,
    );
    expect(container.querySelector("[data-tone]")).toHaveAttribute("data-tone", "info");
  });

  it("a rejection names the point it concerns", () => {
    const part = fixtures.preview.rejected.row.presentation.rejection[0]!;
    renderWithStore(<RejectionChip part={part} />, { preloadedState: uiState("en") });
    expect(screen.getByText("P1")).toBeInTheDocument();
    expect(screen.getByText("point outside the image").closest("[data-tone]")).toHaveAttribute(
      "data-tone",
      "danger",
    );
  });

  it("confidence: low is a warning, high is neutral, none renders nothing", () => {
    const { container } = renderWithStore(
      <>
        <ConfidenceChip confidence={{ code: "low", ar: "منخفضة", en: "low" }} />
        <ConfidenceChip confidence={{ code: "high", ar: "عالية", en: "high" }} />
        <ConfidenceChip confidence={null} />
      </>,
    );
    const tones = [...container.querySelectorAll("[data-tone]")].map((el) =>
      el.getAttribute("data-tone"),
    );
    expect(tones).toEqual(["warning", "neutral"]);
  });

  it("pointTag", () => {
    expect(pointTag("p2")).toBe("P2");
    expect(pointTag(3)).toBe("P3");
    expect(pointTag(null)).toBeNull();
  });
});
