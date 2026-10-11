/**
 * An on/off switch for settings that apply at once (layers, "show both languages"). The thumb
 * slides toward the inline end, so it moves right in English and left in Arabic.
 */
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { useId } from "react";
import { Bi, type BiText } from "./Bi";
import { cn } from "@/lib/cn";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: BiText;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onCheckedChange, label, disabled, className }: SwitchProps) {
  const id = `switch${useId()}`;
  return (
    <div className={cn("inline-flex min-h-8 items-center gap-2", className)}>
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          "inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border-control bg-surface-sunken p-0.5",
          "transition-colors duration-(--nz-duration-fast) data-[state=checked]:border-primary data-[state=checked]:bg-primary",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "block size-3.5 rounded-full bg-ink-secondary shadow-sm transition-transform duration-(--nz-duration-fast) ease-standard",
            "data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-fg rtl:data-[state=checked]:-translate-x-4",
          )}
        />
      </SwitchPrimitive.Root>
      <label htmlFor={id} className="cursor-pointer text-sm text-ink">
        <Bi {...label} />
      </label>
    </div>
  );
}
