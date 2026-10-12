/**
 * The editing canvas with its input (C1, C3.4): MeasureCanvas plus the pointer, the keyboard
 * crosshair, zoom and pan, drawing the eight kinds, naming, and dragging a point of the selected
 * measurement. Pointer positions map to image pixels with `getScreenCTM().inverse()`.
 *
 * - A tool draws its kind only — nothing falls back from 3D to 2D. Distances take 2 clicks, 3-point
 *   angles 3 (vertex first), the angle from horizontal 2, curves 2 or more (a click on the last
 *   point, a double-click or Enter there finishes); a 4-point angle picks two line measurements.
 *   Shift (click or Enter) marks a ground point for the 3D kinds.
 * - A finished shape is named before it enters the draft; then it is previewed once more, so the
 *   list shows the engine's value until the autosave lands.
 * - Hover asks the engine for the depth under the crosshair; while drawing or dragging, the engine
 *   previews the measurement with the crosshair as its next point. Both go out at most once per
 *   animation frame; the store keeps one request in flight per channel.
 * - Keyboard (canvas focused): arrows move the crosshair 1 px (Shift: 10 px), Enter places a point
 *   (Shift+Enter: a ground point), Backspace removes the last one. Anywhere outside a text field,
 *   dialog or menu: 1–8 choose the kind, Esc cancels, Ctrl+Z / Ctrl+Y undo and redo, Delete
 *   removes the selected measurement, + / − / 0 zoom. The wheel zooms; the middle button or
 *   Space + drag pans.
 *
 * The drawing state (shape, picked lines, naming) belongs to the screen, which resets it when the
 * kind changes; the crosshair and a drag live here. The canvas is never an approval surface (D7).
 */
import { useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  INPUT_KINDS,
  type InputKind,
  type MeasurementInput,
  type MeasurementRow,
} from "@/api/types";
import {
  angleBetweenLines,
  angleFields,
  finishCurve,
  fitViewport,
  HIT_TOLERANCE_PX,
  hitPoint,
  hitRow,
  imagePoint,
  KEY_STEP_FAST_PX,
  KEY_STEP_PX,
  keepVisible,
  panBy,
  placePoint,
  previewInput,
  removeLastPoint,
  SAME_POINT_PX,
  shapeFields,
  targetFor,
  zoomAt,
  ZOOM_STEP,
  type Shape,
} from "@/components/domain/measure/interaction";
import {
  MeasureCanvas,
  type CanvasFrame,
  type Crosshair,
  type DraftShape,
  type Viewport,
} from "@/components/domain/measure/MeasureCanvas";
import type { CanvasLayers } from "@/components/domain/MeasureToolbar";
import { NamePrompt } from "@/components/domain/NamePrompt";
import { useLabel } from "@/components/domain/labels";
import { Bi } from "@/components/ui/Bi";
import { messagePair } from "@/i18n/t";
import { cn } from "@/lib/cn";
import type { Point } from "@/lib/read";
import { useAppDispatch, useAppSelector, useAppStore } from "@/store/hooks";
import { sameValue } from "@/store/session/document";
import {
  depthRequested,
  depthReset,
  measurementAdded,
  measurementChanged,
  measurementRemoved,
  previewRequested,
  previewReset,
  redone,
  selectionChanged,
  undone,
} from "@/store/slices/session";

/** What is being named: a finished shape, or two lines for a 4-point angle. */
export type Naming = { shape: Shape } | { kind: "angle_4point"; lines: [number, number] };

export function namingKind(naming: Naming): InputKind {
  return "shape" in naming ? naming.shape.kind : "angle_4point";
}

/** The screen's drawing state and its setters. */
export interface Drawing {
  shape: Shape | null;
  naming: Naming | null;
  picks: readonly number[];
  setShape: (shape: Shape | null) => void;
  setNaming: (naming: Naming | null) => void;
  setPicks: (picks: number[]) => void;
  /** pick or unpick a line for a 4-point angle; the second pick opens the naming */
  togglePick: (id: number) => void;
}

interface Drag {
  id: number;
  index: number;
  input: MeasurementInput;
  points: Point[];
  color: string;
}

export interface MeasureStageProps {
  frame: CanvasFrame;
  /** the engine's rows to draw (with the draft's name and colour) */
  rows: readonly MeasurementRow[];
  /** draft measurements the engine has not computed yet: drawn from their clicks */
  ghosts: readonly DraftShape[];
  /** the draft inputs by id (a dragged point edits one) */
  inputs: ReadonlyMap<number, MeasurementInput>;
  tool: InputKind | null;
  onTool: (tool: InputKind | null) => void;
  drawing: Drawing;
  editable: boolean;
  canAdd: boolean;
  selectedId: number | null;
  viewport: Viewport;
  onViewport: (update: (view: Viewport) => Viewport) => void;
  layers: CanvasLayers;
  /** accessible name of the canvas */
  label: string;
  /** id of the element describing the keyboard use */
  describedBy?: string;
}

/** At most this long between a pointer move and its probe when no frame is drawn. */
export const PROBE_FALLBACK_MS = 50;

/**
 * The next animation frame, or PROBE_FALLBACK_MS when none comes first: Chromium draws no frames
 * for a window covered by others, and a probe must not wait for the operator to uncover it.
 */
function requestFrame(callback: () => void): void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    callback();
  };
  window.setTimeout(once, PROBE_FALLBACK_MS);
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(once);
}

/** Keys typed into a field, a dialog or a menu are not canvas shortcuts. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    ) !== null
  );
}

const isLine = (row: MeasurementRow) => row.family === "lines";

/** A 3-point angle is clicked vertex first and drawn ray – vertex – ray. */
function strokeOrder(kind: InputKind, points: readonly Point[]): Point[] {
  if ((kind === "angle_2d_3point" || kind === "angle_3d_3point") && points.length >= 2) {
    return [points[1]!, points[0]!, ...points.slice(2)];
  }
  return [...points];
}

interface ProbeState {
  cursor: Crosshair | null;
  shape: Shape | null;
  drag: Drag | null;
  picks: readonly number[];
}

export function MeasureStage({
  frame,
  rows,
  ghosts,
  inputs,
  tool,
  onTool,
  drawing,
  editable,
  canAdd,
  selectedId,
  viewport,
  onViewport,
  layers,
  label,
  describedBy,
}: MeasureStageProps) {
  const { shape, naming, picks, setShape, setNaming, setPicks } = drawing;
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const preview = useAppSelector((state) => state.session.preview.result);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursor, setCursor] = useState<Crosshair | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const pan = useRef<{ x: number; y: number; view: Viewport } | null>(null);
  const spaceHeld = useRef(false);
  const suppressClick = useRef(false);
  const kindLabel = useLabel("input_kinds", naming ? namingKind(naming) : tool);
  const busy = shape !== null || picks.length > 0 || naming !== null || drag !== null;

  // ----- probes: hover depth and the live preview, at most once per animation frame -----
  const probe = useRef<ProbeState | null>(null);
  const scheduled = useRef(false);
  const lastPreview = useRef<MeasurementInput | null>(null);

  const sendProbes = useEffectEvent(() => {
    scheduled.current = false;
    const state = probe.current;
    if (state === null) return;
    const { cursor: c, shape: s, drag: d, picks: p } = state;
    if (c !== null && d === null) {
      dispatch(depthRequested({ u: c.at[0], v: c.at[1], target: c.target }));
    }
    const nextId = store.getState().session.nextMeasurementId;
    let input: MeasurementInput | null;
    if (d !== null) input = { ...d.input, points: d.points.map(([u, v]) => [u, v]) };
    else if (p.length === 2) input = angleBetweenLines(nextId, "", p[0]!, p[1]!);
    else input = previewInput(s, c, nextId);
    if (input !== null && !sameValue(input, lastPreview.current)) {
      lastPreview.current = input;
      dispatch(previewRequested({ measurement: input }));
    }
  });

  useEffect(() => {
    probe.current = { cursor, shape, drag, picks };
    if (scheduled.current || (cursor === null && drag === null && picks.length < 2)) return;
    scheduled.current = true;
    requestFrame(() => sendProbes());
  }, [cursor, shape, drag, picks]);

  const resetPreview = () => {
    lastPreview.current = null;
    dispatch(previewReset());
  };

  // ----- coordinates -----
  const toImage = (clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM?.();
    if (!svg || !matrix) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return imagePoint([p.x, p.y], frame);
  };
  const unitsPerPx = (): number => {
    const width = svgRef.current?.getBoundingClientRect().width ?? 0;
    return width > 0 ? viewport.width / width : 1;
  };

  // ----- placing points and naming -----
  const place = (at: Point, shift: boolean, samePx: number) => {
    if (tool === null || !editable || !canAdd || naming !== null) return;
    if (tool === "angle_4point") {
      const id = hitRow(rows, at, HIT_TOLERANCE_PX * unitsPerPx(), isLine);
      if (id !== null) drawing.togglePick(id);
      return;
    }
    const placed = placePoint(shape, tool, at, targetFor(tool, shift), samePx);
    if (placed.complete) {
      setShape(null);
      setNaming({ shape: placed.shape });
    } else {
      setShape(placed.shape);
    }
  };

  const commit = (name: string) => {
    if (naming === null) return;
    const id = store.getState().session.nextMeasurementId;
    const fields =
      "shape" in naming
        ? shapeFields(naming.shape, name)
        : angleFields(name, naming.lines[0], naming.lines[1]);
    dispatch(measurementAdded(fields));
    resetPreview();
    // the engine's value shows at once (the list's "preview"), until the autosave lands
    dispatch(previewRequested({ measurement: { id, ...fields } }));
    setNaming(null);
    containerRef.current?.focus();
  };

  const cancelDrawing = () => {
    setShape(null);
    setNaming(null);
    setPicks([]);
    resetPreview();
  };

  // ----- dragging a point of the selected measurement -----
  const endDrag = (keep: boolean) => {
    setDrag(null);
    if (drag === null) return;
    const points = drag.points.map(([u, v]) => [u, v] as [number, number]);
    resetPreview();
    if (keep && !sameValue(points, drag.input.points ?? [])) {
      dispatch(measurementChanged({ id: drag.id, changes: { points } }));
      dispatch(previewRequested({ measurement: { ...drag.input, points } }));
    }
  };

  // ----- pointer -----
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button === 1 || (event.button === 0 && spaceHeld.current)) {
      event.preventDefault();
      pan.current = { x: event.clientX, y: event.clientY, view: viewport };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    if (event.button !== 0 || tool !== null || !editable || selectedId === null) return;
    const at = toImage(event.clientX, event.clientY);
    const row = rows.find((r) => r.id === selectedId);
    const input = inputs.get(selectedId);
    if (at === null || row === undefined || input === undefined) return;
    const index = hitPoint(row, at, HIT_TOLERANCE_PX * unitsPerPx());
    const points = (input.points ?? []).map(([u, v]) => [u, v] as Point);
    if (index === null || index >= points.length) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ id: selectedId, index, input, points, color: row.display_color });
    dispatch(depthReset());
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = pan.current;
    if (start !== null) {
      const k = unitsPerPx();
      onViewport(() =>
        panBy(start.view, frame, -(event.clientX - start.x) * k, -(event.clientY - start.y) * k),
      );
      return;
    }
    const at = toImage(event.clientX, event.clientY);
    if (at === null) return;
    if (drag !== null) {
      setDrag({ ...drag, points: drag.points.map((p, i) => (i === drag.index ? at : p)) });
      suppressClick.current = true;
    }
    setCursor({ at, target: targetFor(tool, event.shiftKey) });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current !== null) {
      pan.current = null;
      suppressClick.current = true;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } else if (drag !== null) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      endDrag(true);
    }
  };

  const onPointerLeave = () => {
    if (pan.current !== null || drag !== null) return;
    setCursor(null);
    dispatch(depthReset());
    if (shape === null && picks.length < 2 && naming === null) resetPreview();
  };

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (event.button !== 0 || naming !== null) return;
    const at = toImage(event.clientX, event.clientY);
    if (at === null) return;
    if (tool === null)
      dispatch(selectionChanged(hitRow(rows, at, HIT_TOLERANCE_PX * unitsPerPx())));
    else place(at, event.shiftKey, SAME_POINT_PX * unitsPerPx());
  };

  const onDoubleClick = () => {
    const finished = finishCurve(shape);
    if (finished !== null) {
      setShape(null);
      setNaming({ shape: finished });
    }
  };

  // wheel: zoom around the pointer (a non-passive listener, so the page does not scroll)
  const onWheel = useEffectEvent((event: WheelEvent) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM?.();
    if (!svg || !matrix) return;
    event.preventDefault();
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    onViewport((view) => zoomAt(view, frame, factor, [p.x, p.y]));
  });
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const listener = (event: WheelEvent) => onWheel(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, []);

  // ----- keyboard -----
  const onCanvasKey = (event: KeyboardEvent): boolean => {
    const steps: Record<string, Point> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = steps[event.key];
    if (step !== undefined) {
      const size = event.shiftKey ? KEY_STEP_FAST_PX : KEY_STEP_PX;
      const from: Point = cursor?.at ?? [
        Math.round(viewport.x + viewport.width / 2),
        Math.round(viewport.y + viewport.height / 2),
      ];
      const at = imagePoint([from[0] + step[0] * size, from[1] + step[1] * size], frame);
      setCursor({ at, target: targetFor(tool, false) });
      onViewport((view) => keepVisible(view, frame, at, 24 * unitsPerPx()));
      return true;
    }
    if (event.key === "Enter") {
      if (naming !== null) return false;
      if (cursor === null) {
        // the first Enter shows the crosshair (in the middle of the view); the next one places
        const at = imagePoint(
          [viewport.x + viewport.width / 2, viewport.y + viewport.height / 2],
          frame,
        );
        setCursor({ at: [Math.round(at[0]), Math.round(at[1])], target: targetFor(tool, false) });
        return true;
      }
      if (tool === null) {
        dispatch(selectionChanged(hitRow(rows, cursor.at, HIT_TOLERANCE_PX * unitsPerPx())));
      } else {
        setCursor({ at: cursor.at, target: targetFor(tool, event.shiftKey) });
        place(cursor.at, event.shiftKey, 0);
      }
      return true;
    }
    if (event.key === "Backspace" && shape !== null) {
      setShape(removeLastPoint(shape));
      resetPreview();
      return true;
    }
    return false;
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === " " && event.target === containerRef.current) {
      spaceHeld.current = event.type === "keydown";
      event.preventDefault();
      return;
    }
    if (event.type !== "keydown" || event.defaultPrevented || typing(event.target)) return;
    if (event.target === containerRef.current && onCanvasKey(event)) {
      event.preventDefault();
      return;
    }
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (ctrl && (key === "z" || key === "y")) {
      event.preventDefault();
      if (key === "z" && !event.shiftKey && shape !== null) {
        setShape(removeLastPoint(shape));
        resetPreview();
      } else if (editable && !busy) {
        dispatch(key === "y" || event.shiftKey ? redone() : undone());
      }
      return;
    }
    if (ctrl || event.altKey) return;
    if (/^[1-8]$/.test(event.key)) {
      if (!editable) return;
      event.preventDefault();
      onTool(INPUT_KINDS[Number(event.key) - 1] ?? null);
      return;
    }
    if (event.key === "Escape") {
      if (drag !== null) endDrag(false);
      else if (shape !== null || picks.length > 0 || naming !== null) cancelDrawing();
      else if (tool !== null) onTool(null);
      else if (selectedId !== null) dispatch(selectionChanged(null));
      else return;
      event.preventDefault();
      return;
    }
    if (event.key === "Delete" && editable && !busy && selectedId !== null) {
      event.preventDefault();
      dispatch(measurementRemoved(selectedId));
      return;
    }
    const anchor: Point = cursor?.at ?? [
      viewport.x + viewport.width / 2,
      viewport.y + viewport.height / 2,
    ];
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      onViewport((view) => zoomAt(view, frame, ZOOM_STEP, anchor));
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      onViewport((view) => zoomAt(view, frame, 1 / ZOOM_STEP, anchor));
    } else if (event.key === "0") {
      event.preventDefault();
      onViewport(() => fitViewport(frame));
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    window.addEventListener("keyup", listener);
    return () => {
      window.removeEventListener("keydown", listener);
      window.removeEventListener("keyup", listener);
    };
  }, []);

  // ----- what the canvas draws -----
  const draft: DraftShape | null = useMemo(() => {
    if (drag !== null) {
      return {
        kind: drag.input.kind,
        points: strokeOrder(drag.input.kind, drag.points),
        targets: drag.input.targets ?? [],
        color: drag.color,
      };
    }
    const shown = naming !== null && "shape" in naming ? naming.shape : shape;
    if (shown === null) return null;
    return {
      kind: shown.kind,
      points: strokeOrder(shown.kind, shown.points),
      targets: shown.targets,
    };
  }, [drag, naming, shape]);
  const hidden = useMemo(() => new Set(drag === null ? [] : [drag.id]), [drag]);
  const highlighted = useMemo(
    () => new Set(naming !== null && !("shape" in naming) ? naming.lines : picks),
    [naming, picks],
  );
  const previewing =
    preview !== null &&
    (drag !== null || naming !== null || picks.length === 2 || (shape?.points.length ?? 0) > 0);
  const note = !previewing ? null : preview.presentation.rejected ? (
    <Bi {...messagePair("measure.rejected")} />
  ) : (
    <Bi ar={preview.presentation.value_text.ar} en={preview.presentation.value_text.en} />
  );
  const kind = naming === null ? null : namingKind(naming);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label={label}
        aria-describedby={describedBy}
        data-tool={tool ?? "none"}
        data-drawing={busy || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className={cn(
          "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          drag !== null ? "cursor-grabbing" : tool !== null && editable ? "cursor-crosshair" : "",
        )}
      >
        <MeasureCanvas
          frame={frame}
          rows={rows}
          label={label}
          selectedId={selectedId}
          highlightIds={highlighted}
          hiddenIds={hidden}
          ghosts={ghosts}
          draft={draft}
          crosshair={naming === null ? cursor : null}
          cursorNote={note}
          viewport={viewport}
          layers={layers}
          svgRef={svgRef}
        />
      </div>
      {kind !== null ? (
        <div
          data-naming={kind}
          className="absolute end-3 top-3 z-(--nz-z-dropdown) rounded-lg border border-border bg-surface-raised p-3 shadow-lg"
        >
          <NamePrompt
            kindLabel={kindLabel ?? { ar: kind, en: kind }}
            onSubmit={commit}
            onCancel={() => {
              cancelDrawing();
              containerRef.current?.focus();
            }}
          />
          {note ? <p className="mt-2 text-sm text-ink-secondary">{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
