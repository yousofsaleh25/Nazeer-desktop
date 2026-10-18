/**
 * History (#/history, C3.3): every saved session from the engine's derived index, which it
 * reconciles with the session folders on every list — a broken folder is a `corrupt` row, a
 * missing one "files missing", never hidden. Search (camel id, operator, notes, session id),
 * status, index state, sort, pages. Open continues or inspects a session; Reopen makes a sealed one
 * editable (its outputs become stale); Delete moves it to the trash after a confirmation. "Save PDF
 * as…" (D12) saves a copy of a sealed report where the operator chooses. The maintenance panel backs
 * up and rebuilds the index.
 *
 * D12 F2: two tabs (`?tab=comparisons` selects the second). Sessions also filters by event and
 * measuring dates, and ticks camels for a comparison (the engine says which rows may join and why
 * not; the ticks survive pages and filters); the bar below the list opens the Compare dialog. The
 * Comparisons tab lists the comparisons made. Deleting a session names the comparisons that hold it.
 */
import {
  ChevronLeft,
  ChevronRight,
  History as HistoryIcon,
  ListChecks,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { sessionReportFileName } from "@shared/fileNames";
import type { SavedCopyQuery } from "@shared/ipc";
import {
  useBackupHistoryMutation,
  useHistoryStatsQuery,
  useListSessionsQuery,
  useRebuildHistoryMutation,
} from "@/api/engineApi";
import { toApiError, type ApiErrorShape } from "@/api/errors";
import type { BackupOut, HistoryRow } from "@/api/types";
import { engineUrl } from "@/api/urls";
import { CompareBar } from "@/components/domain/CompareBar";
import { CompareDialog } from "@/components/domain/CompareDialog";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { HistoryAdminPanel } from "@/components/domain/HistoryAdminPanel";
import { HistoryTable } from "@/components/domain/HistoryTable";
import { SaveCopyPanel } from "@/components/domain/SaveCopyPanel";
import { constantOf, labelOf } from "@/api/labels";
import { useLabels } from "@/components/domain/labels";
import { Bi } from "@/components/ui/Bi";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Field";
import { Ltr, Num } from "@/components/ui/Ltr";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { indexStateLabel, messagePair, useT } from "@/i18n/t";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  compareDialogOpened,
  memberFromRow,
  membersAdded,
  memberToggled,
  selectionCleared,
  selectionRowsSeen,
} from "@/store/slices/comparisons";
import {
  HISTORY_PAGE_SIZE,
  historyFiltered,
  historyPageChanged,
  historyParams,
  historyQueryChanged,
  type HistoryIndexState,
  type HistorySort,
  type HistoryStatus,
} from "@/store/slices/history";
import { savedFileOf } from "@/store/slices/savedFiles";
import { deleteSessionById, reopenSessionById } from "@/store/thunks/history";
import { openSavedCopy, saveReportCopy } from "@/store/thunks/savedFiles";
import { ComparisonsTab } from "./ComparisonsTab";
import { SearchField } from "./SearchField";
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

type HistoryTab = "sessions" | "comparisons";

export function HistoryScreen() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab: HistoryTab = params.get("tab") === "comparisons" ? "comparisons" : "sessions";
  return (
    <div className="flex flex-col gap-4 p-5">
      <h1 className="text-2xl font-semibold">
        <Bi {...messagePair("history.title")} />
      </h1>
      <Tabs
        value={tab}
        onValueChange={(next) =>
          setParams(next === "comparisons" ? { tab: "comparisons" } : {}, { replace: true })
        }
      >
        <TabsList aria-label={t("nav.history")}>
          <TabsTrigger value="sessions">
            <Bi {...messagePair("history.tabSessions")} />
          </TabsTrigger>
          <TabsTrigger value="comparisons">
            <Bi {...messagePair("history.tabComparisons")} />
          </TabsTrigger>
        </TabsList>
        <TabsContent value="sessions">
          <SessionsTab />
        </TabsContent>
        <TabsContent value="comparisons">
          <ComparisonsTab />
        </TabsContent>
      </Tabs>
      <CompareDialog />
    </div>
  );
}

function SessionsTab() {
  const t = useT();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const labels = useLabels();
  const query = useAppSelector((state) => state.history);
  const connection = useAppSelector((state) => state.engine.connection);
  const selection = useAppSelector((state) => state.comparisons.selection);
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
  // the report a "Save PDF as…" was asked for last (its answer shows above the table)
  const [saving, setSaving] = useState<{ ref: SavedCopyQuery; camelId: string } | null>(null);
  const savingEntry = useAppSelector((state) =>
    saving === null ? null : savedFileOf(state.savedFiles, saving.ref),
  );
  const maxMembers = constantOf(labels, "COMPARISON_MAX_SESSIONS");

  // every list refreshes the picked camels it shows (one reopened meanwhile turns ineligible)
  const listed = list.data;
  useEffect(() => {
    if (listed !== undefined) dispatch(selectionRowsSeen(listed.items.map(memberFromRow)));
  }, [listed, dispatch]);

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

  const saveAs = (row: HistoryRow) => {
    const ref: SavedCopyQuery = {
      kind: "session",
      id: row.session_id,
      version: row.report_version,
    };
    setSaving({ ref, camelId: row.camel_id });
    const name = sessionReportFileName({
      camelId: row.camel_id,
      sessionId: row.session_id,
      createdAt: row.created_at,
      version: row.report_version,
    });
    void dispatch(saveReportCopy(ref, name));
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
  const filtered = historyFiltered(query);
  const selectedIds = new Set(selection.map((member) => member.sessionId));
  const full = maxMembers !== null && selection.length >= maxMembers;
  const selectable = rows.filter((r) => r.comparison.eligible && !selectedIds.has(r.session_id));

  return (
    <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <SearchField value={query.q} onSearch={(q) => dispatch(historyQueryChanged({ q }))} />
          <SearchField
            value={query.event}
            type="text"
            label={messagePair("report.event")}
            className="w-44"
            onSearch={(event) => dispatch(historyQueryChanged({ event }))}
          />
          <Field label={messagePair("history.createdFrom")} className="w-40">
            <Input
              type="date"
              value={query.createdFrom}
              max={query.createdTo || undefined}
              onChange={(event) =>
                dispatch(historyQueryChanged({ createdFrom: event.target.value }))
              }
            />
          </Field>
          <Field label={messagePair("history.createdTo")} className="w-40">
            <Input
              type="date"
              value={query.createdTo}
              min={query.createdFrom || undefined}
              onChange={(event) => dispatch(historyQueryChanged({ createdTo: event.target.value }))}
            />
          </Field>
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
        {saving !== null && savingEntry !== null ? (
          <div
            className="rounded-lg border border-border bg-surface-raised px-3.5 py-3"
            data-testid="history-save-copy"
          >
            <p className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm">
              {saving.camelId ? (
                <bdi dir="auto" className="font-semibold">
                  {saving.camelId}
                </bdi>
              ) : null}
              <Ltr className="font-mono text-xs text-ink-muted">{`${saving.ref.id} · v${saving.ref.version}`}</Ltr>
            </p>
            <SaveCopyPanel
              entry={savingEntry}
              onSave={() => {
                const row = rows.find((r) => r.session_id === saving.ref.id);
                if (row !== undefined) saveAs(row);
              }}
              onOpen={() => void dispatch(openSavedCopy(saving.ref, "open"))}
              onShow={() => void dispatch(openSavedCopy(saving.ref, "show"))}
            />
          </div>
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
            icon={filtered ? Search : HistoryIcon}
            title={messagePair(filtered ? "history.noMatch" : "history.empty")}
          />
        ) : null}
        {rows.length > 0 ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              disabled={full || selectable.length === 0}
              onClick={() =>
                dispatch(membersAdded({ members: selectable.map(memberFromRow), max: maxMembers }))
              }
            >
              <ListChecks aria-hidden="true" />
              <Bi {...messagePair("history.selectAllShown")} />
            </Button>
          </div>
        ) : null}
        {rows.length > 0 ? (
          <HistoryTable
            rows={rows}
            assetUrl={assetUrl}
            busyIds={busy}
            onOpen={(row) => void open(row)}
            onReopen={(row) => void reopen(row)}
            onDelete={setDeleting}
            onSaveAs={saveAs}
            selection={{
              selectedIds,
              full,
              onToggle: (row) =>
                dispatch(memberToggled({ member: memberFromRow(row), max: maxMembers })),
            }}
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
        <CompareBar
          count={selection.length}
          max={maxMembers}
          onClear={() => dispatch(selectionCleared())}
          onCompare={() => dispatch(compareDialogOpened())}
        />
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
        {deleting !== null && deleting.n_comparisons > 0 ? (
          <p className="text-sm text-warning-text" data-testid="delete-in-comparisons">
            <Bi {...messagePair("history.inComparisons")} /> <Num value={deleting.n_comparisons} />
          </p>
        ) : null}
      </ConfirmDialog>
      {dialog}
    </div>
  );
}
