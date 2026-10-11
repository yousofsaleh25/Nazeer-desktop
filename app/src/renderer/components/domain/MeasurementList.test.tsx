import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtures, sessionRows } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { MeasurementList } from "./MeasurementList";

describe("MeasurementList", () => {
  it("lists the rows in operator order with the engine's summary", () => {
    renderWithStore(
      <MeasurementList rows={sessionRows} summary={fixtures.sessionView.summary} selectedId={9} />,
      {
        preloadedState: uiState("en"),
      },
    );
    const items = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-row"));
    expect(items.map((li) => li.getAttribute("data-row"))).toEqual(
      sessionRows.map((r) => String(r.id)),
    );
    expect(screen.getByText("1 of 13 points snapped to the camel (KNN)")).toBeInTheDocument();
    expect(screen.getByText("Low confidence").parentElement).toHaveTextContent("Low confidence: 3");
    expect(items[8]).toHaveAttribute("aria-current", "true");
  });

  it("empty: says how to start (not in read-only)", () => {
    const { rerender } = renderWithStore(<MeasurementList rows={[]} />, {
      preloadedState: uiState("en"),
    });
    expect(screen.getByText("No measurements yet")).toBeInTheDocument();
    expect(screen.getByText(/Choose a kind, click on the frame/)).toBeInTheDocument();
    rerender(<MeasurementList rows={[]} readOnly />);
    expect(screen.queryByText(/Choose a kind, click on the frame/)).toBeNull();
  });
});
