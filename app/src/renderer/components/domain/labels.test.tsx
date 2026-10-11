import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithStore, uiState } from "@/test/render";
import { CodeLabel, useCodeString } from "./labels";

function CodeString({ code }: { code: string }) {
  const label = useCodeString();
  return <span data-testid="s">{label("sources", code)}</span>;
}

describe("CodeLabel", () => {
  it("renders the engine's label in the UI language", () => {
    renderWithStore(<CodeLabel group="sources" code="knn_snapped_to_mask" />);
    expect(screen.getByText("مُقرَّب إلى الجمل")).toHaveAttribute("lang", "ar");
    renderWithStore(<CodeLabel group="sources" code="knn_snapped_to_mask" />, {
      preloadedState: uiState("en"),
    });
    expect(screen.getByText("snapped to camel")).toHaveAttribute("lang", "en");
  });

  it("falls back to the raw code, left to right, when the engine sent no label", () => {
    renderWithStore(<CodeLabel group="flags" code="brand_new_flag" />);
    const raw = screen.getByText("brand_new_flag");
    expect(raw.tagName).toBe("BDI");
    expect(raw).toHaveAttribute("dir", "ltr");
  });

  it("falls back to the raw code before the labels arrive", () => {
    renderWithStore(<CodeLabel group="buckets" code="SIDE" />, { labels: null });
    expect(screen.getByText("SIDE")).toBeInTheDocument();
  });
});

describe("useCodeString", () => {
  it("gives a plain string for attributes, or the code", () => {
    renderWithStore(<CodeString code="window_median" />, { preloadedState: uiState("en") });
    expect(screen.getByTestId("s")).toHaveTextContent("direct");
    renderWithStore(<CodeString code="nope" />);
    expect(screen.getAllByTestId("s")[1]).toHaveTextContent("nope");
  });
});
