/**
 * Every error the operator sees: the bilingual label of its code (engine codes from i18n
 * `errors`, the app's own from `appErrors`), the engine's message as sent (English, left to right),
 * the HTTP status and the details. An unknown code shows the raw code, never a blank (D9). "Copy"
 * puts the whole error on the clipboard as JSON for a support report.
 */
import { Check, CircleAlert, Copy, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ApiErrorShape } from "@/api/errors";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Ltr } from "@/components/ui/Ltr";
import { errorLabel, messagePair, useT } from "@/i18n/t";
import { cn } from "@/lib/cn";

export interface ErrorPanelProps {
  error: ApiErrorShape;
  /** e.g. "Opening the bag failed" */
  context?: { ar: string; en: string };
  onRetry?: () => void;
  /** extra controls (dismiss, reprint) */
  actions?: ReactNode;
  className?: string;
}

/** JSON for the clipboard / the details view; a large `current` view is summarised. */
export function errorJson(error: ApiErrorShape, { full = true }: { full?: boolean } = {}): string {
  const details = { ...error.details };
  if (!full && typeof details["current"] === "object" && details["current"] !== null) {
    const current = details["current"] as Record<string, unknown>;
    details["current"] = {
      session_id: current["session_id"],
      revision: current["revision"],
      "…": "…",
    };
  }
  return JSON.stringify({ ...error, details }, null, 2);
}

export function ErrorPanel({ error, context, onRetry, actions, className }: ErrorPanelProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const label = errorLabel(error.code);
  const hasDetails = Object.keys(error.details).length > 0;

  const copy = () => {
    void navigator.clipboard.writeText(errorJson(error)).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <div
      role="alert"
      data-code={error.code}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-danger-border bg-danger-soft p-3.5 text-ink",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger-text" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {context ? (
            <p className="text-xs font-medium text-ink-secondary">
              <Bi {...context} />
            </p>
          ) : null}
          <p className="font-semibold text-danger-text">
            {label ? <Bi {...label} /> : <Ltr className="font-mono">{error.code}</Ltr>}
          </p>
          {error.message ? (
            <p className="text-sm text-ink-secondary">
              <span className="sr-only">{t("errorPanel.engineMessage")}: </span>
              <bdi dir="ltr" lang="en">
                {error.message}
              </bdi>
            </p>
          ) : null}
          <p className="flex flex-wrap gap-x-3 text-xs text-ink-muted">
            {label ? (
              <span>
                <Bi {...messagePair("errorPanel.code")} />:{" "}
                <Ltr className="font-mono">{error.code}</Ltr>
              </span>
            ) : null}
            {error.status !== null ? (
              <span>
                <Bi {...messagePair("errorPanel.status")} />: <Ltr>{error.status}</Ltr>
              </span>
            ) : null}
          </p>
        </div>
      </div>
      {hasDetails ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-secondary select-none">
            <Bi {...messagePair("errorPanel.details")} />
          </summary>
          <pre
            dir="ltr"
            className="mt-2 max-h-56 overflow-auto rounded-md border border-border bg-surface-raised p-2 font-mono text-[0.72rem] leading-relaxed whitespace-pre-wrap text-ink"
          >
            {errorJson(error, { full: false })}
          </pre>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {actions}
        <Button size="sm" variant="ghost" onClick={copy} aria-live="polite">
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          <Bi {...messagePair(copied ? "common.copied" : "common.copy")} />
        </Button>
        {onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            <Bi {...messagePair("common.retry")} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
