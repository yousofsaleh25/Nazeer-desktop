/**
 * Saved sessions (`GET /sessions`, a derived index reconciled with the session folders on every
 * call). Every status and index state is shown — a broken folder is a `corrupt` row with the
 * engine's reason, a missing folder "files missing" — so nothing disappears silently. Open
 * continues an open session or inspects a sealed one; Reopen makes a sealed session editable again
 * (its outputs become stale); Delete moves it to the trash after a confirmation (screen-level).
 */
import { ImageOff, LockOpen, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useState } from "react";
import type { HistoryRow } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, Chip } from "@/components/ui/Chip";
import { Ltr, Num } from "@/components/ui/Ltr";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/Table";
import { INDEX_STATE_TONE, STATUS_TONE, type IndexState, type SessionStatus } from "@/design";
import { indexStateLabel, messagePair, useT } from "@/i18n/t";
import { formatDateTime } from "@/lib/format";
import { CodeLabel } from "./labels";

const isStatus = (value: string): value is SessionStatus => value in STATUS_TONE;
const isIndexState = (value: string): value is IndexState => value in INDEX_STATE_TONE;

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (url === null || broken) {
    return (
      <div className="flex h-12 w-20 items-center justify-center rounded-sm bg-surface-sunken text-ink-muted">
        <ImageOff aria-hidden="true" className="size-4" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      width={80}
      height={45}
      loading="lazy"
      onError={() => setBroken(true)}
      className="h-12 w-20 rounded-sm object-cover"
    />
  );
}

export interface HistoryTableProps {
  rows: readonly HistoryRow[];
  /** engine asset path → loadable URL */
  assetUrl: (path: string) => string;
  /** sessions with an action in flight */
  busyIds?: ReadonlySet<string>;
  onOpen: (row: HistoryRow) => void;
  onReopen?: (row: HistoryRow) => void;
  onDelete?: (row: HistoryRow) => void;
}

export function HistoryTable({
  rows,
  assetUrl,
  busyIds,
  onOpen,
  onReopen,
  onDelete,
}: HistoryTableProps) {
  const t = useT();
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeaderCell>
            <span className="sr-only">{t("history.thumbnail")}</span>
          </TableHeaderCell>
          <TableHeaderCell>
            <Bi {...messagePair("history.camel")} />
          </TableHeaderCell>
          <TableHeaderCell>
            <Bi {...messagePair("history.status")} />
          </TableHeaderCell>
          <TableHeaderCell numeric>
            <Bi {...messagePair("history.measurements")} />
          </TableHeaderCell>
          <TableHeaderCell>
            <Bi {...messagePair("history.updated")} />
          </TableHeaderCell>
          <TableHeaderCell>
            <Bi {...messagePair("history.frame")} />
          </TableHeaderCell>
          <TableHeaderCell>
            <span className="sr-only">{t("history.actions")}</span>
          </TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {rows.map((row) => {
          const busy = busyIds?.has(row.session_id) ?? false;
          const usable = row.index_state === "ok" || row.index_state === "unindexed";
          const sealed = row.status === "finalized" || row.status === "exported";
          return (
            <TableRow key={row.session_id} data-session={row.session_id}>
              <TableCell>
                <Thumb
                  url={row.thumb_url ? assetUrl(row.thumb_url) : null}
                  alt={row.camel_id || row.session_id}
                />
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  {row.camel_id ? (
                    <bdi dir="auto" className="self-start font-semibold">
                      {row.camel_id}
                    </bdi>
                  ) : (
                    <span className="text-ink-muted">
                      <Bi {...messagePair("history.noCamelId")} />
                    </span>
                  )}
                  <Ltr className="font-mono text-xs text-ink-muted">{row.session_id}</Ltr>
                  {row.operator ? (
                    <bdi dir="auto" className="self-start text-xs text-ink-secondary">
                      {row.operator}
                    </bdi>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {isStatus(row.status) ? (
                    <Chip tone={STATUS_TONE[row.status]}>
                      <CodeLabel group="statuses" code={row.status} />
                    </Chip>
                  ) : (
                    <Chip>
                      <Ltr>{row.status}</Ltr>
                    </Chip>
                  )}
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
                  {row.outputs_stale || row.report_stale ? (
                    <Badge tone="warning">
                      <Bi
                        {...messagePair(
                          row.outputs_stale ? "history.outputsStale" : "history.reportStale",
                        )}
                      />
                    </Badge>
                  ) : null}
                </div>
                {row.index_error ? (
                  <p className="mt-1 max-w-sm text-xs text-danger-text">
                    <bdi dir="ltr" lang="en">
                      {row.index_error}
                    </bdi>
                  </p>
                ) : null}
              </TableCell>
              <TableCell numeric>
                <Num value={row.n_measurements} />
                {row.n_rejected > 0 ? (
                  <span className="block text-xs text-danger-text">
                    <Bi {...messagePair("history.rejected")} /> <Num value={row.n_rejected} />
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                <Ltr className="text-xs whitespace-nowrap">{formatDateTime(row.updated_at)}</Ltr>
              </TableCell>
              <TableCell>
                <div className="flex flex-col text-xs">
                  <Ltr className="truncate">{row.bag_name ?? "--"}</Ltr>
                  {row.read_index !== null ? (
                    <Ltr className="text-ink-muted">{`#${row.read_index}`}</Ltr>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <Button size="sm" disabled={!usable} loading={busy} onClick={() => onOpen(row)}>
                    <SquareArrowOutUpRight aria-hidden="true" className="rtl:-scale-x-100" />
                    <Bi
                      {...messagePair(
                        row.status === "open" ? "history.continue" : "history.inspect",
                      )}
                    />
                  </Button>
                  {onReopen && sealed && usable ? (
                    <IconButton
                      icon={LockOpen}
                      size="icon-sm"
                      label={t("history.reopen")}
                      disabled={busy}
                      onClick={() => onReopen(row)}
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
