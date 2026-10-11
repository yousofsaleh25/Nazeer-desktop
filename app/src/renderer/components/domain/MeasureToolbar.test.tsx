import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { INPUT_KINDS } from "@/api/types";
import { fixtures } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { MeasureToolbar, type MeasureToolbarProps } from "./MeasureToolbar";

function setup(overrides: Partial<MeasureToolbarProps> = {}, lang: "ar" | "en" = "en") {
  const props: MeasureToolbarProps = {
    tool: "distance_3d",
    onToolChange: vi.fn(),
    canUndo: true,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    zoom: 1,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    layers: { mask: false, depthBox: true, labels: true },
    onLayersChange: vi.fn(),
    ...overrides,
  };
  renderWithStore(<MeasureToolbar {...props} />, { preloadedState: uiState(lang) });
  return props;
}

describe("MeasureToolbar", () => {
  it("offers the eight kinds by their engine labels; the active one is checked", () => {
    setup();
    const tools = screen.getAllByRole("radio");
    expect(tools.map((t) => t.getAttribute("aria-label"))).toEqual(
      INPUT_KINDS.map((kind) => fixtures.labels.input_kinds[kind]!.en),
    );
    expect(screen.getByRole("radio", { name: "3D distance" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // the active kind is spelled out in full next to the toolbar
    expect(screen.getAllByText("3D distance").length).toBeGreaterThan(0);
  });

  it("choosing a kind, undo/redo, zoom and layers call back", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("radio", { name: "2D polyline length (Z_ref plane)" }));
    expect(props.onToolChange).toHaveBeenCalledWith("curve_2d");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(props.onUndo).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await userEvent.click(screen.getByRole("button", { name: "Fit the frame" }));
    expect(props.onZoomIn).toHaveBeenCalledOnce();
    expect(props.onZoomReset).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("switch", { name: "Camel mask" }));
    expect(props.onLayersChange).toHaveBeenCalledWith({ mask: true, depthBox: true, labels: true });
  });

  it("a read-only session disables the tools and undo, not the view controls", () => {
    setup({ readOnly: true });
    for (const tool of screen.getAllByRole("radio")) expect(tool).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  });

  it("no tool chosen: says how to choose one", () => {
    setup({ tool: null });
    expect(screen.getByText("Choose a measurement kind (keys 1–8)")).toBeInTheDocument();
  });
});
