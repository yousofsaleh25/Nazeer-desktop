/** What an empty list or an unavailable view says, with the next action when there is one. */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Bi, type BiText } from "./Bi";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: BiText;
  description?: BiText;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center",
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-8 text-ink-muted" /> : null}
      <p className="text-base font-medium text-ink">
        <Bi {...title} />
      </p>
      {description ? (
        <p className="max-w-md text-sm text-ink-secondary">
          <Bi {...description} />
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
