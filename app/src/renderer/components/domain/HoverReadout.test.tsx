import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DepthOut } from "@/api/types";
import { fixtures } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { HoverReadout } from "./HoverReadout";

const { inside, outsideKnn, ground } = fixtures.depth;

describe("HoverReadout", () => {
  it("inside the camel: the engine's basis text and a direct source", () => {
    renderWithStore(<HoverReadout depth={inside} />, { preloadedState: uiState("en") });
    expect(screen.getByText("direct 2.153 m")).toBeInTheDocument();
    expect(screen.getByText("direct")).toBeInTheDocument(); // sources.window_median
    expect(screen.getByText("25 / 25")).toBeInTheDocument();
  });

  it("outside the camel: snapped to the camel by KNN, with the neighbour distances", () => {
    renderWithStore(<HoverReadout depth={outsideKnn} />, { preloadedState: uiState("en") });
    expect(screen.getByText("snapped to camel 9.0 cm")).toBeInTheDocument();
    expect(screen.getByText("snapped to camel")).toBeInTheDocument();
    expect(screen.getByText("k = 9")).toBeInTheDocument();
    expect(screen.getByText("0.090")).toBeInTheDocument();
  });

  it("a Shift-click ground target keeps its direct depth", () => {
    renderWithStore(<HoverReadout depth={ground} />, { preloadedState: uiState("ar") });
    // the Latin run (2.167) sits in its own isolate inside the Arabic text
    expect(document.body).toHaveTextContent("أرض (مباشر) 2.167 م");
    expect(screen.getByText("أرض / خلفية")).toBeInTheDocument(); // targets.ground
  });

  it("a rejected pixel shows the reason, never a depth", () => {
    const rejected: DepthOut = {
      ...outsideKnn,
      ok: false,
      source: null,
      depth_m: null,
      reason: "knn_too_far",
      flags: ["knn_far"],
      basis: { ar: "مرفوض", en: "rejected" },
    };
    renderWithStore(<HoverReadout depth={rejected} />, { preloadedState: uiState("en") });
    expect(screen.getByText("nearest camel pixels too far (> 30 cm)")).toBeInTheDocument();
    expect(screen.queryByText("rejected")).toBeNull();
    expect(screen.getByText("neighbours far (> 10 cm)").closest("[data-tone]")).toHaveAttribute(
      "data-tone",
      "warning",
    );
  });

  it("with a 2D tool it says the depth is information only; idle before any hover", () => {
    const { rerender } = renderWithStore(<HoverReadout depth={inside} tool2d />, {
      preloadedState: uiState("en"),
    });
    expect(screen.getByText(/2D measurements use Z_ref/)).toBeInTheDocument();
    rerender(<HoverReadout depth={null} />);
    expect(screen.getByText(/Move over the frame/)).toBeInTheDocument();
  });
});
