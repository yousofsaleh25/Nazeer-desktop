/**
 * Overlay pickers: DropdownMenu (row actions such as rename / delete) and Popover (a small form
 * anchored to something, such as the name prompt at a canvas point). Both follow the reading
 * direction and return focus to their trigger.
 */
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const surface =
  "z-(--nz-z-dropdown) min-w-44 rounded-md border border-border-strong bg-surface-raised p-1 text-ink shadow-lg";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  align = "end",
  ...props
}: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={4}
        collisionPadding={8}
        className={cn(surface, className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  icon: Icon,
  tone = "neutral",
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Item> & {
  icon?: LucideIcon;
  tone?: "neutral" | "danger";
  children: ReactNode;
}) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex min-h-8 cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-none select-none",
        "data-disabled:opacity-50 data-highlighted:bg-surface-hover",
        tone === "danger" && "text-danger-text",
        className,
      )}
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
      {children}
    </DropdownPrimitive.Item>
  );
}

export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-border" />;
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(surface, "p-3", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
