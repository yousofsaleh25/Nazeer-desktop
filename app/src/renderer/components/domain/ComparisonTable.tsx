/**
 * The comparisons made (`GET /comparisons`, D12 F2.8; the index reconciled with the folders on
 * every call — a broken folder is a `corrupt` row, never hidden). Each row: the cover title (or
 * "untitled") and event, the camels in the operator's order, when it was made, its status, and —
 * computed by the engine from the sessions — whether it is out of date, with each changed camel's
 * reason. Open shows the comparison; "Save PDF as…" saves a copy of a sealed one (D12 F1); Delete
 * moves it to the trash after a confirmation (screen-level). Rows come in the order the operator
 * asked for (date or title), never by a value.
 */
import { FileDown, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import type { ComparisonRow } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, Chip } from "@/components/ui/Chip";
import { Ltr } from "@/components/ui/Ltr";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/Table";
import { INDEX_STATE_TONE, type IndexState } from "@/design";
import { indexStateLabel, messagePair, useT } from "@/i18n/t";
import { formatDateTime } from "@/lib/format";
import { CodeLabel } from "./labels";

const isIndexState = (value: string): value is IndexState => value in INDEX_STATE_TONE;

export interface ComparisonTableProps {
  rows: readonly ComparisonRow[];
  busyIds?: ReadonlySet<string>;
  onOpen: (row: ComparisonRow) => void;
  onDelete?: (row: ComparisonRow) => void;
  /** save a copy of the sealed PDF (rows with a sealed report) */
  onSaveAs?: (row: ComparisonRow) => void;
}

export function ComparisonTable({
  rows,
  busyIds,
  onOpen,
  onDelete,
  onSaveAs,
}: ComparisonTableProps) {
  const t = useT();
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeaderCell>
            <Bi {...messagePair("comparisons.titleColumn")} />
          </TableHeaderCell>
          <TableHeaderCell>
            <Bi {...messagePair("comparisons.camels")} />
          </TableHeaderCell>
          <TableHeaderCell>
            <Bi {...messagePair("history.status")} />
          </TableHeaderCell>
          <TableHeaderCell>
            <Bi {...messagePair("comparisons.created")} />
          </TableHeaderCell>
          <TableHeaderCell>
            <span className="sr-only">{t("history.actions")}</span>
          </TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {rows.map((row) => {
          const busy = busyIds?.has(row.comparison_id) ?? false;
          const usable = row.index_state === "ok" || row.index_state === "unindexed";
          const changed = [...row.members]
            .sort((a, b) => a.position - b.position)
            .filter((member) => member.stale_reasons.length > 0);
          return (
            <TableRow key={row.comparison_id} data-comparison={row.comparison_id}>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  {row.title ? (
                    <bdi dir="auto" className="self-start font-semibold">
                      {row.title}
                    </bdi>
                  ) : (
                    <span className="text-ink-muted">
                      <Bi {...messagePair("comparisons.untitled")} />
                    </span>
                  )}
                  {row.event ? (
                    <bdi dir="auto" className="self-start text-xs text-ink-secondary">
                      {row.event}
                    </bdi>
                  ) : null}
                  <Ltr className="font-mono text-xs text-ink-muted">{row.comparison_id}</Ltr>
                </div>
              </TableCell>
              <TableCell>
                <ol className="flex max-w-md flex-wrap gap-1">
                  {[...row.members]
                    .sort((a, b) => a.position - b.position)
                    .map((member) => (
                      <li key={`${member.position}-${member.session_id}`}>
                        <Chip tone={member.stale_reasons.length > 0 ? "warning" : "neutral"}>
                          <Ltr>{`#${member.position}`}</Ltr>{" "}
                          {member.camel_id ? (
                            <bdi dir="auto">{member.camel_id}</bdi>
                          ) : (
                            <Ltr className="font-mono">{member.session_id}</Ltr>
                          )}
                        </Chip>
                      </li>
                    ))}
                </ol>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  <Chip tone={row.status === "sealed" ? "success" : "neutral"}>
                    <CodeLabel group="comparison_statuses" code={row.status} />
                  </Chip>
                  {row.stale ? (
                    <Badge tone="warning">
                      <Bi {...messagePair("comparisons.stale")} />
                    </Badge>
                  ) : null}
                  {row.report_stale ? (
                    <Badge tone="warning">
                      <Bi {...messagePair("comparisons.reportStale")} />
                    </Badge>
                  ) : null}
                  {row.index_state !== "ok" ? (
                    <Chip
                      tone={
                        isIndexState(row.index_state)
                          ? INDEX_STATE_TONE[row.index_state]
                          : "neutral"
                      }
                    >
                      {isIndexState(row.index_state) ? (
                        <Bi {...indexStateLabel(row.index_state)} />
                      ) : (
                        <Ltr>{row.index_state}</Ltr>
                      )}
                    </Chip>
                  ) : null}
                </div>
                {changed.length > 0 ? (
                  <ul className="mt-1 flex max-w-sm flex-col gap-0.5 text-xs text-ink-secondary">
                    {changed.map((member) => (
                      <li key={`${member.position}-${member.session_id}`}>
                        <Ltr>{`#${member.position}`}</Ltr>{" "}
                        {member.stale_reasons.map((reason, i) => (
                          <span key={reason}>
                            {i > 0 ? " · " : null}
                            <CodeLabel group="comparison_stale" code={reason} />
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {row.index_error ? (
                  <p className="mt-1 max-w-sm text-xs text-danger-text">
                    <bdi dir="ltr" lang="en">
                      {row.index_error}
                    </bdi>
                  </p>
                ) : null}
              </TableCell>
              <TableCell>
                <Ltr className="text-xs whitespace-nowrap">{formatDateTime(row.created_at)}</Ltr>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <Button size="sm" disabled={!usable} loading={busy} onClick={() => onOpen(row)}>
                    <SquareArrowOutUpRight aria-hidden="true" className="rtl:-scale-x-100" />
                    <Bi {...messagePair("history.inspect")} />
                  </Button>
                  {onSaveAs && row.report_version > 0 && usable ? (
                    <IconButton
                      icon={FileDown}
                      size="icon-sm"
                      label={t("report.saveAs")}
                      disabled={busy}
                      onClick={() => onSaveAs(row)}
                    />
                  ) : null}
                  {onDelete ? (
                    <IconButton
                      icon={Trash2}
                      size="icon-sm"
                      label={t("history.delete")}
                      disabled={busy}
                      onClick={() => onDelete(row)}
                      className="text-danger-text"
                    />
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
