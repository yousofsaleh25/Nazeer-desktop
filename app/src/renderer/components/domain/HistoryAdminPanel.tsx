/**
 * Housekeeping of the data root: what is stored (sessions, cached candidate sets, trash, backups,
 * the index), the last reconcile, and the two maintenance actions — back up the history index
 * (`Connection.backup()` in the engine) and rebuild it from the session folders (the index is
 * derived, never authoritative).
 */
import { DatabaseBackup, RefreshCw } from "lucide-react";
import type { ApiErrorShape } from "@/api/errors";
import type { BackupOut, HistoryList, HistoryStats } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Ltr, Num, PathText } from "@/components/ui/Ltr";
import { useLanguage } from "@/design/language";
import { messagePair, translate, type MessageKey } from "@/i18n/t";
import { byteSize } from "@/lib/format";
import { readNumber, readRecord } from "@/lib/read";
import { ErrorPanel } from "./ErrorPanel";

function Size({ bytes }: { bytes: number | null }) {
  const { lang } = useLanguage();
  if (bytes === null) return <span>--</span>;
  const size = byteSize(bytes);
  return (
    <Num value={size.value} digits={size.digits} unit={translate(lang, `units.${size.unit}`)} />
  );
}

function StatRow({
  label,
  count,
  bytes,
}: {
  label: MessageKey;
  count: number | null;
  bytes: number | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-secondary">
        <Bi {...messagePair(label)} />
      </dt>
      <dd className="flex gap-3">
        <Num value={count} grouping />
        <span className="min-w-20 text-end text-ink-muted">
          <Size bytes={bytes} />
        </span>
      </dd>
    </div>
  );
}

const RECONCILE_KEYS = [
  "unindexed",
  "refreshed",
  "missing_files",
  "corrupt",
  "unchanged",
  "busy",
] as const;

export interface HistoryAdminPanelProps {
  stats: HistoryStats | null;
  reconciled?: HistoryList["reconciled"] | null;
  lastBackup?: BackupOut | null;
  busy?: "backup" | "rebuild" | null;
  error?: ApiErrorShape | null;
  onBackup: () => void;
  onRebuild: () => void;
}

export function HistoryAdminPanel({
  stats,
  reconciled = null,
  lastBackup = null,
  busy = null,
  error = null,
  onBackup,
  onRebuild,
}: HistoryAdminPanelProps) {
  const index = readRecord(stats, "index");
  const byState = readRecord(index, "by_index_state") ?? {};
  return (
    <Card title={messagePair("admin.title")}>
      <dl className="flex flex-col gap-1 text-sm">
        <StatRow
          label="admin.sessions"
          count={readNumber(stats?.sessions, "count")}
          bytes={readNumber(stats?.sessions, "bytes")}
        />
        <StatRow
          label="admin.candidates"
          count={readNumber(stats?.candidates, "count")}
          bytes={readNumber(stats?.candidates, "bytes")}
        />
        <StatRow
          label="admin.trash"
          count={readNumber(stats?.trash, "count")}
          bytes={readNumber(stats?.trash, "bytes")}
        />
        <StatRow
          label="admin.backups"
          count={readNumber(stats?.backups, "count")}
          bytes={readNumber(stats?.backups, "bytes")}
        />
        <StatRow
          label="admin.index"
          count={readNumber(index, "rows")}
          bytes={readNumber(index, "db_bytes")}
        />
      </dl>
      {Object.keys(byState).length > 0 ? (
        <p className="flex flex-wrap gap-x-3 text-xs text-ink-secondary">
          {Object.entries(byState).map(([state, n]) => (
            <Ltr key={state}>{`${state}: ${typeof n === "number" ? n : "--"}`}</Ltr>
          ))}
        </p>
      ) : null}
      {reconciled ? (
        <div className="text-xs text-ink-secondary">
          <p className="font-medium text-ink">
            <Bi {...messagePair("admin.reconciled")} />
          </p>
          <p className="flex flex-wrap gap-x-3">
            {RECONCILE_KEYS.map((key) => (
              <span key={key}>
                <Bi {...messagePair(`admin.reconcile.${key}`)} />:{" "}
                <Num value={reconciled[key] ?? 0} />
              </span>
            ))}
          </p>
        </div>
      ) : null}
      {lastBackup ? (
        <p className="text-xs text-success-text">
          <Bi {...messagePair("admin.backupWritten")} />:{" "}
          <PathText path={lastBackup.path} className="font-mono" />
        </p>
      ) : null}
      {error ? <ErrorPanel error={error} /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onRebuild} loading={busy === "rebuild"} disabled={busy !== null}>
          <RefreshCw aria-hidden="true" />
          <Bi {...messagePair("admin.rebuild")} />
        </Button>
        <Button
          variant="primary"
          onClick={onBackup}
          loading={busy === "backup"}
          disabled={busy !== null}
        >
          <DatabaseBackup aria-hidden="true" />
          <Bi {...messagePair("admin.backup")} />
        </Button>
      </div>
    </Card>
  );
}
