/** Surfaces: Card (a bordered panel with an optional header) and Skeleton (a loading block). */
import type { HTMLAttributes, ReactNode } from "react";
import { Bi, type BiText } from "./Bi";
import { cn } from "@/lib/cn";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: BiText;
  /** controls at the header's inline end */
  actions?: ReactNode;
  /** heading level of the title */
  level?: 2 | 3 | 4;
  padded?: boolean;
}

export function Card({
  title,
  actions,
  level = 3,
  padded = true,
  className,
  children,
  ...props
}: CardProps) {
  const Heading = `h${level}` as const;
  return (
    <section
      className={cn(
        "flex flex-col rounded-lg border border-border bg-surface shadow-sm",
        className,
      )}
      {...props}
    >
      {title !== undefined || actions !== undefined ? (
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          {title !== undefined ? (
            <Heading className="min-w-0 flex-1 text-base font-semibold">
              <Bi {...title} />
            </Heading>
          ) : (
            <span className="flex-1" />
          )}
          {actions}
        </header>
      ) : null}
      <div className={cn("flex min-h-0 flex-1 flex-col", padded && "gap-3 p-4")}>{children}</div>
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none",
        className,
      )}
    />
  );
}
