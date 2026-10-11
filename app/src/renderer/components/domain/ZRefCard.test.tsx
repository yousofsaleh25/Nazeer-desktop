import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtures } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { ZRefCard } from "./ZRefCard";

const view = fixtures.sessionView;

describe("ZRefCard", () => {
  it("shows the frozen Z_ref block as the engine computed it", () => {
    renderWithStore(<ZRefCard frame={view.frame} summary={view.summary} />, {
      preloadedState: uiState("en"),
    });
    expect(screen.getByText("2.329")).toBeInTheDocument();
    expect(screen.getByText(/median of the camel's valid depth/)).toBeInTheDocument();
    expect(screen.getByText("182,862")).toBeInTheDocument();
    expect(screen.getByText("189,733")).toBeInTheDocument();
    expect(screen.getByText("96.4")).toBeInTheDocument(); // valid fraction %
    // rel_disp is the mean absolute deviation over the median: they share a row
    expect(screen.getByText("Mean absolute deviation").closest("div")).toHaveTextContent(
      "0.104 m (4.5 %)",
    );
    expect(screen.getByText("Robust MAD").closest("div")).toHaveTextContent("0.069 m");
    expect(screen.getByText("1 of 13 points snapped to the camel (KNN)")).toBeInTheDocument();
  });

  it("a missing statistic shows --, never a made-up number", () => {
    renderWithStore(<ZRefCard frame={{ ...view.frame, z_ref: {} }} />, {
      preloadedState: uiState("en"),
    });
    expect(screen.getAllByText("--").length).toBeGreaterThan(3);
  });
});
