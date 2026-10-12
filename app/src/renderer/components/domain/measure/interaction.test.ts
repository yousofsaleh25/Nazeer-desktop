import { describe, expect, it } from "vitest";
import { INPUT_KINDS } from "@/api/types";
import { allKindRows, sessionRows } from "@/design/fixtures";
import {
  clampViewport,
  finishCurve,
  fitViewport,
  hitPoint,
  hitRow,
  imagePoint,
  keepVisible,
  MAX_ZOOM,
  panBy,
  placePoint,
  previewInput,
  removeLastPoint,
  requiredPoints,
  targetFor,
  toInput,
  zoomAt,
  zoomOf,
  type Shape,
} from "./interaction";

const frame = { width: 1280, height: 720 };

function draw(kind: Shape["kind"], points: [number, number][]) {
  let shape: Shape | null = null;
  let complete = false;
  for (const at of points) {
    ({ shape, complete } = placePoint(shape, kind, at, "camel"));
  }
  return { shape: shape!, complete };
}

describe("point counts and targets", () => {
  it("each kind takes its own number of clicks; curves are open-ended; 4-point angles none", () => {
    expect(INPUT_KINDS.map(requiredPoints)).toEqual([2, 2, null, null, 3, 3, 2, 0]);
  });

  it("Shift marks a ground point only for the 3D kinds (2D kinds never read per-point depth)", () => {
    expect(targetFor("distance_3d", true)).toBe("ground");
    expect(targetFor("curve_3d", true)).toBe("ground");
    expect(targetFor("angle_3d_3point", true)).toBe("ground");
    expect(targetFor("distance_2d", true)).toBe("camel");
    expect(targetFor("angle_2d_from_horizontal", true)).toBe("camel");
    expect(targetFor("distance_3d", false)).toBe("camel");
    // the hover readout with no tool shows what a ground point would get
    expect(targetFor(null, true)).toBe("ground");
  });
});

describe("placing points", () => {
  it("a distance completes on its second click, an angle on its third", () => {
    expect(draw("distance_2d", [[1, 1]]).complete).toBe(false);
    expect(
      draw("distance_2d", [
        [1, 1],
        [9, 9],
      ]).complete,
    ).toBe(true);
    expect(
      draw("angle_3d_3point", [
        [1, 1],
        [9, 9],
      ]).complete,
    ).toBe(false);
    expect(
      draw("angle_3d_3point", [
        [1, 1],
        [9, 9],
        [5, 1],
      ]).complete,
    ).toBe(true);
  });

  it("each click keeps its own target", () => {
    let placed = placePoint(null, "distance_3d", [1, 1], "camel");
    placed = placePoint(placed.shape, "distance_3d", [9, 9], "ground");
    expect(placed.shape.targets).toEqual(["camel", "ground"]);
  });

  it("a curve finishes when a click lands on its last point (a double-click, a second Enter)", () => {
    const { shape } = draw("curve_3d", [
      [1, 1],
      [5, 5],
    ]);
    const again = placePoint(shape, "curve_3d", [5, 6], "camel", 2);
    expect(again.complete).toBe(true);
    expect(again.shape.points).toHaveLength(2);
    // a single point on top of itself finishes nothing
    const one = placePoint(draw("curve_2d", [[1, 1]]).shape, "curve_2d", [1, 1], "camel", 2);
    expect(one).toMatchObject({ complete: false, shape: { points: [[1, 1]] } });
  });

  it("a double-click never makes a zero-length distance: the repeated point is ignored", () => {
    const first = draw("distance_2d", [[3, 3]]).shape;
    const repeat = placePoint(first, "distance_2d", [3, 3], "camel", 2);
    expect(repeat).toMatchObject({ complete: false, shape: { points: [[3, 3]] } });
  });

  it("a 4-point angle takes no clicks", () => {
    expect(placePoint(null, "angle_4point", [3, 3], "camel")).toMatchObject({
      complete: false,
      shape: { points: [] },
    });
  });

  it("another kind starts a new shape", () => {
    const { shape } = draw("distance_2d", [[1, 1]]);
    expect(placePoint(shape, "curve_2d", [5, 5], "camel").shape).toEqual({
      kind: "curve_2d",
      points: [[5, 5]],
      targets: ["camel"],
    });
  });

  it("Enter or a double-click finishes a curve of two points or more, nothing else", () => {
    expect(finishCurve(draw("curve_2d", [[1, 1]]).shape)).toBeNull();
    expect(
      finishCurve(
        draw("curve_2d", [
          [1, 1],
          [2, 2],
        ]).shape,
      )?.points,
    ).toHaveLength(2);
    expect(finishCurve(draw("distance_2d", [[1, 1]]).shape)).toBeNull();
  });

  it("Backspace removes the last click; nothing left is no shape", () => {
    const { shape } = draw("curve_2d", [
      [1, 1],
      [2, 2],
    ]);
    expect(removeLastPoint(shape)?.points).toEqual([[1, 1]]);
    expect(removeLastPoint(removeLastPoint(shape))).toBeNull();
  });
});

describe("what is sent to the engine", () => {
  it("previews with the crosshair as the next point once that makes a whole measurement", () => {
    const one = draw("distance_3d", [[1, 1]]).shape;
    expect(previewInput(one, { at: [9, 9], target: "ground" }, 7)).toEqual({
      id: 7,
      kind: "distance_3d",
      name: "",
      points: [
        [1, 1],
        [9, 9],
      ],
      targets: ["camel", "ground"],
      note: "",
    });
    // a 3-point angle one click in: not yet a measurement
    const vertex = draw("angle_2d_3point", [[1, 1]]).shape;
    expect(previewInput(vertex, { at: [9, 9], target: "camel" }, 7)).toBeNull();
    // a curve from its first point on
    const curve = draw("curve_2d", [[1, 1]]).shape;
    expect(previewInput(curve, { at: [4, 4], target: "camel" }, 7)?.points).toHaveLength(2);
    expect(previewInput(null, { at: [4, 4], target: "camel" }, 7)).toBeNull();
  });

  it("the crosshair on the last point is not a second point", () => {
    const curve = draw("curve_2d", [
      [1, 1],
      [4, 4],
    ]).shape;
    expect(previewInput(curve, { at: [4, 4], target: "camel" }, 7)?.points).toHaveLength(2);
  });

  it("a finished shape becomes the input the draft holds", () => {
    const { shape } = draw("angle_2d_from_horizontal", [
      [1, 2],
      [3, 4],
    ]);
    expect(toInput(shape, 12, "neck")).toEqual({
      id: 12,
      kind: "angle_2d_from_horizontal",
      name: "neck",
      points: [
        [1, 2],
        [3, 4],
      ],
      targets: ["camel", "camel"],
      note: "",
    });
  });

  it("pointer positions are image pixels inside the frame, two decimals", () => {
    expect(imagePoint([100.12345, 50.6789], frame)).toEqual([100.12, 50.68]);
    expect(imagePoint([-4, 900], frame)).toEqual([0, 719]);
    expect(imagePoint([1280, 0], frame)).toEqual([1279, 0]);
  });
});

describe("zoom and pan in image space", () => {
  it("zooming keeps the anchor where it is on screen and stays inside the frame", () => {
    const view = zoomAt(fitViewport(frame), frame, 2, [320, 180]);
    expect(zoomOf(view, frame)).toBe(2);
    expect(view).toEqual({ x: 160, y: 90, width: 640, height: 360 });
    // the anchor's relative position is unchanged
    expect((320 - view.x) / view.width).toBeCloseTo(320 / 1280);
    // fully zoomed out is the whole frame; zoom has a ceiling
    expect(zoomAt(view, frame, 0.01, [0, 0])).toEqual(fitViewport(frame));
    expect(zoomOf(zoomAt(view, frame, 1000, [10, 10]), frame)).toBe(MAX_ZOOM);
  });

  it("panning stops at the frame's edges", () => {
    const view = zoomAt(fitViewport(frame), frame, 4, [640, 360]);
    expect(panBy(view, frame, -10_000, 0).x).toBe(0);
    expect(panBy(view, frame, 10_000, 10_000)).toMatchObject({
      x: 1280 - view.width,
      y: 720 - view.height,
    });
    expect(clampViewport({ x: -5, y: -5, width: 5000, height: 1 }, frame)).toEqual(
      fitViewport(frame),
    );
  });

  it("the keyboard crosshair keeps itself visible", () => {
    const view = zoomAt(fitViewport(frame), frame, 4, [640, 360]);
    expect(keepVisible(view, frame, [640, 360], 10)).toBe(view);
    const moved = keepVisible(view, frame, [view.x + view.width + 50, 360], 10);
    expect(moved.x).toBeCloseTo(view.x + 60);
    expect(moved.width).toBe(view.width);
  });
});

describe("hit-testing the drawn rows", () => {
  const rows = allKindRows();

  it("a click on a line selects its row; empty space selects nothing", () => {
    const first = sessionRows[0]!; // a 2D distance from (841.57, 338.84) to (482.2, 279.95)
    const middle: [number, number] = [(841.57 + 482.2) / 2, (338.84 + 279.95) / 2];
    expect(hitRow([first], middle, 3)).toBe(first.id);
    expect(hitRow([first], [10, 700], 3)).toBeNull();
  });

  it("the nearest row wins; a filter limits the candidates (4-point angles pick lines)", () => {
    const lines = rows.filter((row) => row.family === "lines");
    const target = lines[1]!;
    const p = target["p1_px"] as [number, number];
    expect(hitRow(rows, p, 4, (row) => row.family === "lines")).toBe(target.id);
    expect(hitRow(rows, p, 4, (row) => row.family === "curves")).not.toBe(target.id);
  });

  it("a point of the selected row is found by its index in the input's order", () => {
    const row = sessionRows[0]!;
    const p2 = row["p2_px"] as [number, number];
    expect(hitPoint(row, [p2[0] + 1, p2[1] - 1], 4)).toBe(1);
    expect(hitPoint(row, [p2[0] + 30, p2[1]], 4)).toBeNull();
  });
});
