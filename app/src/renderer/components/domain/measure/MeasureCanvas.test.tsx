import { screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { allKindRows, fixtures, sessionRows } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { depthBoxOf, groundLineOf } from "./geometry";
import { MeasureCanvas, type CanvasFrame } from "./MeasureCanvas";

const view = fixtures.sessionView;
const frame: CanvasFrame = {
  width: view.frame.width,
  height: view.frame.height,
  imageUrl: "frame.png",
  maskUrl: "mask.png",
  ground: groundLineOf(view.frame),
  depthBox: depthBoxOf(view.frame),
};

function render(props: Partial<Parameters<typeof MeasureCanvas>[0]> = {}) {
  return renderWithStore(
    <MeasureCanvas frame={frame} rows={sessionRows} label="Editing view" {...props} />,
    {
      preloadedState: uiState("en"),
    },
  );
}

describe("MeasureCanvas", () => {
  it("one SVG in image coordinates, always left to right, with the frame as its image", () => {
    const { container } = render();
    const svg = screen.getByRole("img", { name: "Editing view" });
    expect(svg).toHaveAttribute("viewBox", "0 0 1280 720");
    expect(container.firstElementChild).toHaveAttribute("dir", "ltr");
    expect(container.firstElementChild).toHaveStyle({ aspectRatio: "1280 / 720" });
    expect(svg.querySelector("image")).toHaveAttribute("href", "frame.png");
  });

  it("draws every row once, in operator order", () => {
    const { container } = render();
    const rows = [...container.querySelectorAll("[data-row]")].filter((el) => el.tagName === "g");
    expect(rows.map((g) => g.getAttribute("data-row"))).toEqual(
      sessionRows.map((r) => String(r.id)),
    );
  });

  it("shows provenance like the overlay: KNN ring with a leader, ground square, flagged segment", () => {
    const { container } = render();
    const knn = container.querySelector('[data-row="6"] [data-marker="knn"]');
    expect(knn?.querySelector("line")).toHaveAttribute("x2", "448");
    expect(container.querySelector('[data-row="7"] rect[data-target="ground"]')).not.toBeNull();
    expect(
      container.querySelector('[data-row="9"] [data-flagged-segment="0"] path'),
    ).toHaveAttribute("stroke", "#ff3333");
    // 2D rows: plain markers only
    expect(container.querySelectorAll('[data-row="1"] [data-marker]')).toHaveLength(2);
    expect(container.querySelector('[data-row="1"] [data-marker="knn"]')).toBeNull();
  });

  it("a rejected row is grey and dashed, with a cross on its rejected point", () => {
    const { container } = render({ rows: allKindRows() });
    const rejected = container.querySelector('g[data-row="15"]')!;
    expect(rejected).toHaveAttribute("data-rejected", "true");
    expect(rejected.querySelector("path")).toHaveAttribute("stroke-dasharray", "7 5");
    expect(rejected.querySelector('[data-marker="rejected"]')).not.toBeNull();
  });

  it("angles get their arc; a 4-point angle only its label", () => {
    const { container } = render({ rows: allKindRows() });
    expect(container.querySelectorAll('g[data-row="10"] path').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('g[data-row="13"]')).toHaveAttribute("data-shape", "between");
    expect(container.querySelector('[data-label="13"]')).not.toBeNull();
  });

  it("the ground line spans the camel ±40 px; layers come and go", () => {
    const { container, rerender } = render();
    expect(container.querySelector('[data-layer="ground"] path')).toHaveAttribute(
      "d",
      "M 231 691 L 1279 691",
    );
    expect(container.querySelector('[data-layer="mask"]')).toBeNull();
    rerender(
      <MeasureCanvas
        frame={frame}
        rows={sessionRows}
        label="Editing view"
        layers={{ mask: true, depthBox: true, labels: false }}
      />,
    );
    expect(container.querySelector('[data-layer="mask"] mask image')).toHaveAttribute(
      "href",
      "mask.png",
    );
    expect(container.querySelector('[data-layer="depth-box"] rect')).toHaveAttribute("x", "29");
    expect(container.querySelector("[data-label]")).toBeNull();
  });

  it("labels show the operator's name (dir=auto) and the engine's value text", () => {
    const { container } = render();
    const label = container.querySelector('[data-label="6"]') as HTMLElement;
    expect(label).toHaveTextContent("Random 3D distance 3");
    expect(label).toHaveTextContent("1.287 m");
    expect(label.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(label.style.left).toMatch(/%$/);
  });

  it("hidden rows are not drawn; the selected row gets a halo", () => {
    const { container } = render({ hiddenIds: new Set([1, 2]), selectedId: 3 });
    expect(container.querySelector('g[data-row="1"]')).toBeNull();
    expect(container.querySelectorAll('g[data-row="3"] > path').length).toBe(2); // halo + stroke
  });

  it("zoom and pan are the viewBox; labels outside the view are dropped", () => {
    const { container } = render({ viewport: { x: 640, y: 360, width: 320, height: 180 } });
    expect(screen.getByRole("img")).toHaveAttribute("viewBox", "640 360 320 180");
    expect(container.querySelector('[data-label="1"]')).toBeNull(); // label near x=660,y=290
  });

  it("draws the clicks in progress and the crosshair", () => {
    const { container } = render({
      draft: {
        kind: "curve_3d",
        points: [
          [100, 100],
          [200, 120],
        ],
        targets: ["camel", "ground"],
      },
      crosshair: { at: [300, 140], target: "ground" },
    });
    expect(container.querySelectorAll('[data-draft="curve_3d"] [data-marker]')).toHaveLength(2);
    expect(container.querySelector('[data-draft] rect[data-target="ground"]')).not.toBeNull();
    expect(container.querySelector('[data-crosshair="ground"] rect')).not.toBeNull();
  });

  it("hands its SVG element to the caller (pointer mapping in Stage 6)", () => {
    const ref = createRef<SVGSVGElement>();
    render({ svgRef: ref });
    expect(ref.current?.tagName).toBe("svg");
  });
});
