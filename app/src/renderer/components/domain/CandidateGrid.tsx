/**
 * The proposed frames of one walk, in recording order (read index) — never in rank order: the
 * engine presents them unordered because differences below its noise floor mean nothing (C2.5).
 * Says when fewer frames than asked for passed (with the engine's reasons), when the walk was
 * stopped early, and what was rejected and why.
 */
import { Images } from "lucide-react";
import type { CandidateItem, CandidateSet } from "@/api/types";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ltr, Num } from "@/components/ui/Ltr";
import { messagePair } from "@/i18n/t";
import { readBoolean, readNumber, readRecord } from "@/lib/read";
import { CandidateTile } from "./CandidateTile";
import { CodeLabel } from "./labels";

export interface CandidateGridProps {
  set: CandidateSet;
  /** engine asset path → loadable URL (token added by the client) */
  assetUrl: (path: string) => string;
  selectedId?: string | null;
  busyId?: string | null;
  onPick: (candidate: CandidateItem) => void;
}

/** Recording order; the engine's rank never decides the order on screen. */
export function inRecordingOrder(candidates: readonly CandidateItem[]): CandidateItem[] {
  return [...candidates].sort((a, b) => a.read_index - b.read_index);
}

export function CandidateGrid({
  set,
  assetUrl,
  selectedId = null,
  busyId = null,
  onPick,
}: CandidateGridProps) {
  const noise = readNumber(set, "noise_floor_frac");
  const requested = readNumber(set.params, "m");
  const stoppedEarly = readBoolean(set.walk, "stopped_early") === true;
  const rejected = Object.entries(set.rejected_by_reason).filter(([, n]) => n > 0);
  const sampled = readNumber(set.walk, "n_sampled");
  const selection = readRecord(set, "selection");
  const skippedClose = readNumber(selection, "skipped_too_close");

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-ink-secondary">
        <span className="text-base font-semibold text-ink">
          <Num value={set.n_candidates} />
          {requested !== null ? (
            <>
              {" / "}
              <Num value={requested} />
            </>
          ) : null}{" "}
          <Bi {...messagePair("candidates.proposed")} />
        </span>
        {sampled !== null ? (
          <span>
            <Bi {...messagePair("candidates.sampled")} />: <Num value={sampled} grouping />
          </span>
        ) : null}
        <span>
          <Bi {...messagePair("candidates.unordered")} />
          {noise !== null ? (
            <>
              {" "}
              (<Num value={noise * 100} digits={0} unit="%" />)
            </>
          ) : null}
        </span>
      </div>

      {stoppedEarly ? (
        <Alert tone="warning" title={messagePair("candidates.stoppedEarly")}>
          <Bi {...messagePair("candidates.stoppedEarlyHint")} />
        </Alert>
      ) : null}
      {set.partial ? (
        <Alert tone="warning" title={messagePair("candidates.partial")}>
          {set.shortfall_reasons.length > 0 ? (
            <ul className="list-inside list-disc">
              {set.shortfall_reasons.map((reason) => (
                <li key={reason}>
                  <bdi dir="ltr" lang="en">
                    {reason}
                  </bdi>
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {set.warnings.length > 0 ? (
        <Alert tone="warning" title={messagePair("candidates.warnings")}>
          <ul className="list-inside list-disc">
            {set.warnings.map((warning) => (
              <li key={warning}>
                <bdi dir="ltr" lang="en">
                  {warning}
                </bdi>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {set.candidates.length === 0 ? (
        <EmptyState
          icon={Images}
          title={messagePair("candidates.none")}
          description={messagePair("candidates.noneHint")}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
          {inRecordingOrder(set.candidates).map((candidate) => (
            <CandidateTile
              key={candidate.candidate_id}
              candidate={candidate}
              thumbUrl={assetUrl(candidate.urls.thumb)}
              selected={candidate.candidate_id === selectedId}
              busy={candidate.candidate_id === busyId}
              onPick={onPick}
            />
          ))}
        </div>
      )}

      {rejected.length > 0 || skippedClose ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-secondary select-none">
            <Bi {...messagePair("candidates.rejectedSummary")} />
          </summary>
          <ul className="mt-2 flex max-w-xl flex-col gap-1">
            {rejected.map(([code, n]) => (
              <li key={code} className="flex items-center justify-between gap-3">
                <CodeLabel group="candidate_rejections" code={code} />
                <Num value={n} grouping className="text-ink-secondary" />
              </li>
            ))}
            {skippedClose ? (
              <li className="flex items-center justify-between gap-3">
                <Bi {...messagePair("candidates.skippedClose")} />
                <Num value={skippedClose} className="text-ink-secondary" />
              </li>
            ) : null}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">
            <Ltr>{`${set.fingerprint.slice(0, 12)} · ${set.params_hash}`}</Ltr>
          </p>
        </details>
      ) : null}
    </section>
  );
}
