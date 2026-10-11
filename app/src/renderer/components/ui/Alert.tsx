/**
 * A banner inside the page ("Editing view — approve on the engine image", "report out of date",
 * "fewer frames than asked for"). Danger banners are announced at once (role="alert"); the others
 * politely (role="status").
 */
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Bi, type BiText } from "./Bi";
import { cn } from "@/lib/cn";

export type AlertTone = "info" | "success" | "warning" | "danger" | "neutral";

const ICONS: Record<AlertTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  neutral: Info,
};

const TONE: Record<AlertTone, string> = {
  info: "border-info-border bg-info-soft [&_.alert-icon]:text-info-text",
  success: "border-success-border bg-success-soft [&_.alert-icon]:text-success-text",
  warning: "border-warning-border bg-warning-soft [&_.alert-icon]:text-warning-text",
  danger: "border-danger-border bg-danger-soft [&_.alert-icon]:text-danger-text",
  neutral: "border-border-strong bg-surface-sunken [&_.alert-icon]:text-ink-secondary",
};

export interface AlertProps {
  tone?: AlertTone;
  title?: BiText;
  icon?: LucideIcon;
  /** controls at the inline end (retry, dismiss) */
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Alert({ tone = "info", title, icon, actions, className, children }: AlertProps) {
  const Icon = icon ?? ICONS[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      data-tone={tone}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3.5 py-3 text-ink",
        TONE[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="alert-icon mt-0.5 size-4.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        {title ? (
          <p className="font-semibold">
            <Bi {...title} />
          </p>
        ) : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
