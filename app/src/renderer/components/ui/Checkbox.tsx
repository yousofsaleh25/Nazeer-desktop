/**
 * A labelled checkbox (Radix: keyboard, indeterminate state, direction-aware layout). `hideLabel`
 * keeps the label for assistive technology only (a table's selection column).
 */
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { useId } from "react";
import { Bi, type BiText } from "./Bi";
import { cn } from "@/lib/cn";

export interface CheckboxProps {
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  label: BiText;
  disabled?: boolean;
  hideLabel?: boolean;
  className?: string;
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled,
  hideLabel = false,
  className,
}: CheckboxProps) {
  const id = `checkbox${useId()}`;
  return (
    <div className={cn("inline-flex min-h-8 items-center gap-2", className)}>
      <CheckboxPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        disabled={disabled}
        className={cn(
          "inline-flex size-4.5 shrink-0 items-center justify-center rounded-xs border border-border-control bg-surface-raised text-primary-fg",
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
          "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <CheckboxPrimitive.Indicator>
          {checked === "indeterminate" ? (
            <Minus aria-hidden="true" className="size-3.5" />
          ) : (
            <Check aria-hidden="true" className="size-3.5" />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "cursor-pointer text-sm text-ink"}>
        <Bi {...label} />
      </label>
    </div>
  );
}
