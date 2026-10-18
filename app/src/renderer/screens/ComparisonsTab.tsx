/**
 * History's Comparisons tab (D12 F2): the comparisons made, from the engine's index (reconciled on
 * every list; whether each is out of date is computed by the engine from the sessions). Search
 * (title, event, judge, council, camel id), status, out of date or not, order (date or title), pages.
 * Open shows #/comparisons/:id; "Save PDF as…" saves a copy of a sealed comparison (D12 F1); Delete
 * moves the comparison to the trash after a confirmation — the camels' sessions stay.
 */
import { ChevronLeft, ChevronRight, GitCompareArrows, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { comparisonReportFileName } from "@shared/fileNames";
import type { SavedCopyQuery } from "@shared/ipc";
import { useDeleteComparisonMutation, useListComparisonsQuery } from "@/api/engineApi";
import { toApiError, type ApiErrorShape } from "@/api/errors";
import { labelOf } from "@/api/labels";
import type { ComparisonRow } from "@/api/types";
import { ComparisonTable } from "@/components/domain/ComparisonTable";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { useLabels } from "@/components/domain/labels";
import { SaveCopyPanel } from "@/components/domain/SaveCopyPanel";
import { Bi } from "@/components/ui/Bi";
import { IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Ltr, Num } from "@/components/ui/Ltr";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { useLanguage } from "@/design/language";
import { messagePair, useT } from "@/i18n/t";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  COMPARISONS_PAGE_SIZE,
  comparisonsPageChanged,
  comparisonsParams,
  comparisonsQueryChanged,
  type ComparisonSort,
  type ComparisonStatus,
} from "@/store/slices/comparisons";
import { savedFileOf } from "@/store/slices/savedFiles";
import { openSavedCopy, saveReportCopy } from "@/store/thunks/savedFiles";
import { SearchField } from "./SearchField";

const ALL = "all";
const STATUSES: readonly ComparisonStatus[] = ["created", "sealed"];
const SORTS: readonly ComparisonSort[] = [
  "created_desc",
  "created_asc",
  "updated_desc",
  "title_asc",
];

export function ComparisonsTab() {
  const t = useT();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const labels = useLabels();
  const query = useAppSelector((state) => state.comparisons.query);
  const list = useListComparisonsQuery(comparisonsParams(query), {
    refetchOnMountOrArgChange: true,
  });
  const [remove] = useDeleteComparisonMutation();
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ComparisonRow | null>(null);
  const [problem, setProblem] = useState<{ id: string; error: ApiErrorShape } | null>(null);
  const { lang } = useLanguage();
  const [saving, setSaving] = useState<{ ref: SavedCopyQuery; row: ComparisonRow } | null>(null);
  const savingEntry = useAppSelector((state) =>
    saving === null ? null : savedFileOf(state.savedFiles, saving.ref),
  );

  const saveAs = (row: ComparisonRow) => {
    const ref: SavedCopyQuery = {
      kind: "comparison",
      id: row.comparison_id,
      version: row.report_version,
    };
    setSaving({ ref, row });
    const name = comparisonReportFileName({
      members: row.n_members,
      createdAt: row.created_at,
      version: row.report_version,
      lang,
    });
    void dispatch(saveReportCopy(ref, name));
  };

  const runDelete = async (row: ComparisonRow) => {
    setDeleting(null);
    setProblem(null);
    setBusy(row.comparison_id);
    const result = await remove(row.comparison_id);
    setBusy(null);
    if ("error" in result) {
      const error = toApiError(result.error);
      // already gone is what was asked
      if (error.status !== 404) setProblem({ id: row.comparison_id, error });
    }
  };

  const statusOptions: SelectOption[] = [
    { value: ALL, label: messagePair("history.allStatuses") },
    ...STATUSES.map((status) => ({
      value: status,
      label: labelOf(labels, "comparison_statuses", status) ?? { ar: status, en: status },
    })),
  ];
  const staleOptions: SelectOption[] = [
    { value: ALL, label: messagePair("history.allIndexStates") },
    { value: "stale", label: messagePair("comparisons.staleOnly") },
    { value: "current", label: messagePair("comparisons.currentOnly") },
  ];
  const sortOptions: SelectOption<ComparisonSort>[] = SORTS.map((sort) => ({
    value: sort,
    label: messagePair(`comparisons.sorts.${sort}`),
  }));

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / COMPARISONS_PAGE_SIZE));
  const rows = list.data?.items ?? [];
  const filtered = Boolean(query.q.trim() || query.status || query.stale !== null);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <SearchField
          value={query.q}
          label={messagePair("comparisons.search")}
          onSearch={(q) => dispatch(comparisonsQueryChanged({ q }))}
        />
        <Field label={messagePair("history.status")} className="w-44">
          <Select
            value={query.status ?? ALL}
            options={statusOptions}
            onValueChange={(value) =>
              dispatch(
                comparisonsQueryChanged({
                  status: value === ALL ? null : (value as ComparisonStatus),
                }),
              )
            }
          />
        </Field>
        <Field label={messagePair("comparisons.staleFilter")} className="w-44">
          <Select
            value={query.stale === null ? ALL : query.stale ? "stale" : "current"}
            options={staleOptions}
            onValueChange={(value) =>
              dispatch(comparisonsQueryChanged({ stale: value === ALL ? null : value === "stale" }))
            }
          />
        </Field>
        <Field label={messagePair("history.sort")} className="w-52">
          <Select<ComparisonSort>
            value={query.sort}
            options={sortOptions}
            onValueChange={(sort) => dispatch(comparisonsQueryChanged({ sort }))}
          />
        </Field>
      </div>
      {problem ? (
        <ErrorPanel
          error={problem.error}
          context={messagePair("comparisons.actionFailed")}
          actions={<Ltr className="font-mono text-xs">{problem.id}</Ltr>}
        />
      ) : null}
      {saving !== null && savingEntry !== null ? (
        <div
          className="rounded-lg border border-border bg-surface-raised px-3.5 py-3"
          data-testid="comparisons-save-copy"
        >
          <p className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm">
            {saving.row.title ? (
              <bdi dir="auto" className="font-semibold">
                {saving.row.title}
              </bdi>
            ) : null}
            <Ltr className="font-mono text-xs text-ink-muted">{`${saving.ref.id} · v${saving.ref.version}`}</Ltr>
          </p>
          <SaveCopyPanel
            entry={savingEntry}
            onSave={() => saveAs(saving.row)}
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
          <Bi {...messagePair("comparisons.loading")} />
        </p>
      ) : null}
      {list.data && rows.length === 0 ? (
        <EmptyState
          icon={filtered ? Search : GitCompareArrows}
          title={messagePair(filtered ? "comparisons.noMatch" : "comparisons.empty")}
        />
      ) : null}
      {rows.length > 0 ? (
        <ComparisonTable
          rows={rows}
          busyIds={busy === null ? undefined : new Set([busy])}
          onOpen={(row) => void navigate(`/comparisons/${row.comparison_id}`)}
          onDelete={setDeleting}
          onSaveAs={saveAs}
        />
      ) : null}
      {total > COMPARISONS_PAGE_SIZE ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <IconButton
            icon={ChevronLeft}
            directional
            label={t("history.previousPage")}
            disabled={query.page === 0}
            onClick={() => dispatch(comparisonsPageChanged(query.page - 1))}
          />
          <span className="text-ink-secondary">
            <Num value={query.page + 1} /> / <Num value={pages} />
          </span>
          <IconButton
            icon={ChevronRight}
            directional
            label={t("history.nextPage")}
            disabled={query.page + 1 >= pages}
            onClick={() => dispatch(comparisonsPageChanged(query.page + 1))}
          />
        </div>
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(openNow) => {
          if (!openNow) setDeleting(null);
        }}
        title={messagePair("comparisons.deleteTitle")}
        description={messagePair("comparisons.deleteDescription")}
        confirmLabel={messagePair("history.delete")}
        tone="danger"
        onConfirm={() => {
          if (deleting !== null) void runDelete(deleting);
        }}
      >
        {deleting !== null ? (
          <p className="flex flex-col text-sm">
            {deleting.title ? <bdi dir="auto">{deleting.title}</bdi> : null}
            <Ltr className="font-mono text-xs text-ink-muted">{deleting.comparison_id}</Ltr>
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
