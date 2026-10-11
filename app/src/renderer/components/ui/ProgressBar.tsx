/**
 * Progress of a long task (the frame walk). `value` is a fraction 0..1 from the engine, or null
 * when the total is unknown (an indeterminate bar, announced without a number). The bar fills from
 * the inline start: from the right in Arabic.
 */
import { cn } from "@/lib/cn";

export interface ProgressBarProps {
  value: number | null;
  /** accessible name in the UI language */
  label: string;
  tone?: "primary" | "success" | "warning" | "danger";
  className?: string;
}

const FILL = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

export function ProgressBar({ value, label, tone = "primary", className }: ProgressBarProps) {
  const fraction =
    value === null || !Number.isFinite(value) ? null : Math.min(1, Math.max(0, value));
  const percent = fraction === null ? null : Math.round(fraction * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-surface-sunken",
        className,
      )}
    >
      {fraction === null ? (
        <div
          className={cn("absolute inset-y-0 start-0 w-1/3 animate-pulse rounded-full", FILL[tone])}
        />
      ) : (
        <div
          className={cn(
            "absolute inset-y-0 start-0 rounded-full transition-[width] duration-(--nz-duration-base) ease-standard",
            FILL[tone],
          )}
          style={{ width: `${fraction * 100}%` }}
        />
      )}
    </div>
  );
}
