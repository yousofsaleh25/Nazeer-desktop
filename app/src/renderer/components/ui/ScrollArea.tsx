/** A scroll container with themed scrollbars (Radix: native scrolling, keyboard and wheel). */
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  /** classes for the scrolled viewport (e.g. a max height) */
  viewportClassName?: string;
  /** accessible name when the region is focusable for keyboard scrolling */
  label?: string;
}

function Bar({ orientation }: { orientation: "vertical" | "horizontal" }) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      orientation={orientation}
      className={cn(
        "flex touch-none p-0.5 select-none",
        orientation === "vertical" ? "w-2.5" : "h-2.5 flex-col",
      )}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border-strong hover:bg-border-control" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export function ScrollArea({ children, className, viewportClassName, label }: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root type="hover" className={cn("relative overflow-hidden", className)}>
      <ScrollAreaPrimitive.Viewport
        aria-label={label}
        tabIndex={label ? 0 : undefined}
        className={cn("size-full rounded-[inherit]", viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <Bar orientation="vertical" />
      <Bar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
