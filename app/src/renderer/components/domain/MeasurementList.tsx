/**
 * The session's measurements in operator order, with the engine's summary ("1 of 13 points
 * snapped to the camel (KNN)") and the counts of low-confidence and rejected rows.
 */
import { Ruler } from "lucide-react";
import type { MeasurementRow, SessionSummary } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Num } from "@/components/ui/Ltr";
import { messagePair } from "@/i18n/t";
import { MeasurementItem, type MeasurementActions, type RowStatus } from "./MeasurementItem";

export interface MeasurementListProps extends MeasurementActions {
  rows: readonly MeasurementRow[];
  statusById?: Readonly<Record<number, RowStatus>>;
  selectedId?: number | null;
  summary?: SessionSummary | null;
  readOnly?: boolean;
}

export function MeasurementList({
  rows,
  statusById = {},
  selectedId = null,
  summary = null,
  readOnly = false,
  ...actions
}: MeasurementListProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 px-1 text-sm">
        <h3 className="font-semibold">
          <Bi {...messagePair("measure.listTitle")} />{" "}
          <span className="text-ink-secondary">
            (<Num value={rows.length} />)
          </span>
        </h3>
        {summary && summary.n_low_confidence > 0 ? (
          <Chip tone="warning">
            <Bi {...messagePair("measure.lowConfidence")} />:{" "}
            <Num value={summary.n_low_confidence} />
          </Chip>
        ) : null}
        {summary && summary.n_rejected > 0 ? (
          <Chip tone="danger">
            <Bi {...messagePair("measure.rejectedCount")} />: <Num value={summary.n_rejected} />
          </Chip>
        ) : null}
      </div>
      {summary && summary.n_points > 0 ? (
        <p className="px-1 text-xs text-ink-secondary">
          <Bi {...summary.snapped_text} />
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={Ruler}
          title={messagePair("measure.empty")}
          description={readOnly ? undefined : messagePair("measure.emptyHint")}
        />
      ) : (
        <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {rows.map((row, index) => (
            <MeasurementItem
              key={row.id}
              row={row}
              status={statusById[row.id] ?? "saved"}
              selected={row.id === selectedId}
              readOnly={readOnly}
              first={index === 0}
              last={index === rows.length - 1}
              {...actions}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
