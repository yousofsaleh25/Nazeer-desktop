/**
 * One proposed frame. Shows what the operator needs to choose: the picture, the view bucket, when
 * it was recorded, the mask depth statistics the engine ranked by, and its soft flags. The engine's
 * rank and z_var are deliberately not shown: the grid is unordered (differences below ~15 % are
 * frame-to-frame noise, C2.5).
 */
import { Check, ImageOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { CandidateItem } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Badge, Chip } from "@/components/ui/Chip";
import { Ltr, Num } from "@/components/ui/Ltr";
import { BUCKET_TONE, FLAG_TONE } from "@/design";
import { useLanguage } from "@/design/language";
import { messagePair, translate, useT, type MessageKey } from "@/i18n/t";
import { cn } from "@/lib/cn";
import { CodeLabel, useLabels } from "./labels";

function Stat({ label, children }: { label: MessageKey; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-secondary">
        <Bi {...messagePair(label)} />
      </dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

const percent = (fraction: number | null) => (fraction === null ? null : fraction * 100);

export interface CandidateTileProps {
  candidate: CandidateItem;
  /** the thumbnail URL (engine asset URL with the token, or a dev file) */
  thumbUrl: string;
  selected?: boolean;
  busy?: boolean;
  onPick: (candidate: CandidateItem) => void;
}

export function CandidateTile({
  candidate,
  thumbUrl,
  selected = false,
  busy = false,
  onPick,
}: CandidateTileProps) {
  const t = useT();
  const { lang } = useLanguage();
  const labels = useLabels();
  const [broken, setBroken] = useState(false);
  const m = translate(lang, "units.m");
  const time = translate(lang, "units.s");
  return (
    <article
      aria-label={`${t("candidate.frame")} ${candidate.candidate_id}`}
      data-selected={selected || undefined}
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-surface shadow-sm",
        selected ? "border-primary ring-2 ring-primary" : "border-border",
      )}
    >
      <div className="relative aspect-video bg-surface-sunken">
        {broken ? (
          <div className="flex size-full items-center justify-center text-ink-muted">
            <ImageOff aria-hidden="true" className="size-8" />
          </div>
        ) : (
          <img
            src={thumbUrl}
            alt={`${t("candidate.frameAt")} ${candidate.bag_time_s.toFixed(1)} ${time}`}
            width={320}
            height={180}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="size-full object-cover"
          />
        )}
        {candidate.bucket ? (
          <Badge tone={BUCKET_TONE[candidate.bucket]} className="absolute start-2 top-2 shadow-sm">
            <CodeLabel group="buckets" code={candidate.bucket} />
          </Badge>
        ) : null}
        {selected ? (
          <span className="absolute end-2 top-2 inline-flex size-6 items-center justify-center rounded-full bg-primary text-primary-fg">
            <Check aria-hidden="true" className="size-4" />
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <Num value={candidate.bag_time_s} digits={1} unit={time} className="font-semibold" />
          <Ltr className="text-xs text-ink-muted">{`#${candidate.read_index}`}</Ltr>
        </div>
        <dl className="flex flex-col gap-0.5 text-xs">
          <Stat label="candidate.zMedian">
            <Num value={candidate.z_median} digits={3} unit={m} />
          </Stat>
          <Stat label="candidate.relDisp">
            <Num value={percent(candidate.rel_disp)} digits={1} unit="%" />
          </Stat>
          <Stat label="candidate.maskArea">
            <Num value={percent(candidate.mask_area_frac)} digits={0} unit="%" />
          </Stat>
          <Stat label="candidate.validDepth">
            <Num value={percent(candidate.valid_frac)} digits={0} unit="%" />
          </Stat>
          <Stat label="candidate.confidence">
            <Num value={candidate.conf} digits={2} />
          </Stat>
        </dl>
        {(candidate.flags ?? []).length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {(candidate.flags ?? []).map((flag) => (
              <Chip
                key={flag}
                tone={
                  labels?.candidate_flags[flag]?.severity === "warn"
                    ? FLAG_TONE.warn
                    : FLAG_TONE.info
                }
              >
                <CodeLabel group="candidate_flags" code={flag} />
              </Chip>
            ))}
          </div>
        ) : null}
        <div className="mt-auto pt-1">
          <Button
            variant={selected ? "primary" : "secondary"}
            className="w-full"
            loading={busy}
            onClick={() => onPick(candidate)}
          >
            <Bi {...messagePair("candidate.pick")} />
          </Button>
        </div>
      </div>
    </article>
  );
}
