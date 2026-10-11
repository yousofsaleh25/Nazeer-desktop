/**
 * Data tables. Text columns align to the inline start; `numeric` cells align to the inline end
 * with tabular digits (wrap the number itself in <Num>, which keeps it left to right).
 */
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-md border border-border">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-surface-sunken text-ink-secondary", className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-border bg-surface", className)} {...props} />;
}

export function TableRow({
  className,
  selected,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      aria-selected={selected}
      className={cn("hover:bg-surface-hover aria-selected:bg-primary-soft", className)}
      {...props}
    />
  );
}

export function TableHeaderCell({
  className,
  numeric,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2 text-xs font-semibold whitespace-nowrap",
        numeric ? "text-end" : "text-start",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  numeric,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "px-3 py-2 align-top",
        numeric ? "text-end whitespace-nowrap tabular-nums" : "text-start",
        className,
      )}
      {...props}
    />
  );
}
