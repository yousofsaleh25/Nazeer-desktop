/**
 * The editing canvas (render only; Stage 6 adds the pointer and keyboard input). One SVG in image
 * coordinates holds the frame (`<image>`), the mask tint, the depth-valid box, the ground line,
 * every computed row and the in-progress clicks, so zoom and pan are only the `viewport` (the
 * viewBox) and a pointer maps to image pixels with `getScreenCTM().inverse()`. Strokes and
 * markers keep their size on screen at any zoom; labels are HTML on top (proper bidi isolation),
 * positioned in percent of the viewport and moved apart like the overlay's (placeLabels). The
 * canvas is image space: always left to right.
 *
 * It is never an approval surface: the operator approves the engine's overlay PNG (D7).
 */
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import type { InputKind, MeasurementRow, Target } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { CANVAS_STYLE, OVERLAY_STYLE } from "@/design";
import { messagePair } from "@/i18n/t";
import { cn } from "@/lib/cn";
import type { Point } from "@/lib/read";
import type { CanvasLayers } from "../MeasureToolbar";
import { drawRow, placeLabels, type DrawnPoint, type DrawnRow, type GroundLine } from "./geometry";

/** The visible part of the frame in image pixels (same aspect ratio as the frame). */
export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasFrame {
  width: number;
  height: number;
  imageUrl: string;
  maskUrl?: string | null;
  ground?: GroundLine | null;
  depthBox?: readonly [number, number, number, number] | null;
}

/** Clicks of the measurement being drawn (no values yet: the engine computes them). */
export interface DraftShape {
  kind: InputKind;
  points: readonly Point[];
  targets: readonly Target[];
  color?: string;
}

export interface Crosshair {
  at: Point;
  target: Target;
}

export interface MeasureCanvasProps {
  frame: CanvasFrame;
  rows: readonly MeasurementRow[];
  /** accessible name of the canvas, in the UI language */
  label: string;
  selectedId?: number | null;
  hiddenIds?: ReadonlySet<number>;
  draft?: DraftShape | null;
  crosshair?: Crosshair | null;
  viewport?: Viewport;
  layers?: CanvasLayers;
  svgRef?: Ref<SVGSVGElement>;
  onImageError?: () => void;
  className?: string;
}

/** Markers are drawn at the overlay's sizes × this, in screen pixels. */
const MARKER_SCALE = 1.3;
const LINE_PX = 2.5;
const JUMP_PX = 4.5;
const HALO_PX = 7;

/** Image units per screen pixel of the SVG (1 until the element has been measured). */
function useUnitsPerPixel(element: SVGSVGElement | null, viewWidth: number): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (element === null) return;
    // a ResizeObserver reports the initial size too
    const observer = new ResizeObserver(() => setWidth(element.getBoundingClientRect().width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width > 0 ? viewWidth / width : 1;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function Marker({ point, color, k }: { point: DrawnPoint; color: string; k: number }) {
  const s = OVERLAY_STYLE;
  const [x, y] = point.at;
  const ground = point.target === "ground";
  if (point.marker === "rejected") {
    const h = s.rejectedHalf * k;
    return (
      <path
        data-marker="rejected"
        d={`M ${x - h} ${y - h} L ${x + h} ${y + h} M ${x + h} ${y - h} L ${x - h} ${y + h}`}
        stroke={s.rejectedColor}
        strokeWidth={s.rejectedStroke}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (point.marker === "knn") {
    const r = s.knnRadius * k;
    const ring = {
      fill: "none",
      stroke: color,
      strokeWidth: s.markerStroke,
      vectorEffect: "non-scaling-stroke",
    } as const;
    return (
      <g data-marker="knn" data-target={point.target}>
        {point.centroid ? (
          <>
            <line
              x1={x}
              y1={y}
              x2={point.centroid[0]}
              y2={point.centroid[1]}
              stroke={color}
              strokeWidth={s.leaderWidth}
              strokeDasharray={s.leaderDash}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={point.centroid[0]}
              cy={point.centroid[1]}
              r={s.centroidRadius * k}
              fill={color}
            />
          </>
        ) : null}
        {ground ? (
          <rect x={x - r} y={y - r} width={2 * r} height={2 * r} {...ring} />
        ) : (
          <circle cx={x} cy={y} r={r} {...ring} />
        )}
      </g>
    );
  }
  const r = s.directRadius * k;
  const fill = {
    fill: color,
    stroke: CANVAS_STYLE.markerEdge,
    strokeWidth: s.directEdge,
    vectorEffect: "non-scaling-stroke",
  } as const;
  return ground ? (
    <rect
      data-marker="direct"
      data-target="ground"
      x={x - 1.15 * r}
      y={y - 1.15 * r}
      width={2.3 * r}
      height={2.3 * r}
      {...fill}
    />
  ) : (
    <circle data-marker="direct" data-target="camel" cx={x} cy={y} r={r} {...fill} />
  );
}

const pathOf = (points: readonly Point[]) =>
  points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");

function Stroke({
  d,
  color,
  width = LINE_PX,
  dash = "none",
}: {
  d: string;
  color: string;
  width?: number;
  dash?: "none" | "dashed" | "dotted";
}) {
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeDasharray={dash === "dashed" ? "7 5" : dash === "dotted" ? "1.5 4" : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

function pointsOf(drawn: DrawnRow): DrawnPoint[] {
  const shape = drawn.shape;
  switch (shape.type) {
    case "segment":
      return [shape.a, shape.b];
    case "polyline":
      return shape.points;
    case "angle":
      return [shape.a, shape.vertex, shape.b];
    case "horizontal":
      return [shape.a, shape.b];
    default:
      return [];
  }
}

function RowDrawing({ drawn, selected, k }: { drawn: DrawnRow; selected: boolean; k: number }) {
  const { shape, color, rejected } = drawn;
  const points = pointsOf(drawn);
  const main = points.length > 1 ? pathOf(points.map((p) => p.at)) : "";
  const arc =
    shape.type === "angle" ? shape.arc.path : shape.type === "horizontal" ? shape.arc?.path : null;
  return (
    <g data-row={drawn.id} data-shape={shape.type} data-rejected={rejected || undefined}>
      {selected && main ? <Stroke d={main} color={CANVAS_STYLE.halo} width={HALO_PX} /> : null}
      {main ? (
        <Stroke
          d={main}
          color={color}
          dash={rejected || shape.type === "horizontal" ? "dashed" : "none"}
        />
      ) : null}
      {shape.type === "polyline"
        ? shape.flagged.map((i) => {
            const a = shape.points[i];
            const b = shape.points[i + 1];
            return a && b ? (
              <g key={i} data-flagged-segment={i}>
                <Stroke d={pathOf([a.at, b.at])} color={OVERLAY_STYLE.jumpColor} width={JUMP_PX} />
              </g>
            ) : null;
          })
        : null}
      {shape.type === "horizontal" ? (
        <Stroke d={pathOf([shape.a.at, shape.ref])} color={color} width={1.5} dash="dotted" />
      ) : null}
      {arc ? <Stroke d={arc} color={color} width={2} /> : null}
      {points.map((point, i) => (
        <Marker key={i} point={point} color={color} k={k} />
      ))}
    </g>
  );
}

function DraftDrawing({
  draft,
  crosshair,
  k,
}: {
  draft: DraftShape;
  crosshair: Crosshair | null;
  k: number;
}) {
  const color = draft.color ?? CANVAS_STYLE.draft;
  const points = crosshair ? [...draft.points, crosshair.at] : draft.points;
  return (
    <g data-draft={draft.kind}>
      {points.length > 1 ? (
        <>
          <Stroke d={pathOf(points)} color={CANVAS_STYLE.draftShadow} width={LINE_PX + 2} />
          <Stroke d={pathOf(points)} color={color} dash="dashed" />
        </>
      ) : null}
      {draft.points.map((at, i) => (
        <Marker
          key={i}
          point={{ at, marker: "direct", centroid: null, target: draft.targets[i] ?? "camel" }}
          color={color}
          k={k}
        />
      ))}
    </g>
  );
}

function CrosshairDrawing({
  crosshair,
  view,
  k,
}: {
  crosshair: Crosshair;
  view: Viewport;
  k: number;
}) {
  const [x, y] = crosshair.at;
  const gap = 6 * k;
  const arms = [
    pathOf([
      [view.x, y],
      [x - gap, y],
    ]),
    pathOf([
      [x + gap, y],
      [view.x + view.width, y],
    ]),
    pathOf([
      [x, view.y],
      [x, y - gap],
    ]),
    pathOf([
      [x, y + gap],
      [x, view.y + view.height],
    ]),
  ].join(" ");
  return (
    <g data-crosshair={crosshair.target} pointerEvents="none">
      <Stroke d={arms} color={CANVAS_STYLE.crosshairShadow} width={3} />
      <Stroke d={arms} color={CANVAS_STYLE.crosshair} width={1} />
      {crosshair.target === "ground" ? (
        <rect
          x={x - gap}
          y={y - gap}
          width={2 * gap}
          height={2 * gap}
          fill="none"
          stroke={CANVAS_STYLE.crosshair}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </g>
  );
}

function RowLabel({ row, drawn, view }: { row: MeasurementRow; drawn: DrawnRow; view: Viewport }) {
  if (drawn.anchor === null) return null;
  const x = ((drawn.anchor[0] - view.x) / view.width) * 100;
  const y = ((drawn.anchor[1] - view.y) / view.height) * 100;
  if (x < -10 || x > 110 || y < -10 || y > 110) return null;
  const p = row.presentation;
  // image space: positioned from the frame's top-left corner in both languages; the vertical
  // shift that keeps labels apart is applied by MeasureCanvas after layout
  const position = {
    left: `${x}%`,
    top: `${y}%`,
    translate: "-50% -50%",
    borderColor: drawn.color,
  };
  return (
    <div
      data-label={row.id}
      className="absolute flex max-w-56 flex-col items-center rounded-sm border-[1.5px] bg-white/75 px-1.5 py-0.5 text-center text-[0.72rem] leading-tight font-medium text-black shadow-sm"
      style={position}
    >
      <bdi dir="auto" className="max-w-full truncate">
        {row.name || `#${row.id}`}
      </bdi>
      {p.rejected ? (
        <Bi {...messagePair("measure.rejected")} />
      ) : (
        <Bi ar={p.value_text.ar} en={p.value_text.en} />
      )}
    </div>
  );
}

export function MeasureCanvas({
  frame,
  rows,
  label,
  selectedId = null,
  hiddenIds,
  draft = null,
  crosshair = null,
  viewport,
  layers = { mask: false, depthBox: false, labels: true },
  svgRef,
  onImageError,
  className,
}: MeasureCanvasProps) {
  const maskId = `mask${useId()}`;
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const view = viewport ?? { x: 0, y: 0, width: frame.width, height: frame.height };
  const k = useUnitsPerPixel(svg, view.width) * MARKER_SCALE;

  const setRef = useCallback(
    (element: SVGSVGElement | null) => {
      setSvg(element);
      assignRef(svgRef, element);
    },
    [svgRef],
  );

  const drawn = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return rows
      .filter((row) => !hiddenIds?.has(row.id))
      .map((row) => ({ row, drawn: drawRow(row, byId) }));
  }, [rows, hiddenIds]);

  // move overlapping labels apart after every layout (cheap: one rect per label)
  const labelLayer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const layer = labelLayer.current;
    if (layer === null) return;
    const elements = [...layer.querySelectorAll<HTMLElement>("[data-label]")];
    const boxes = elements.map((element) => {
      const shift = Number(element.dataset["shift"] ?? "0");
      const rect = element.getBoundingClientRect();
      const id = Number(element.dataset["label"]);
      return { id, x0: rect.left, y0: rect.top - shift, x1: rect.right, y1: rect.bottom - shift };
    });
    const frame = layer.getBoundingClientRect();
    const shifts = placeLabels(boxes, selectedId, { top: frame.top, bottom: frame.bottom });
    for (const element of elements) {
      const shift = shifts.get(Number(element.dataset["label"])) ?? 0;
      element.dataset["shift"] = String(shift);
      element.style.translate = `-50% calc(-50% + ${shift}px)`;
    }
  });

  const ground = frame.ground ?? null;
  const box = frame.depthBox ?? null;
  const { width: w, height: h } = frame;

  return (
    <div
      dir="ltr"
      className={cn("relative w-full overflow-hidden rounded-md bg-black select-none", className)}
      style={{ aspectRatio: `${w} / ${h}` }}
    >
      <svg
        ref={setRef}
        role="img"
        aria-label={label}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
      >
        <image
          href={frame.imageUrl}
          x={0}
          y={0}
          width={w}
          height={h}
          preserveAspectRatio="none"
          onError={onImageError}
        />
        {layers.mask && frame.maskUrl ? (
          <g data-layer="mask">
            <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
              <image
                href={frame.maskUrl}
                x={0}
                y={0}
                width={w}
                height={h}
                preserveAspectRatio="none"
              />
            </mask>
            <rect
              x={0}
              y={0}
              width={w}
              height={h}
              fill={CANVAS_STYLE.maskTint}
              fillOpacity={CANVAS_STYLE.maskOpacity}
              mask={`url(#${maskId})`}
            />
          </g>
        ) : null}
        {layers.depthBox && box ? (
          <g data-layer="depth-box">
            <path
              d={`M 0 0 H ${w} V ${h} H 0 Z M ${box[0]} ${box[1]} V ${box[3]} H ${box[2]} V ${box[1]} Z`}
              fill={CANVAS_STYLE.depthShade}
              fillRule="evenodd"
            />
            <rect
              x={box[0]}
              y={box[1]}
              width={box[2] - box[0]}
              height={box[3] - box[1]}
              fill="none"
              stroke={CANVAS_STYLE.depthBoxStroke}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null}
        {ground ? (
          <g data-layer="ground">
            {ground.rawRow !== null ? (
              <Stroke
                d={pathOf([
                  [ground.x0, ground.rawRow],
                  [ground.x1, ground.rawRow],
                ])}
                color={OVERLAY_STYLE.groundColor}
                width={1.5}
                dash="dashed"
              />
            ) : null}
            <Stroke
              d={pathOf([
                [ground.x0, ground.row],
                [ground.x1, ground.row],
              ])}
              color={OVERLAY_STYLE.groundColor}
              width={OVERLAY_STYLE.groundLineWidth}
            />
          </g>
        ) : null}
        <g data-layer="rows">
          {drawn.map(({ row, drawn: d }) => (
            <RowDrawing key={row.id} drawn={d} selected={row.id === selectedId} k={k} />
          ))}
        </g>
        {draft ? <DraftDrawing draft={draft} crosshair={crosshair} k={k} /> : null}
        {crosshair ? <CrosshairDrawing crosshair={crosshair} view={view} k={k} /> : null}
      </svg>
      {layers.labels ? (
        <div ref={labelLayer} aria-hidden="true" className="pointer-events-none absolute inset-0">
          {drawn.map(({ row, drawn: d }) => (
            <RowLabel key={row.id} row={row} drawn={d} view={view} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
