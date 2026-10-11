/**
 * The candidate walk while it runs: state and stage, progress, elapsed time and ETA, the live
 * counters and the rejections by reason (engine labels), and the engine's warnings and messages
 * (free English text, shown as sent). Stop = keep the frames found so far (shown, never cached as
 * a complete walk); Cancel = discard.
 */
import { CircleStop, X } from "lucide-react";
import type { ReactNode } from "react";
import { errorFromDetail } from "@/api/errors";
import type { JobSnapshot } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Ltr, Num } from "@/components/ui/Ltr";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { Tone } from "@/design";
import { useLanguage } from "@/design/language";
import { jobStageLabel, messagePair, translate, useT, type MessageKey } from "@/i18n/t";
import { CodeLabel } from "./labels";
import { ErrorPanel } from "./ErrorPanel";

const STATE_TONE: Record<JobSnapshot["state"], Tone> = {
  queued: "neutral",
  running: "info",
  cancelling: "warning",
  done: "success",
  cancelled: "neutral",
  failed: "danger",
};

function Counter({ label, value }: { label: MessageKey; value: number }) {
  return (
    <div className="flex flex-col rounded-md border border-border bg-surface-raised px-3 py-2">
      <span className="text-xs text-ink-secondary">
        <Bi {...messagePair(label)} />
      </span>
      <Num value={value} grouping className="text-lg font-semibold" />
    </div>
  );
}

export interface JobProgressProps {
  job: JobSnapshot;
  /** how updates arrive: the event stream, or polling after it failed */
  transport?: "sse" | "poll";
  onStop?: () => void;
  onCancel?: () => void;
  /** e.g. "show the frames" once done */
  actions?: ReactNode;
}

export function JobProgress({ job, transport, onStop, onCancel, actions }: JobProgressProps) {
  const t = useT();
  const { lang } = useLanguage();
  const seconds = translate(lang, "units.s");
  const rejected = Object.entries(job.counters.rejected_by_reason ?? {}).filter(([, n]) => n > 0);
  const active = !job.terminal && job.state !== "cancelling";
  return (
    <Card
      title={messagePair("job.title")}
      level={2}
      actions={
        <span className="flex items-center gap-2">
          <Chip tone={STATE_TONE[job.state]} size="md">
            <CodeLabel group="job_states" code={job.state} />
          </Chip>
          {transport === "poll" ? (
            <Chip tone="neutral" title={t("job.pollingHint")}>
              <Bi {...messagePair("job.polling")} />
            </Chip>
          ) : null}
        </span>
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">
          <Bi {...jobStageLabel(job.stage)} />
        </span>
        <span className="text-ink-secondary">
          <Num value={job.progress_fraction * 100} digits={0} unit="%" />
        </span>
      </div>
      <ProgressBar
        value={job.terminal && job.state === "done" ? 1 : job.progress_fraction}
        label={t("job.progress")}
        tone={job.state === "failed" ? "danger" : "primary"}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-secondary">
        <span>
          <Bi {...messagePair("job.elapsed")} />:{" "}
          <Num value={job.elapsed_s} digits={1} unit={seconds} />
        </span>
        {active ? (
          <span>
            <Bi {...messagePair("job.eta")} />: <Num value={job.eta_s} digits={0} unit={seconds} />
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Counter label="job.read" value={job.counters.read} />
        <Counter label="job.sampled" value={job.counters.sampled} />
        <Counter label="job.detected" value={job.counters.detected} />
        <Counter label="job.passed" value={job.counters.passed} />
      </div>
      {rejected.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium">
            <Bi {...messagePair("job.rejectedByReason")} />
          </h4>
          <ul className="flex flex-col gap-1 text-sm">
            {rejected.map(([code, n]) => (
              <li key={code} className="flex items-center justify-between gap-3">
                <CodeLabel group="candidate_rejections" code={code} />
                <Num value={n} grouping className="text-ink-secondary" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {job.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-warning-text">
          {job.warnings.map((warning) => (
            <li key={warning}>
              <bdi dir="ltr" lang="en">
                {warning}
              </bdi>
            </li>
          ))}
        </ul>
      ) : null}
      {job.message ? (
        <p className="text-xs text-ink-muted">
          <bdi dir="ltr" lang="en">
            {job.message}
          </bdi>
        </p>
      ) : null}
      {job.error ? <ErrorPanel error={errorFromDetail(job.error)} /> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {actions}
        {onStop && active ? (
          <Button onClick={onStop} title={t("job.stopHint")}>
            <CircleStop aria-hidden="true" />
            <Bi {...messagePair("job.stop")} />
          </Button>
        ) : null}
        {onCancel && active ? (
          <Button variant="ghost" onClick={onCancel}>
            <X aria-hidden="true" />
            <Bi {...messagePair("job.cancel")} />
          </Button>
        ) : null}
        {job.state === "done" ? <Ltr className="text-xs text-ink-muted">{job.job_id}</Ltr> : null}
      </div>
    </Card>
  );
}
