/**
 * A single-value slider (Radix: arrow keys, Home/End, Page keys; the track runs from the inline
 * start, so it fills from the right in Arabic). The current value is shown next to it.
 */
import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** accessible name in the UI language */
  label: string;
  /** visible value text (e.g. <Num value={…} unit="%" />) */
  valueText?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Slider({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  label,
  valueText,
  disabled,
  className,
}: SliderProps) {
  return (
    <div className={cn("flex min-h-8 items-center gap-3", className)}>
      <SliderPrimitive.Root
        value={[value]}
        onValueChange={([next]) => {
          if (next !== undefined) onValueChange(next);
        }}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="relative flex h-5 w-full touch-none items-center select-none data-disabled:opacity-50"
      >
        <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-sunken">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label={label}
          className="block size-4 rounded-full border-2 border-primary bg-surface-raised shadow-sm"
        />
      </SliderPrimitive.Root>
      {valueText !== undefined ? (
        <span className="min-w-12 text-end text-sm text-ink-secondary">{valueText}</span>
      ) : null}
    </div>
  );
}
