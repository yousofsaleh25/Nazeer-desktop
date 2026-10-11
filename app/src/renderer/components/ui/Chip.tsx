/**
 * Tone-coloured labels. `Chip` (pill) for flags and states attached to something; `Badge`
 * (rectangle) for categories such as a frame's bucket. Tones come from design/index.ts
 * (TONE_CLASSES): text + tint + border, every pair AA in both themes.
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { TONE_CLASSES, type Tone } from "@/design";
import { cn } from "@/lib/cn";

export interface ChipProps {
  tone?: Tone;
  icon?: LucideIcon;
  size?: "sm" | "md";
  /** a tooltip-like hint (title attribute) in the UI language */
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Chip({
  tone = "neutral",
  icon: Icon,
  size = "sm",
  title,
  className,
  children,
}: ChipProps) {
  return (
    <span
      title={title}
      data-tone={tone}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border font-medium",
        size === "sm" ? "min-h-6 px-2 py-0.5 text-xs" : "min-h-7 px-2.5 py-0.5 text-sm",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      <span className="min-w-0">{children}</span>
    </span>
  );
}

export function Badge({
  tone = "neutral",
  icon: Icon,
  title,
  className,
  children,
}: Omit<ChipProps, "size">) {
  return (
    <span
      title={title}
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-semibold",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      {children}
    </span>
  );
}
