import { describe, expect, it } from "vitest";
import type { MeasurementRow } from "@/api/types";
import { allKindRows, fixtures, sessionRows } from "@/design/fixtures";
import {
  arcBetween,
  ARC_RADIUS_PX,
  depthBoxOf,
  drawnPoint,
  drawRow,
  groundLineOf,
  LABEL_OFFSET_PX,
  lineLabelAnchor,
  placeLabels,
  type DrawnRow,
} from "./geometry";

const byId = new Map(allKindRows().map((row) => [row.id, row]));
const draw = (row: MeasurementRow) => drawRow(row, byId);
const row = (id: number) => byId.get(id)!;

function shapeOf<T extends DrawnRow["shape"]["type"]>(drawn: DrawnRow, type: T) {
  expect(drawn.shape.type).toBe(type);
  return drawn.shape as Extract<DrawnRow["shape"], { type: T }>;
}

describe("drawRow on the real session rows", () => {
  it("2D distances: a segment between the engine's p1/p2, plain markers (no provenance)", () => {
    const drawn = draw(row(1));
    const seg = shapeOf(drawn, "segment");
    expect(seg.a.at).toEqual([841.57, 338.84]);
    expect(seg.b.at).toEqual([482.2, 279.95]);
    expect([seg.a.marker, seg.b.marker]).toEqual(["direct", "direct"]);
    expect(drawn.color).toBe("#BE2C2C");
    expect(drawn.rejected).toBe(false);
  });

  it("3D distance with a point outside the camel: KNN ring with its leader to the neighbour centroid", () => {
    const seg = shapeOf(draw(row(6)), "segment");
    expect(seg.a.marker).toBe("direct");
    expect(seg.b.marker).toBe("knn");
    expect(seg.b.centroid).toEqual([448, 399.1111111111111]);
  });

  it("3D distance to a Shift-click ground point: the target comes from the provenance", () => {
    const seg = shapeOf(draw(row(7)), "segment");
    expect(seg.b.target).toBe("ground");
    expect(seg.b.marker).toBe("direct"); // direct_off_mask is not a KNN source
    expect(seg.a.target).toBe("camel");
  });

  it("curves: every control point, and the 3D curve's flagged segment", () => {
    const curve2d = shapeOf(draw(row(8)), "polyline");
    expect(curve2d.points).toHaveLength(5);
    expect(curve2d.flagged).toEqual([]);
    const curve3d = shapeOf(draw(row(9)), "polyline");
    expect(curve3d.flagged).toEqual([0]); // segment_flags [["segment_depth_jump"], [], [], []]
    expect(curve3d.points.every((p) => p.marker === "direct")).toBe(true);
  });

  it("labels sit where the overlay puts them", () => {
    const line = draw(row(2));
    expect(line.anchor).toEqual(lineLabelAnchor([651.15, 333.34], [625.24, 171.94]));
    const curve = draw(row(8));
    expect(curve.anchor).toEqual([585.55, 348.81 - LABEL_OFFSET_PX - 4]); // the middle point
  });
});

describe("drawRow on the preview rows (angles, rejection)", () => {
  it("3-point angles: vertex first, arc between the rays, label along the bisector", () => {
    const drawn = draw(row(10));
    const angle = shapeOf(drawn, "angle");
    expect(angle.vertex.at).toEqual([585.55, 348.81]);
    expect(angle.arc.radius).toBe(ARC_RADIUS_PX);
    expect(angle.arc.path).toMatch(/^M [\d.-]+ [\d.-]+ A 38 38 0 0 1 [\d.-]+ [\d.-]+$/);
    expect(drawn.anchor).not.toBeNull();
    // 3D angles carry provenance markers, 2D angles do not
    expect(shapeOf(draw(row(11)), "angle").vertex.marker).toBe("direct");
  });

  it("angle from the horizontal: a reference ray 40 px toward the second point", () => {
    const horizontal = shapeOf(draw(row(12)), "horizontal");
    expect(horizontal.ref).toEqual([395.35 + 40, 358.18]);
    expect(horizontal.arc).not.toBeNull();
  });

  it("4-point angles draw no geometry; the label sits between the two lines", () => {
    const drawn = draw(row(13));
    expect(shapeOf(drawn, "between")).toEqual({ type: "between", lineA: 1, lineB: 2 });
    const ends = [row(1), row(2)].flatMap((r) => [r["p1_px"], r["p2_px"]] as [number, number][]);
    expect(drawn.anchor![0]).toBeCloseTo(ends.reduce((s, p) => s + p[0], 0) / 4, 9);
    expect(drawn.anchor![1]).toBeCloseTo(ends.reduce((s, p) => s + p[1], 0) / 4, 9);
  });

  it("a rejected 4-point angle is grey; one with an unknown line has no label anchor", () => {
    expect(draw(row(14)).color).toBe("#9e9e9e");
    expect(drawRow(row(13), new Map()).anchor).toBeNull();
  });

  it("a rejected row is grey; its out-of-image point is a rejected cross", () => {
    const drawn = draw(row(15));
    expect(drawn.rejected).toBe(true);
    expect(drawn.color).toBe("#9e9e9e");
    const seg = shapeOf(drawn, "segment");
    expect(seg.a.marker).toBe("rejected");
    expect(seg.b.marker).toBe("direct");
  });

  it("never invents geometry: a row without its point fields draws nothing", () => {
    const broken = { ...row(1), p1_px: null } as MeasurementRow;
    expect(draw(broken)).toMatchObject({ shape: { type: "none" }, anchor: null });
  });
});

describe("geometry helpers", () => {
  it("drawnPoint without provenance is a direct marker of the row's target", () => {
    expect(drawnPoint([1, 2], null, "ground", true)).toEqual({
      at: [1, 2],
      marker: "direct",
      centroid: null,
      target: "ground",
    });
  });

  it("arcBetween takes the smaller way round, in either order", () => {
    const a = arcBetween([0, 0], [10, 0], [0, 10], 5); // 90° clockwise on screen
    const b = arcBetween([0, 0], [0, 10], [10, 0], 5);
    expect(a.path).toBe("M 5 0 A 5 5 0 0 1 0 5");
    expect(b.path).toBe(a.path);
    expect(a.bisector).toBeCloseTo(Math.PI / 4, 9);
  });

  it("line labels go above the line (image y grows downward)", () => {
    const [, y] = lineLabelAnchor([0, 100], [100, 100]);
    expect(y).toBe(100 - LABEL_OFFSET_PX);
    expect(lineLabelAnchor([5, 5], [5, 5])).toEqual([5, 5 - LABEL_OFFSET_PX]);
  });

  it("ground line padded like the overlay; far-leg row only with its badge", () => {
    const frame = fixtures.sessionView.frame;
    expect(groundLineOf(frame)).toEqual({ row: 691, x0: 231, x1: 1279, rawRow: null, badge: null });
    expect(
      groundLineOf({
        ...frame,
        ground: { ...frame.ground, badge: "far_side_row_differs", raw_row: 715 },
      })?.rawRow,
    ).toBe(715);
    expect(groundLineOf({ ...frame, ground: {} })).toBeNull();
    expect(depthBoxOf(frame)).toEqual([29, 107, 1273, 719]);
  });

  it("covers every row kind in the fixtures", () => {
    const kinds = new Set(allKindRows().map((r) => r.kind));
    expect(kinds).toEqual(
      new Set([
        "distance_2d",
        "distance_3d",
        "curve_2d",
        "curve_3d",
        "angle_2d_3point",
        "angle_3d_3point",
        "angle_2d_from_horizontal",
        "angle_2d_4point",
        "angle_3d_4point",
      ]),
    );
    expect(sessionRows).toHaveLength(9);
  });
});

describe("placeLabels (overlay.py place_labels)", () => {
  const box = (id: number, x0: number, y0: number) => ({ id, x0, y0, x1: x0 + 100, y1: y0 + 20 });

  it("free labels keep their anchors", () => {
    const shifts = placeLabels([box(1, 0, 0), box(2, 200, 0)]);
    expect([...shifts]).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });

  it("a label on top of another moves one label height (+8 px) up first, then down", () => {
    const shifts = placeLabels([box(1, 0, 100), box(2, 10, 100), box(3, 20, 100)]);
    expect(shifts.get(1)).toBe(0);
    expect(shifts.get(2)).toBe(-28);
    expect(shifts.get(3)).toBe(28);
  });

  it("the selected row is placed first and keeps its anchor", () => {
    const shifts = placeLabels([box(1, 0, 100), box(2, 10, 100)], 2);
    expect(shifts.get(2)).toBe(0);
    expect(shifts.get(1)).toBe(-28);
  });

  it("never moves a label out of the canvas", () => {
    const bounds = { top: 0, bottom: 130 };
    // at the bottom edge: "down" would leave the canvas, so the second label goes up twice
    const shifts = placeLabels([box(1, 0, 100), box(2, 10, 100), box(3, 20, 100)], null, bounds);
    expect(shifts.get(2)).toBe(-28);
    expect(shifts.get(3)).toBe(-56);
  });

  it("labels without layout (zero width) are left alone", () => {
    expect(placeLabels([{ id: 1, x0: 0, y0: 0, x1: 0, y1: 0 }]).size).toBe(0);
  });
});
