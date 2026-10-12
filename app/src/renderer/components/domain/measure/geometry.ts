/**
 * What the editing canvas draws for each computed row, read from the engine's kind-specific
 * fields (p1_px, points_px, vertex_px, …, the per-point depth provenance and segment flags) and
 * laid out with the overlay's own rules (engine/nazeer_engine/overlay.py): markers with provenance
 * only on 3D kinds, rejected rows grey and dashed, flagged 3D-curve segments red, angle arcs at
 * min(38 px, 0.35 × the shorter ray), labels at the same anchors. Pure display geometry: no value,
 * depth or rejection is computed here — every one comes from the row.
 */
import type { FrameInfo, MeasurementRow, Target } from "@/api/types";
import { depthMarker, OVERLAY_STYLE, type DepthMarker, type DepthSource } from "@/design";
import {
  asBox,
  asPoint,
  isRecord,
  readArray,
  readNumber,
  readPoint,
  readString,
  type Point,
} from "@/lib/read";

/** overlay.py constants (image pixels) */
export const LABEL_OFFSET_PX = 14;
export const ARC_RADIUS_PX = 38;
export const ARC_LABEL_OFFSET_PX = 18;
export const GROUND_PAD_PX = 40;
export const HORIZONTAL_REF_PX = 40;

export interface DrawnPoint {
  at: Point;
  marker: DepthMarker;
  /** KNN neighbour centroid (the dotted leader goes there) */
  centroid: Point | null;
  target: Target;
}

export interface Arc {
  /** SVG path in image coordinates */
  path: string;
  radius: number;
  /** direction of the arc's middle (radians, image coordinates: y grows downwards) */
  bisector: number;
}

export type Shape =
  | { type: "segment"; a: DrawnPoint; b: DrawnPoint }
  | { type: "polyline"; points: DrawnPoint[]; flagged: number[] }
  | { type: "angle"; vertex: DrawnPoint; a: DrawnPoint; b: DrawnPoint; arc: Arc }
  | { type: "horizontal"; a: DrawnPoint; b: DrawnPoint; ref: Point; arc: Arc | null }
  | { type: "between"; lineA: number | null; lineB: number | null }
  | { type: "none" };

export interface DrawnRow {
  id: number;
  /** the row's display colour, or the overlay's grey when the row is rejected */
  color: string;
  rejected: boolean;
  shape: Shape;
  /** where the label goes (null: nothing to anchor to) */
  anchor: Point | null;
}

/** A shape's points in the input's order (vertex first for a 3-point angle). */
export function shapePoints(shape: Shape): DrawnPoint[] {
  switch (shape.type) {
    case "segment":
    case "horizontal":
      return [shape.a, shape.b];
    case "polyline":
      return shape.points;
    case "angle":
      return [shape.vertex, shape.a, shape.b];
    default:
      return [];
  }
}

/** Kinds whose points carry depth provenance on the overlay (3D kinds). */
const PROVENANCE_KINDS = new Set<MeasurementRow["kind"]>([
  "distance_3d",
  "curve_3d",
  "angle_3d_3point",
]);

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function target(value: unknown): Target {
  return value === "ground" ? "ground" : "camel";
}

/** A point with the marker its provenance calls for (C1.6), as overlay.py draws it. */
export function drawnPoint(
  at: Point,
  provenance: unknown,
  rowTarget: unknown,
  useProvenance: boolean,
): DrawnPoint {
  const fallbackTarget = target(rowTarget);
  if (!useProvenance || !isRecord(provenance)) {
    return { at, marker: "direct", centroid: null, target: fallbackTarget };
  }
  const reason = readString(provenance, "reason");
  const source = readString(provenance, "source") as DepthSource | null;
  const marker = depthMarker(source, reason);
  return {
    at,
    marker,
    centroid: marker === "knn" ? readPoint(provenance, "nn_centroid_px") : null,
    target: provenance["target"] === undefined ? fallbackTarget : target(provenance["target"]),
  };
}

/** The arc at `vertex` between the rays to `a` and `b`, the smaller way round (overlay.py arc). */
export function arcBetween(vertex: Point, a: Point, b: Point, radius: number): Arc {
  const [vx, vy] = vertex;
  const ta = Math.atan2(a[1] - vy, a[0] - vx);
  const tb = Math.atan2(b[1] - vy, b[0] - vx);
  const turn = 2 * Math.PI;
  const sweep = (((tb - ta) % turn) + turn) % turn;
  const [t1, t2] = sweep <= Math.PI ? [ta, tb] : [tb, ta];
  const span = (((t2 - t1) % turn) + turn) % turn;
  const round = (n: number) => Math.round(n * 100) / 100;
  const sx = round(vx + radius * Math.cos(t1));
  const sy = round(vy + radius * Math.sin(t1));
  const ex = round(vx + radius * Math.cos(t2));
  const ey = round(vy + radius * Math.sin(t2));
  // angles grow clockwise on screen (y down): sweep-flag 1; the span is at most 180°
  return {
    path: `M ${sx} ${sy} A ${radius} ${radius} 0 0 1 ${ex} ${ey}`,
    radius,
    bisector: t1 + span / 2,
  };
}

/** Above the middle of a line, offset along its normal (overlay.py _line_label_anchor). */
export function lineLabelAnchor(p1: Point, p2: Point): Point {
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const norm = Math.hypot(dx, dy);
  if (norm < 1e-9) return [mx, my - LABEL_OFFSET_PX];
  let px = -dy / norm;
  let py = dx / norm;
  if (py > 0) {
    px = -px;
    py = -py;
  }
  return [mx + px * LABEL_OFFSET_PX, my + py * LABEL_OFFSET_PX];
}

function pointsOf(row: MeasurementRow): Point[] {
  return (readArray(row, "points_px") ?? []).map(asPoint).filter((p): p is Point => p !== null);
}

/**
 * The drawing of one computed row. `rowsById` resolves a 4-point angle's referenced lines (its
 * label sits at the centroid of their four endpoints, as on the overlay).
 */
export function drawRow(
  row: MeasurementRow,
  rowsById: ReadonlyMap<number, MeasurementRow> = new Map(),
): DrawnRow {
  const rejected = row.rejection_reason !== "";
  const color = rejected ? OVERLAY_STYLE.rejectedColor : row.display_color;
  const useProvenance = PROVENANCE_KINDS.has(row.kind);
  const targets = row.targets;
  const base = { id: row.id, color, rejected };

  if (row.family === "lines") {
    const p1 = readPoint(row, "p1_px");
    const p2 = readPoint(row, "p2_px");
    if (p1 === null || p2 === null) return { ...base, shape: { type: "none" }, anchor: null };
    return {
      ...base,
      shape: {
        type: "segment",
        a: drawnPoint(p1, row["p1_depth"], targets[0], useProvenance),
        b: drawnPoint(p2, row["p2_depth"], targets[1], useProvenance),
      },
      anchor: lineLabelAnchor(p1, p2),
    };
  }

  if (row.family === "curves") {
    const pts = pointsOf(row);
    const provenance = readArray(row, "point_depth") ?? [];
    const flagged = (readArray(row, "segment_flags") ?? []).flatMap((flags, i) =>
      Array.isArray(flags) && flags.length > 0 && i + 1 < pts.length ? [i] : [],
    );
    const mid = pts[Math.floor(pts.length / 2)];
    return {
      ...base,
      shape: {
        type: "polyline",
        points: pts.map((p, i) => drawnPoint(p, provenance[i], targets[i], useProvenance)),
        flagged,
      },
      anchor: mid === undefined ? null : [mid[0], mid[1] - LABEL_OFFSET_PX - 4],
    };
  }

  if (row.kind === "angle_2d_3point" || row.kind === "angle_3d_3point") {
    const v = readPoint(row, "vertex_px");
    const a = readPoint(row, "endpoint_a_px");
    const b = readPoint(row, "endpoint_b_px");
    if (v === null || a === null || b === null)
      return { ...base, shape: { type: "none" }, anchor: null };
    const radius = Math.max(6, Math.min(ARC_RADIUS_PX, 0.35 * Math.min(dist(v, a), dist(v, b))));
    const arc = arcBetween(v, a, b, radius);
    const reach = radius + ARC_LABEL_OFFSET_PX;
    return {
      ...base,
      shape: {
        type: "angle",
        vertex: drawnPoint(v, row["vertex_depth"], targets[0], useProvenance),
        a: drawnPoint(a, row["endpoint_a_depth"], targets[1], useProvenance),
        b: drawnPoint(b, row["endpoint_b_depth"], targets[2], useProvenance),
        arc,
      },
      anchor: [v[0] + reach * Math.cos(arc.bisector), v[1] + reach * Math.sin(arc.bisector)],
    };
  }

  if (row.kind === "angle_2d_from_horizontal") {
    const a = readPoint(row, "endpoint_a_px");
    const b = readPoint(row, "endpoint_b_px");
    if (a === null || b === null) return { ...base, shape: { type: "none" }, anchor: null };
    const direction = b[0] >= a[0] ? 1 : -1;
    const ref: Point = [a[0] + direction * HORIZONTAL_REF_PX, a[1]];
    const length = dist(a, b);
    const arc =
      length > 1e-6
        ? arcBetween(a, ref, b, Math.max(6, Math.min(ARC_RADIUS_PX, 0.35 * length)))
        : null;
    return {
      ...base,
      shape: {
        type: "horizontal",
        a: drawnPoint(a, null, targets[0], false),
        b: drawnPoint(b, null, targets[1], false),
        ref,
        arc,
      },
      anchor: lineLabelAnchor(a, b),
    };
  }

  // a 4-point angle draws no geometry of its own: its label sits between the two lines
  const lineA = typeof row["line_a_id"] === "number" ? row["line_a_id"] : null;
  const lineB = typeof row["line_b_id"] === "number" ? row["line_b_id"] : null;
  const ends = [lineA, lineB].flatMap((id) => {
    const line = id === null ? undefined : rowsById.get(id);
    const p1 = line ? readPoint(line, "p1_px") : null;
    const p2 = line ? readPoint(line, "p2_px") : null;
    return p1 && p2 ? [p1, p2] : [];
  });
  const anchor: Point | null =
    ends.length === 4
      ? [ends.reduce((s, p) => s + p[0], 0) / 4, ends.reduce((s, p) => s + p[1], 0) / 4]
      : null;
  return { ...base, shape: { type: "between", lineA, lineB }, anchor };
}

export interface GroundLine {
  row: number;
  x0: number;
  x1: number;
  /** the far-leg row, drawn dashed when the engine flags that it differs */
  rawRow: number | null;
  badge: string | null;
}

/** The near-plane ground line as the overlay draws it (x range padded by 40 px). */
export function groundLineOf(frame: Pick<FrameInfo, "ground" | "width">): GroundLine | null {
  const row = readNumber(frame.ground, "drawn_row");
  const xMin = readNumber(frame.ground, "x_min");
  const xMax = readNumber(frame.ground, "x_max");
  if (row === null || xMin === null || xMax === null) return null;
  const badge = readString(frame.ground, "badge");
  return {
    row,
    x0: Math.max(0, xMin - GROUND_PAD_PX),
    x1: Math.min(frame.width - 1, xMax + GROUND_PAD_PX),
    rawRow: badge === "far_side_row_differs" ? readNumber(frame.ground, "raw_row") : null,
    badge,
  };
}

export function depthBoxOf(frame: Pick<FrameInfo, "depth_valid_bbox">) {
  return asBox(frame.depth_valid_bbox);
}

/** A label's box on screen (px), keyed by row id. */
export interface LabelBox {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const LABEL_STEPS = [0, 1, -1, 2, -2, 3, -3, 4, -4] as const;

/**
 * Labels laid out without overlaps the way the overlay does it (overlay.py place_labels): each
 * keeps its anchor when free, else tries one label height (+ 8 px) up, down, two up, … four down,
 * keeping the first free slot inside the canvas (or its anchor when none is). The selected row is
 * placed first so its label stays put. Returns the vertical shift of each label in screen pixels.
 */
export function placeLabels(
  boxes: readonly LabelBox[],
  firstId: number | null = null,
  bounds: { top: number; bottom: number } | null = null,
  pad = 4,
): Map<number, number> {
  const ordered = [...boxes].sort((a, b) => Number(b.id === firstId) - Number(a.id === firstId));
  const overlaps = (a: LabelBox, b: LabelBox) =>
    !(a.x1 + pad <= b.x0 || b.x1 + pad <= a.x0 || a.y1 + pad <= b.y0 || b.y1 + pad <= a.y0);
  const placed: LabelBox[] = [];
  const shifts = new Map<number, number>();
  for (const box of ordered) {
    if (box.x1 <= box.x0) continue; // not laid out (hidden, or no layout engine)
    const step = box.y1 - box.y0 + 8;
    let chosen = 0;
    for (const k of LABEL_STEPS) {
      const shift = k === 0 ? 0 : -k * step; // k = 1 moves the label up, as on the overlay
      const trial = { ...box, y0: box.y0 + shift, y1: box.y1 + shift };
      const inside = bounds === null || (trial.y0 >= bounds.top && trial.y1 <= bounds.bottom);
      if ((inside || k === 0) && !placed.some((other) => overlaps(trial, other))) {
        chosen = shift;
        break;
      }
    }
    placed.push({ ...box, y0: box.y0 + chosen, y1: box.y1 + chosen });
    shifts.set(box.id, chosen);
  }
  return shifts;
}
