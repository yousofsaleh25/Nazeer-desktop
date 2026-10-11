import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fixtures, sessionRows } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { MeasurementItem } from "./MeasurementItem";

function inList(node: ReactNode) {
  return <ul>{node}</ul>;
}

describe("MeasurementItem", () => {
  it("renders the engine's presentation verbatim: value, uncertainty, kind, flags, basis", () => {
    renderWithStore(inList(<MeasurementItem row={sessionRows[0]!} />), {
      preloadedState: uiState("en"),
    });
    const item = document.querySelector<HTMLElement>("li[data-row]")!;
    expect(item).toHaveTextContent("مسافة ثنائية الأبعاد 1");
    expect(item).toHaveTextContent("1.319 m");
    expect(item).toHaveTextContent("± 5.9 cm");
    expect(item).toHaveTextContent("2D distance (Z_ref plane)");
    expect(item).toHaveTextContent("point off the Z_ref plane (> 10 %)");
    expect(item).toHaveTextContent("low"); // confidence
    expect(item).toHaveTextContent("P1–P2");
    expect(within(item).getByText("مسافة ثنائية الأبعاد 1")).toHaveAttribute("dir", "auto");
    expect(item.style.borderInlineStartColor).not.toBe("");
  });

  it("a rejected row shows no number, only the reasons", () => {
    renderWithStore(inList(<MeasurementItem row={fixtures.preview.rejected.row} />), {
      preloadedState: uiState("en"),
    });
    const item = document.querySelector<HTMLElement>("li[data-row]")!;
    expect(item).toHaveTextContent("Rejected: no value");
    expect(item).toHaveTextContent("point outside the image");
    expect(item).not.toHaveTextContent("--");
  });

  it("status: pending and preview rows are marked", () => {
    renderWithStore(
      inList(
        <>
          <MeasurementItem row={sessionRows[1]!} status="pending" />
          <MeasurementItem row={sessionRows[2]!} status="preview" />
        </>,
      ),
      { preloadedState: uiState("en") },
    );
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("selecting and the actions menu (rename, move, delete)", async () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const onMove = vi.fn();
    renderWithStore(
      inList(
        <MeasurementItem
          row={sessionRows[3]!}
          onSelect={onSelect}
          onDelete={onDelete}
          onMove={onMove}
          first
        />,
      ),
      { preloadedState: uiState("en") },
    );
    await userEvent.click(screen.getByRole("button", { name: /Random 3D distance 1/ }));
    expect(onSelect).toHaveBeenCalledWith(4);
    await userEvent.click(screen.getByRole("button", { name: "Measurement actions" }));
    expect(await screen.findByRole("menuitem", { name: "Move up" })).toHaveAttribute(
      "data-disabled",
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(4);
  });

  it("read-only rows have no actions", () => {
    renderWithStore(
      inList(<MeasurementItem row={sessionRows[3]!} readOnly onDelete={() => {}} />),
      {
        preloadedState: uiState("en"),
      },
    );
    expect(screen.queryByRole("button", { name: "Measurement actions" })).toBeNull();
  });
});
