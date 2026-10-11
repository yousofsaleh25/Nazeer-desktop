/**
 * A single-choice dropdown (Radix Select: keyboard, typeahead, direction from DirectionProvider).
 * Options carry bilingual labels; inside a Field it takes the field's id and description.
 */
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { Bi, type BiText } from "./Bi";
import { useField } from "./Field";
import { cn } from "@/lib/cn";

export interface SelectOption<V extends string = string> {
  value: V;
  label: BiText;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  value: V | undefined;
  onValueChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  placeholder?: BiText;
  /** accessible name when the select is not inside a Field */
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function Select<V extends string = string>({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  id,
  ...aria
}: SelectProps<V>) {
  const field = useField();
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(next) => onValueChange(next as V)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id ?? field?.id}
        aria-label={aria["aria-label"]}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        className={cn(
          "inline-flex min-h-8 w-full items-center justify-between gap-2 rounded-sm border border-border-control bg-surface-raised px-2.5 py-1 text-start text-sm text-ink",
          "data-placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder ? <Bi {...placeholder} /> : undefined} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-secondary" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-(--nz-z-dropdown) max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-md border border-border-strong bg-surface-raised text-ink shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex min-h-8 cursor-default items-center gap-2 rounded-sm py-1 ps-7 pe-2 text-sm outline-none select-none data-disabled:opacity-50 data-highlighted:bg-surface-hover"
              >
                <SelectPrimitive.ItemIndicator className="absolute start-2 inline-flex">
                  <Check aria-hidden="true" className="size-3.5" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>
                  <Bi {...option.label} />
                </SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
