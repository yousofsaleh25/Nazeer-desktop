/**
 * The editing canvas's input rules as pure functions (the measuring screen holds the state): how
 * many points each kind takes, which target a click gets, how a shape grows and completes, the
 * inputs sent for a live preview and for the draft, zoom and pan in image space, and hit-testing
 * the drawn rows. Nothing here computes a value, a depth or a rejection: the engine does.
 */
import type { InputKind, MeasurementInput, MeasurementRow, Target } from "@/api/types";
import type { Point } from "@/lib/read";
import { drawRow, shapePoints, type DrawnRow } from "./geometry";
import type { Viewport } from "./MeasureCanvas";

/** The engine's point limit for a curve (MeasurementInputModel). */
export const MAX_SHAPE_POINTS = 500;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 16;
/** One zoom step (keys + and −, one wheel notch). */
export const ZOOM_STEP = 1.25;
/** Arrow keys move the keyboard crosshair by 1 image pixel, with Shift by 10. */
export const KEY_STEP_PX = 1;
export const KEY_STEP_FAST_PX = 10;
/** Pointer tolerances in screen pixels (converted to image pixels by the caller's scale). */
export const HIT_TOLERANCE_PX = 7;
export const SAME_POINT_PX = 3;

/** Points each kind takes: a fixed count, null for a curve (two or more), 0 for a 4-point angle. */
export function requiredPoints(kind: InputKind): number | null {
  switch (kind) {
    case "distance_2d":
    case "distance_3d":
    case "angle_2d_from_horizontal":
      return 2;
    case "angle_2d_3point":
    case "angle_3d_3point":
      return 3;
    case "angle_4point":
      return 0;
    case "curve_2d":
    case "curve_3d":
      return null;
  }
}

const KINDS_3D: ReadonlySet<InputKind> = new Set(["distance_3d", "curve_3d", "angle_3d_3point"]);
const KINDS_2D: ReadonlySet<InputKind> = new Set([
  "distance_2d",
  "curve_2d",
  "angle_2d_3point",
  "angle_2d_from_horizontal",
]);

/** Kinds whose points read per-pixel depth (C1). */
export function is3dKind(kind: InputKind | null): boolean {
  return kind !== null && KINDS_3D.has(kind);
}

/** Kinds computed in the Z_ref plane: per-pixel depth is metadata only. */
export function is2dKind(kind: InputKind | null): boolean {
  return kind !== null && KINDS_2D.has(kind);
}

/**
 * Shift-click (Shift+Enter) marks a ground / background point (C1.4). Only the 3D kinds read
 * per-point depth, so a 2D kind always clicks the camel; with no tool chosen, the hover readout
 * shows what a ground point would resolve to.
 */
export function targetFor(kind: InputKind | null, shift: boolean): Target {
  return shift && (kind === null || is3dKind(kind)) ? "ground" : "camel";
}

/** A measurement being drawn: the clicks so far (no value: the engine computes it). */
export interface Shape {
  kind: InputKind;
  points: Point[];
  targets: Target[];
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export interface Placed {
  shape: Shape;
  /** every point is in: the operator names it next */
  complete: boolean;
}

/**
 * A click (or Enter at the keyboard crosshair) with `kind` chosen. A click on top of the previous
 * point (within `samePx` image pixels) finishes a curve of two or more points — that is what a
 * double-click or a second Enter does — and is ignored by the fixed-count kinds (no zero-length
 * segment from a double-click). A 4-point angle takes no points (its lines are picked instead).
 */
export function placePoint(
  shape: Shape | null,
  kind: InputKind,
  at: Point,
  target: Target,
  samePx = 0,
): Placed {
  const start: Shape =
    shape !== null && shape.kind === kind ? shape : { kind, points: [], targets: [] };
  const required = requiredPoints(kind);
  if (required === 0) return { shape: start, complete: false };
  const last = start.points.at(-1);
  if (last !== undefined && distance(last, at) <= samePx) {
    return { shape: start, complete: required === null && start.points.length >= 2 };
  }
  const next: Shape = {
    kind,
    points: [...start.points, at],
    targets: [...start.targets, target],
  };
  const complete =
    required === null ? next.points.length >= MAX_SHAPE_POINTS : next.points.length >= required;
  return { shape: next, complete };
}

/** Finish a curve (Enter, double-click): two points or more, else nothing to finish. */
export function finishCurve(shape: Shape | null): Shape | null {
  if (shape === null || requiredPoints(shape.kind) !== null) return null;
  return shape.points.length >= 2 ? shape : null;
}

/** Backspace while drawing: the last click goes; nothing left = no shape. */
export function removeLastPoint(shape: Shape | null): Shape | null {
  if (shape === null || shape.points.length <= 1) return null;
  return { ...shape, points: shape.points.slice(0, -1), targets: shape.targets.slice(0, -1) };
}

/**
 * The input to preview while drawing: the clicks so far plus the crosshair as the next point,
 * once that makes a whole measurement (a fixed-count kind one click short of done, a curve from
 * its first point on); null otherwise. Unnamed: a name never changes a value.
 */
export function previewInput(
  shape: Shape | null,
  cursor: { at: Point; target: Target } | null,
  id: number,
): MeasurementInput | null {
  if (shape === null || cursor === null || shape.points.length === 0) return null;
  const required = requiredPoints(shape.kind);
  const last = shape.points.at(-1);
  const onLast = last !== undefined && distance(last, cursor.at) === 0;
  const points = onLast ? shape.points : [...shape.points, cursor.at];
  const targets = onLast ? shape.targets : [...shape.targets, cursor.target];
  if (required === null ? points.length < 2 : points.length !== required) return null;
  return toInput({ kind: shape.kind, points, targets }, id, "");
}

export type InputFields = Omit<MeasurementInput, "id">;

/** A finished shape as a new measurement (the store gives it its id). */
export function shapeFields(shape: Shape, name: string): InputFields {
  return {
    kind: shape.kind,
    name,
    points: shape.points.map(([u, v]) => [u, v] as [number, number]),
    targets: [...shape.targets],
    note: "",
  };
}

/** A 4-point angle between two line measurements, as a new measurement. */
export function angleFields(name: string, lineA: number, lineB: number): InputFields {
  return {
    kind: "angle_4point",
    name,
    points: [],
    targets: [],
    line_a_id: lineA,
    line_b_id: lineB,
    note: "",
  };
}

/** The draft input of a finished shape. */
export function toInput(shape: Shape, id: number, name: string): MeasurementInput {
  return { id, ...shapeFields(shape, name) };
}

/** The draft input of a 4-point angle between two line measurements. */
export function angleBetweenLines(
  id: number,
  name: string,
  lineA: number,
  lineB: number,
): MeasurementInput {
  return { id, ...angleFields(name, lineA, lineB) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** A pointer or keyboard position as an image pixel: inside the frame, two decimals. */
export function imagePoint(at: Point, frame: { width: number; height: number }): Point {
  return [round2(clamp(at[0], 0, frame.width - 1)), round2(clamp(at[1], 0, frame.height - 1))];
}

// ----- zoom and pan (image space; the viewport keeps the frame's aspect ratio) -------------------

type Frame = { width: number; height: number };

export function fitViewport(frame: Frame): Viewport {
  return { x: 0, y: 0, width: frame.width, height: frame.height };
}

export function zoomOf(view: Viewport, frame: Frame): number {
  return frame.width / view.width;
}

export function clampViewport(view: Viewport, frame: Frame): Viewport {
  const width = clamp(view.width, frame.width / MAX_ZOOM, frame.width);
  const height = (width * frame.height) / frame.width;
  return {
    x: clamp(view.x, 0, frame.width - width),
    y: clamp(view.y, 0, frame.height - height),
    width,
    height,
  };
}

/** Zoom by `factor`, keeping the image point `anchor` where it is on screen. */
export function zoomAt(view: Viewport, frame: Frame, factor: number, anchor: Point): Viewport {
  const zoom = clamp(zoomOf(view, frame) * factor, MIN_ZOOM, MAX_ZOOM);
  const width = frame.width / zoom;
  const height = frame.height / zoom;
  const fx = (anchor[0] - view.x) / view.width;
  const fy = (anchor[1] - view.y) / view.height;
  return clampViewport(
    { x: anchor[0] - fx * width, y: anchor[1] - fy * height, width, height },
    frame,
  );
}

/** Move the view by (dx, dy) image pixels. */
export function panBy(view: Viewport, frame: Frame, dx: number, dy: number): Viewport {
  return clampViewport({ ...view, x: view.x + dx, y: view.y + dy }, frame);
}

/** The view moved just enough to show `p` with `margin` image pixels around it. */
export function keepVisible(view: Viewport, frame: Frame, p: Point, margin: number): Viewport {
  let { x, y } = view;
  if (p[0] < x + margin) x = p[0] - margin;
  else if (p[0] > x + view.width - margin) x = p[0] - view.width + margin;
  if (p[1] < y + margin) y = p[1] - margin;
  else if (p[1] > y + view.height - margin) y = p[1] - view.height + margin;
  return x === view.x && y === view.y ? view : clampViewport({ ...view, x, y }, frame);
}

// ----- hit-testing the drawn rows ------------------------------------------------------------------

function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2, 0, 1);
  return distance(p, [a[0] + t * dx, a[1] + t * dy]);
}

function segmentsOf(drawn: DrawnRow): [Point, Point][] {
  const shape = drawn.shape;
  const at = shapePoints(shape).map((point) => point.at);
  switch (shape.type) {
    case "segment":
    case "horizontal":
      return at.length === 2 ? [[at[0]!, at[1]!]] : [];
    case "polyline":
      return at.slice(1).map((b, i) => [at[i]!, b]);
    case "angle":
      return [
        [shape.vertex.at, shape.a.at],
        [shape.vertex.at, shape.b.at],
      ];
    default:
      return [];
  }
}

/**
 * The row drawn nearest to `p` within `tolerance` image pixels (its lines and its points), or
 * null. A 4-point angle draws no geometry of its own, so it is picked from the list.
 */
export function hitRow(
  rows: readonly MeasurementRow[],
  p: Point,
  tolerance: number,
  accept: (row: MeasurementRow) => boolean = () => true,
): number | null {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let best: { id: number; d: number } | null = null;
  for (const row of rows) {
    if (!accept(row)) continue;
    const drawn = drawRow(row, byId);
    const distances = [
      ...segmentsOf(drawn).map(([a, b]) => toSegment(p, a, b)),
      ...shapePoints(drawn.shape).map((point) => distance(p, point.at)),
    ];
    const d = Math.min(...distances);
    if (d <= tolerance && (best === null || d < best.d)) best = { id: row.id, d };
  }
  return best?.id ?? null;
}

/** Which of a row's points (in the input's order) is within `tolerance` of `p`, or null. */
export function hitPoint(row: MeasurementRow, p: Point, tolerance: number): number | null {
  const points = shapePoints(drawRow(row).shape);
  let best: { index: number; d: number } | null = null;
  points.forEach((point, index) => {
    const d = distance(p, point.at);
    if (d <= tolerance && (best === null || d < best.d)) best = { index, d };
  });
  return (best as { index: number } | null)?.index ?? null;
}
