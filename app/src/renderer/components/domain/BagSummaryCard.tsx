/**
 * What `POST /bags/inspect` found in a recording: file, device, streams, length, how the walk will
 * sample it, and whether a candidate set is already cached for it.
 */
import { Film } from "lucide-react";
import type { ReactNode } from "react";
import type { BagInfo } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Ltr, Num, PathText } from "@/components/ui/Ltr";
import { useLanguage } from "@/design/language";
import { messagePair, translate, type MessageKey } from "@/i18n/t";
import { byteSize } from "@/lib/format";

function Row({ label, children }: { label: MessageKey; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-ink-secondary sm:w-40 sm:shrink-0">
        <Bi {...messagePair(label)} />
      </dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

function Stream({ stream }: { stream: BagInfo["color"] }) {
  return (
    <Ltr>
      {`${stream.width}×${stream.height} @ ${stream.fps} fps · ${stream.format.replace(/^format\./, "")}`}
    </Ltr>
  );
}

export function BagSummaryCard({ bag, actions }: { bag: BagInfo; actions?: ReactNode }) {
  const { lang } = useLanguage();
  const size = byteSize(bag.size_bytes);
  return (
    <Card title={messagePair("bagInfo.title")} actions={actions} level={2}>
      <div className="flex items-center gap-3">
        <Film aria-hidden="true" className="size-6 shrink-0 text-primary-text" />
        <div className="flex min-w-0 flex-col">
          <Ltr className="truncate text-base font-semibold">{bag.name}</Ltr>
          <PathText path={bag.path} className="truncate text-xs text-ink-muted" />
        </div>
        {bag.cached_candidate_sets.length > 0 ? (
          <Chip tone="success" className="ms-auto">
            <Bi {...messagePair("bagInfo.cached")} />
          </Chip>
        ) : null}
      </div>
      <dl className="flex flex-col gap-1.5 text-sm">
        <Row label="bagInfo.device">
          <Ltr>{bag.device_name}</Ltr>
        </Row>
        <Row label="bagInfo.duration">
          <Num value={bag.duration_s} digits={1} unit={translate(lang, "units.s")} />
        </Row>
        <Row label="bagInfo.frames">
          <Num value={bag.n_frames_estimate} grouping />
        </Row>
        <Row label="bagInfo.size">
          <Num
            value={size.value}
            digits={size.digits}
            unit={translate(lang, `units.${size.unit}`)}
          />
        </Row>
        <Row label="bagInfo.color">
          <Stream stream={bag.color} />
        </Row>
        <Row label="bagInfo.depth">
          <Stream stream={bag.depth} />
        </Row>
        <Row label="bagInfo.sampleEvery">
          <Num value={bag.sample_every_effective} />
        </Row>
      </dl>
      {bag.path_fallback ? (
        <p className="text-xs text-ink-muted">
          <Bi {...messagePair("bagInfo.pathFallback")} />: <PathText path={bag.path_fallback} />
        </p>
      ) : null}
    </Card>
  );
}
