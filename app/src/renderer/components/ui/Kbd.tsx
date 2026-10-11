/** A keyboard key or shortcut, always left to right ("Ctrl+Z", "Shift", "1"). */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      dir="ltr"
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-xs border border-border-strong border-b-2 bg-surface-sunken px-1 font-mono text-[0.72rem] leading-4 text-ink-secondary",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
