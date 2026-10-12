/**
 * History (#/history, C3.3): every saved session from the engine's derived index, which it
 * reconciles with the session folders on every list — a broken folder is a `corrupt` row, a
 * missing one "files missing", never hidden. Search (camel id, operator, notes, session id),
 * status, index state, sort, pages. Open continues or inspects a session; Reopen makes a sealed one
 * editable (its outputs become stale); Delete moves it to the trash after a confirmation. The
 * maintenance panel backs up and rebuilds the index.
 */
import { ChevronLeft, ChevronRight, History as HistoryIcon, Search } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { useNavigate } from "react-router";
import {
  useBackupHistoryMutation,
  useHistoryStatsQuery,
  useListSessionsQuery,
  useRebuildHistoryMutation,
} from "@/api/engineApi";
import { toApiError, type ApiErrorShape } from "@/api/errors";
import type { BackupOut, HistoryRow } from "@/api/types";
import { engineUrl } from "@/api/urls";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { HistoryAdminPanel } from "@/components/domain/HistoryAdminPanel";
import { HistoryTable } from "@/components/domain/HistoryTable";
import { labelOf } from "@/api/labels";
import { useLabels } from "@/components/domain/labels";
import { Bi } from "@/components/ui/Bi";
import { IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Field";
import { Ltr, Num } from "@/components/ui/Ltr";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { indexStateLabel, messagePair, useT } from "@/i18n/t";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  HISTORY_PAGE_SIZE,
  historyPageChanged,
  historyParams,
  historyQueryChanged,
  type HistoryIndexState,
  type HistorySort,
  type HistoryStatus,
} from "@/store/slices/history";
import { deleteSessionById, reopenSessionById } from "@/store/thunks/history";
import { useUnsavedGuard } from "./session/useUnsavedGuard";

const ALL = "all";
const STATUSES: readonly HistoryStatus[] = ["open", "finalized", "exported"];
const INDEX_STATES: readonly HistoryIndexState[] = [
  "ok",
  "unindexed",
  "missing_files",
  "corrupt",
  "delete_failed",
];
const SORTS: readonly HistorySort[] = ["updated_desc", "created_desc", "created_asc", "camel_asc"];

/** The search box: typing waits 300 ms before the list is asked again. */
function SearchField({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value);
  const search = useEffectEvent((q: string) => onSearch(q));
  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => search(text), 300);
    return () => clearTimeout(timer);
  }, [text, value]);
  return (
    <Field label={messagePair("history.search")} className="min-w-56 flex-1">
      <Input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="…"
      />
    </Field>
  );
}

export function HistoryScreen() {
  const t = useT();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const labels = useLabels();
  const query = useAppSelector((state) => state.history);
  const connection = useAppSelector((state) => state.engine.connection);
  const list = useListSessionsQuery(historyParams(query));
  const stats = useHistoryStatsQuery();
  const [backup, backupState] = useBackupHistoryMutation();
  const [rebuild, rebuildState] = useRebuildHistoryMutation();
  const { confirmDiscard, dialog } = useUnsavedGuard();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<{ id: string; error: ApiErrorShape } | null>(null);
  const [deleting, setDeleting] = useState<HistoryRow | null>(null);
  const [lastBackup, setLastBackup] = useState<BackupOut | null>(null);
  const [adminError, setAdminError] = useState<ApiErrorShape | null>(null);

  const assetUrl = (path: string) => (connection === null ? "" : engineUrl(connection, path));
  const mark = (id: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const open = async (row: HistoryRow) => {
    if (!(await confirmDiscard(row.session_id))) return;
    void navigate(`/sessions/${row.session_id}`);
  };

  const reopen = async (row: HistoryRow) => {
    if (!(await confirmDiscard(row.session_id))) return;
    mark(row.session_id, true);
    setProblem(null);
    const error = await dispatch(reopenSessionById(row.session_id));
    mark(row.session_id, false);
    if (error !== null) setProblem({ id: row.session_id, error });
    else void navigate(`/sessions/${row.session_id}`);
  };

  const remove = async (row: HistoryRow) => {
    setDeleting(null);
    mark(row.session_id, true);
    setProblem(null);
    const error = await dispatch(deleteSessionById(row.session_id));
    mark(row.session_id, false);
    if (error !== null) setProblem({ id: row.session_id, error });
  };

  const runBackup = async () => {
    setAdminError(null);
    const result = await backup(null);
    if ("error" in result) setAdminError(toApiError(result.error));
    else setLastBackup(result.data);
  };

  const runRebuild = async () => {
    setAdminError(null);
    const result = await rebuild();
    if ("error" in result) setAdminError(toApiError(result.error));
  };

  const statusOptions: SelectOption[] = [
    { value: ALL, label: messagePair("history.allStatuses") },
    ...STATUSES.map((status) => ({
      value: status,
      label: labelOf(labels, "statuses", status) ?? { ar: status, en: status },
    })),
  ];
  const indexOptions: SelectOption[] = [
    { value: ALL, label: messagePair("history.allIndexStates") },
    ...INDEX_STATES.map((state) => ({ value: state, label: indexStateLabel(state) })),
  ];
  const sortOptions: SelectOption<HistorySort>[] = SORTS.map((sort) => ({
    value: sort,
    label: messagePair(`history.sorts.${sort}`),
  }));

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const rows = list.data?.items ?? [];

  return (
    <div className="grid items-start gap-5 p-5 2xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="text-2xl font-semibold">
          <Bi {...messagePair("history.title")} />
        </h1>
        <div className="flex flex-wrap items-end gap-3">
          <SearchField value={query.q} onSearch={(q) => dispatch(historyQueryChanged({ q }))} />
          <Field label={messagePair("history.status")} className="w-44">
            <Select
              value={query.status ?? ALL}
              options={statusOptions}
              onValueChange={(value) =>
                dispatch(
                  historyQueryChanged({ status: value === ALL ? null : (value as HistoryStatus) }),
                )
              }
            />
          </Field>
          <Field label={messagePair("history.indexState")} className="w-44">
            <Select
              value={query.indexState ?? ALL}
              options={indexOptions}
              onValueChange={(value) =>
                dispatch(
                  historyQueryChanged({
                    indexState: value === ALL ? null : (value as HistoryIndexState),
                  }),
                )
              }
            />
          </Field>
          <Field label={messagePair("history.sort")} className="w-52">
            <Select<HistorySort>
              value={query.sort}
              options={sortOptions}
              onValueChange={(sort) => dispatch(historyQueryChanged({ sort }))}
            />
          </Field>
        </div>
        {problem ? (
          <ErrorPanel
            error={problem.error}
            context={messagePair("history.actionFailed")}
            actions={<Ltr className="font-mono text-xs">{problem.id}</Ltr>}
          />
        ) : null}
        {list.error ? (
          <ErrorPanel error={toApiError(list.error)} onRetry={() => void list.refetch()} />
        ) : null}
        {list.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-ink-secondary" role="status">
            <Spinner size="sm" />
            <Bi {...messagePair("history.loading")} />
          </p>
        ) : null}
        {list.data && rows.length === 0 ? (
          <EmptyState
            icon={query.q || query.status || query.indexState ? Search : HistoryIcon}
            title={messagePair(
              query.q || query.status || query.indexState ? "history.noMatch" : "history.empty",
            )}
          />
        ) : null}
        {rows.length > 0 ? (
          <HistoryTable
            rows={rows}
            assetUrl={assetUrl}
            busyIds={busy}
            onOpen={(row) => void open(row)}
            onReopen={(row) => void reopen(row)}
            onDelete={setDeleting}
          />
        ) : null}
        {total > HISTORY_PAGE_SIZE ? (
          <div className="flex items-center justify-end gap-2 text-sm">
            <IconButton
              icon={ChevronLeft}
              directional
              label={t("history.previousPage")}
              disabled={query.page === 0}
              onClick={() => dispatch(historyPageChanged(query.page - 1))}
            />
            <span className="text-ink-secondary">
              <Num value={query.page + 1} /> / <Num value={pages} />
            </span>
            <IconButton
              icon={ChevronRight}
              directional
              label={t("history.nextPage")}
              disabled={query.page + 1 >= pages}
              onClick={() => dispatch(historyPageChanged(query.page + 1))}
            />
          </div>
        ) : null}
      </div>
      <HistoryAdminPanel
        stats={stats.data ?? null}
        reconciled={list.data?.reconciled ?? null}
        lastBackup={lastBackup}
        busy={backupState.isLoading ? "backup" : rebuildState.isLoading ? "rebuild" : null}
        error={adminError ?? (stats.error ? toApiError(stats.error) : null)}
        onBackup={() => void runBackup()}
        onRebuild={() => void runRebuild()}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(openNow) => {
          if (!openNow) setDeleting(null);
        }}
        title={messagePair("history.deleteTitle")}
        description={messagePair("history.deleteDescription")}
        confirmLabel={messagePair("history.delete")}
        tone="danger"
        onConfirm={() => {
          if (deleting !== null) void remove(deleting);
        }}
      >
        {deleting !== null ? (
          <p className="flex flex-col text-sm">
            {deleting.camel_id ? <bdi dir="auto">{deleting.camel_id}</bdi> : null}
            <Ltr className="font-mono text-xs text-ink-muted">{deleting.session_id}</Ltr>
          </p>
        ) : null}
      </ConfirmDialog>
      {dialog}
    </div>
  );
}
