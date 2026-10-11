/**
 * Two panes side by side with a draggable separator; the `start` pane sits at the inline start
 * (right in Arabic). The separator is a focusable `role="separator"`: Arrow keys move it toward the
 * arrow on screen (Shift = bigger steps), Home/End jump to the limits.
 */
import { useDirection } from "@radix-ui/react-direction";
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SplitPaneProps {
  start: ReactNode;
  end: ReactNode;
  /** initial width of the start pane in px */
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  /** accessible name of the separator, in the UI language */
  label: string;
  onSizeChange?: (size: number) => void;
  className?: string;
}

const STEP = 16;
const BIG_STEP = 64;

export function SplitPane({
  start,
  end,
  defaultSize = 360,
  minSize = 240,
  maxSize = 640,
  label,
  onSizeChange,
  className,
}: SplitPaneProps) {
  const dir = useDirection();
  const [size, setSize] = useState(defaultSize);
  const container = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const apply = (next: number) => {
    const clamped = Math.round(Math.min(maxSize, Math.max(minSize, next)));
    setSize(clamped);
    onSizeChange?.(clamped);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    // the start pane grows when the separator moves away from the inline start
    const grow = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const shrink = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    if (event.key === grow) apply(size + step);
    else if (event.key === shrink) apply(size - step);
    else if (event.key === "Home") apply(minSize);
    else if (event.key === "End") apply(maxSize);
    else return;
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || container.current === null) return;
    const rect = container.current.getBoundingClientRect();
    apply(dir === "rtl" ? rect.right - event.clientX : event.clientX - rect.left);
  };

  return (
    <div ref={container} className={cn("flex min-h-0 w-full", className)}>
      <div className="min-w-0 shrink-0 overflow-hidden" style={{ inlineSize: size }}>
        {start}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={size}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          dragging.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        className="group flex w-2 shrink-0 cursor-col-resize touch-none items-stretch justify-center"
      >
        <div className="w-px bg-border group-hover:w-0.5 group-hover:bg-primary group-focus-visible:w-0.5 group-focus-visible:bg-focus" />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">{end}</div>
    </div>
  );
}
