/**
 * Toolbars. `Toolbar` groups controls under one accessible name; `ToggleGroup` is a set of
 * exclusive choices (the measuring tools) with roving focus: Tab enters the group once, Arrow keys
 * move along it in the reading direction.
 */
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Toolbar({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolbarSeparator() {
  return <div role="separator" aria-orientation="vertical" className="mx-1 h-6 w-px bg-border" />;
}

export interface ToggleGroupProps<V extends string> {
  value: V | null;
  onValueChange: (value: V | null) => void;
  label: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function ToggleGroup<V extends string>({
  value,
  onValueChange,
  label,
  disabled,
  className,
  children,
}: ToggleGroupProps<V>) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value ?? ""}
      onValueChange={(next) => onValueChange(next === "" ? null : (next as V))}
      aria-label={label}
      disabled={disabled}
      className={cn("flex flex-wrap items-center gap-0.5", className)}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  );
}

export function ToggleGroupItem({
  value,
  label,
  className,
  children,
}: {
  value: string;
  /** accessible name in the UI language */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ToggleGroupPrimitive.Item
      value={value}
      aria-label={label}
      className={cn(
        "relative inline-flex min-h-9 min-w-9 items-center justify-center gap-1 rounded-md px-2 text-ink-secondary",
        "hover:bg-surface-hover hover:text-ink data-[state=on]:bg-primary-soft data-[state=on]:text-primary-text",
        "data-[state=on]:ring-1 data-[state=on]:ring-primary-border disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:size-4.5",
        className,
      )}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}
