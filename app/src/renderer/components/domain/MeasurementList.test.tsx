import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtures, sessionRows } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { itemsOfRows, MeasurementList } from "./MeasurementList";

describe("MeasurementList", () => {
  it("lists the rows in operator order with the engine's summary", () => {
    renderWithStore(
      <MeasurementList
        items={itemsOfRows(sessionRows)}
        summary={fixtures.sessionView.summary}
        selectedId={9}
      />,
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

  it("an item the engine has not computed yet: its name and kind, no value", () => {
    const input = { ...sessionRows[0]!.input, id: 42, name: "rump width" };
    renderWithStore(<MeasurementList items={[{ input, row: null, status: "pending" }]} />, {
      preloadedState: uiState("en"),
    });
    const item = document.querySelector<HTMLElement>('li[data-row="42"]')!;
    expect(item).toHaveAttribute("data-status", "pending");
    expect(item).toHaveTextContent("rump width");
    expect(item).toHaveTextContent("Not saved yet");
    expect(item).toHaveTextContent("The engine computes the value when it is saved");
    expect(item).not.toHaveTextContent(" m");
  });

  it("the draft's name, note and colour are shown over a row of the same geometry", () => {
    const row = sessionRows[0]!;
    const input = { ...row.input, name: "renamed", note: "left side", color: "#2C57BE" };
    renderWithStore(<MeasurementList items={[{ input, row, status: "pending" }]} />, {
      preloadedState: uiState("en"),
    });
    const item = document.querySelector<HTMLElement>(`li[data-row="${row.id}"]`)!;
    expect(item).toHaveTextContent("renamed");
    expect(item).toHaveTextContent("left side");
    expect(item).toHaveTextContent("1.319 m");
    expect(item.style.borderInlineStartColor).toBe("rgb(44, 87, 190)");
  });

  it("empty: says how to start (not in read-only)", () => {
    const { rerender } = renderWithStore(<MeasurementList items={[]} />, {
      preloadedState: uiState("en"),
    });
    expect(screen.getByText("No measurements yet")).toBeInTheDocument();
    expect(screen.getByText(/Choose a kind, click on the frame/)).toBeInTheDocument();
    rerender(<MeasurementList items={[]} readOnly />);
    expect(screen.queryByText(/Choose a kind, click on the frame/)).toBeNull();
  });
});
