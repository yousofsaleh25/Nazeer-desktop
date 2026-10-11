import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtures, sessionRows } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { DepthBasisCell, groupBasis, groupTag } from "./DepthBasisCell";

describe("DepthBasisCell", () => {
  it("groups consecutive points with the same basis (a 2D curve reads as one line)", () => {
    const curve = sessionRows[7]!.presentation.depth_basis; // 5 × "Z_ref 2.329 m"
    const groups = groupBasis(curve);
    expect(groups).toHaveLength(1);
    expect(groupTag(groups[0]!)).toBe("P1–P5");
    renderWithStore(<DepthBasisCell basis={curve} />, { preloadedState: uiState("en") });
    expect(screen.getByText("P1–P5")).toBeInTheDocument();
    expect(screen.getByText("Z_ref 2.329 m")).toBeInTheDocument();
  });

  it("keeps different bases apart, in point order", () => {
    const basis = sessionRows[5]!.presentation.depth_basis; // direct, then snapped to camel
    renderWithStore(<DepthBasisCell basis={basis} />, { preloadedState: uiState("en") });
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["P1direct 2.321 m", "P2snapped to camel 9.0 cm"]);
  });

  it("a row-level basis (4-point angle) has no point tag; an empty basis renders nothing", () => {
    const basis = fixtures.preview.angle4Mixed.row.presentation.depth_basis;
    const { container } = renderWithStore(
      <>
        <DepthBasisCell basis={basis} />
        <DepthBasisCell basis={[]} />
      </>,
      { preloadedState: uiState("en") },
    );
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent(/^from the two lines$/);
  });
});
