import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtures } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { GroundLineBadge } from "./GroundLineBadge";

const ground = fixtures.sessionView.frame.ground;

describe("GroundLineBadge", () => {
  it("the drawn row, no badge when near and raw rows agree", () => {
    renderWithStore(<GroundLineBadge ground={ground} />, { preloadedState: uiState("en") });
    expect(screen.getByText("691")).toBeInTheDocument();
    expect(document.querySelector("[data-tone]")).toBeNull();
  });

  it("the far-leg badge with the raw row", () => {
    renderWithStore(
      <GroundLineBadge ground={{ ...ground, badge: "far_side_row_differs", raw_row: 715 }} />,
      {
        preloadedState: uiState("en"),
      },
    );
    expect(
      screen.getByText("ground line from the near legs").closest("[data-tone]"),
    ).toHaveAttribute("data-tone", "warning");
    expect(screen.getByText("715")).toBeInTheDocument();
  });

  it("an unresolved ground row is a danger chip", () => {
    renderWithStore(<GroundLineBadge ground={{ ...ground, drawn_row: null }} />, {
      preloadedState: uiState("en"),
    });
    expect(screen.getByText("ground line unresolved").closest("[data-tone]")).toHaveAttribute(
      "data-tone",
      "danger",
    );
  });
});
