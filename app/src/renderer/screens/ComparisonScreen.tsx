/**
 * One comparison (#/comparisons/:id, D12 F2). The engine's view, read again whenever the screen
 * mounts (whether it is out of date is computed from the member files on every read): the cover and
 * language, editable (a change writes the next comparison data version; a sealed PDF then shows an
 * earlier cover and must be printed again); the camels in print order with, for each, its status
 * when compared and now, why it changed, its image's approval (sealed in a report, approved here,
 * or to approve on the engine's full image), and a link to its session. An out-of-date comparison
 * is never refreshed in place: "Compare again" opens the Compare dialog with the same order and
 * cover, naming the camels it had to leave out. Delete moves it to the trash (the sessions stay).
 * Printing and sealing the comparison, and its sealed PDF with "Save as": ComparisonReport.tsx.
 */
import {
  ArrowLeft,
  GitCompareArrows,
  ShieldCheck,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  useDeleteComparisonMutation,
  useGetComparisonQuery,
  usePatchComparisonInputsMutation,
} from "@/api/engineApi";
import { toApiError, type ApiErrorShape } from "@/api/errors";
import { constantOf } from "@/api/labels";
import type { ComparisonMember, ComparisonView } from "@/api/types";
import { CompareDialog } from "@/components/domain/CompareDialog";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { CodeLabel, useLabels } from "@/components/domain/labels";
import { MemberApprovalDialog } from "@/components/domain/MemberApprovalDialog";
import { ReportLanguagePicker } from "@/components/domain/ReportInputsForm";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge, Chip } from "@/components/ui/Chip";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Ltr } from "@/components/ui/Ltr";
import { Spinner } from "@/components/ui/Spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/Table";
import { STATUS_TONE, type SessionStatus } from "@/design";
import { messagePair } from "@/i18n/t";
import { formatDateTime } from "@/lib/format";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  approvalOf,
  memberApproved,
  type ComparisonLanguage,
  type CoverDraft,
} from "@/store/slices/comparisons";
import { prepareCompareAgain } from "@/store/thunks/comparisons";
import { ComparisonPrintCard, SealedComparison } from "./ComparisonReport";

const NAME_FIELDS = [
  ["event", "report.event"],
  ["judge", "report.judge"],
  ["council", "report.council"],
] as const;

const isStatus = (value: string | null | undefined): value is SessionStatus =>
  value !== null && value !== undefined && value in STATUS_TONE;

function StatusChip({ status }: { status: string | null | undefined }) {
  if (!isStatus(status)) {
    return (
      <Chip tone="danger">
        <Bi {...messagePair("comparison.deleted")} />
      </Chip>
    );
  }
  return (
    <Chip tone={STATUS_TONE[status]}>
      <CodeLabel group="statuses" code={status} />
    </Chip>
  );
}

function coverOf(view: ComparisonView): CoverDraft {
  const { title, event, judge, council } = view.cover;
  return { title, event, judge, council };
}

/** The cover and language form: a local draft, saved as one PATCH (the next model version). */
function CoverForm({
  view,
  onDirtyChange,
}: {
  view: ComparisonView;
  /** the draft differs from the saved cover (printing waits until it is saved) */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const labels = useLabels();
  const [patch, patchState] = usePatchComparisonInputsMutation();
  const [draft, setDraft] = useState<{ cover: CoverDraft; language: ComparisonLanguage }>(() => ({
    cover: coverOf(view),
    language: view.language,
  }));
  const [error, setError] = useState<ApiErrorShape | null>(null);
  const saved = coverOf(view);
  const changed =
    draft.language !== view.language ||
    (Object.keys(saved) as (keyof CoverDraft)[]).some((key) => draft.cover[key] !== saved[key]);
  useEffect(() => {
    onDirtyChange(changed);
  }, [changed, onDirtyChange]);
  const maxTitle = constantOf(labels, "COMPARISON_MAX_TITLE") ?? undefined;
  const maxName = constantOf(labels, "COMPARISON_MAX_NAME") ?? undefined;

  const save = async () => {
    setError(null);
    const cover = {
      title: draft.cover.title.trim(),
      event: draft.cover.event.trim(),
      judge: draft.cover.judge.trim(),
      council: draft.cover.council.trim(),
    };
    const result = await patch({
      id: view.comparison_id,
      body: { cover, language: draft.language },
    });
    if ("error" in result) setError(toApiError(result.error));
    else setDraft({ cover: coverOf(result.data), language: result.data.language });
  };

  return (
    <Card title={messagePair("compare.cover")} level={2} data-testid="comparison-cover">
      <Field label={messagePair("compare.coverTitle")}>
        <Input
          value={draft.cover.title}
          maxLength={maxTitle}
          dir="auto"
          onChange={(event) =>
            setDraft((d) => ({ ...d, cover: { ...d.cover, title: event.target.value } }))
          }
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        {NAME_FIELDS.map(([key, label]) => (
          <Field key={key} label={messagePair(label)}>
            <Input
              value={draft.cover[key]}
              maxLength={maxName}
              dir="auto"
              onChange={(event) =>
                setDraft((d) => ({ ...d, cover: { ...d.cover, [key]: event.target.value } }))
              }
            />
          </Field>
        ))}
      </div>
      <ReportLanguagePicker
        value={draft.language}
        onChange={(language) => setDraft((d) => ({ ...d, language }))}
      />
      <p className="text-xs text-ink-secondary">
        <Bi {...messagePair("comparison.coverHint")} />
      </p>
      {error !== null ? (
        <ErrorPanel error={error} context={messagePair("comparison.coverFailed")} />
      ) : null}
      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={!changed}
          loading={patchState.isLoading}
          onClick={() => void save()}
        >
          <Bi {...messagePair("comparison.saveCover")} />
        </Button>
      </div>
    </Card>
  );
}

function ApprovalState({ member, onApprove }: { member: ComparisonMember; onApprove: () => void }) {
  const approvals = useAppSelector((state) => state.comparisons.approvals);
  if (member.stale_reasons.length > 0) return <span className="text-ink-muted">{"—"}</span>;
  const state = approvalOf(approvals, {
    sessionId: member.session_id,
    approvedBySeal: member.approved_by_seal,
    overlay: member.overlay,
  });
  if (state === "needed") {
    return (
      <Button size="sm" onClick={onApprove}>
        <ShieldCheck aria-hidden="true" />
        <Bi {...messagePair("compare.approveImage")} />
      </Button>
    );
  }
  return (
    <Chip tone="success" icon={ShieldCheck}>
      <Bi {...messagePair(state === "seal" ? "compare.approvedBySeal" : "approval.approved")} />
    </Chip>
  );
}

function Members({ view }: { view: ComparisonView }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const approvals = useAppSelector((state) => state.comparisons.approvals);
  const [approving, setApproving] = useState<ComparisonMember | null>(null);
  const members = [...view.members].sort((a, b) => a.position - b.position);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">
        <Bi {...messagePair("comparison.members")} />
      </h2>
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>
              <Ltr>{"#"}</Ltr>
            </TableHeaderCell>
            <TableHeaderCell>
              <Bi {...messagePair("history.camel")} />
            </TableHeaderCell>
            <TableHeaderCell>
              <Bi {...messagePair("comparison.atCreation")} />
            </TableHeaderCell>
            <TableHeaderCell>
              <Bi {...messagePair("comparison.now")} />
            </TableHeaderCell>
            <TableHeaderCell>
              <Bi {...messagePair("comparison.image")} />
            </TableHeaderCell>
            <TableHeaderCell>
              <span className="sr-only">
                <Bi {...messagePair("history.actions")} />
              </span>
            </TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {members.map((member) => (
            <TableRow
              key={`${member.position}-${member.session_id}`}
              data-session={member.session_id}
              data-stale={member.stale_reasons.length > 0 || undefined}
            >
              <TableCell>
                <Ltr className="font-semibold">{`#${member.position}`}</Ltr>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  {member.camel_id ? (
                    <bdi dir="auto" className="self-start font-semibold">
                      {member.camel_id}
                    </bdi>
                  ) : (
                    <span className="text-ink-muted">
                      <Bi {...messagePair("history.noCamelId")} />
                    </span>
                  )}
                  <Ltr className="font-mono text-xs text-ink-muted">{member.session_id}</Ltr>
                  {member.stale_reasons.map((reason) => (
                    <span key={reason} className="text-xs text-warning-text">
                      <CodeLabel group="comparison_stale" code={reason} />
                    </span>
                  ))}
                  {member.notes.map((note) => (
                    <span key={note} className="text-xs text-ink-secondary">
                      <CodeLabel group="comparison_stale" code={note} />
                    </span>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <StatusChip status={member.status_at_creation} />
              </TableCell>
              <TableCell>
                <StatusChip status={member.current?.status} />
              </TableCell>
              <TableCell>
                <ApprovalState member={member} onApprove={() => setApproving(member)} />
              </TableCell>
              <TableCell>
                {member.current !== null ? (
                  <Button size="sm" onClick={() => void navigate(`/sessions/${member.session_id}`)}>
                    <SquareArrowOutUpRight aria-hidden="true" className="rtl:-scale-x-100" />
                    <Bi {...messagePair("comparison.openSession")} />
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {approving !== null ? (
        <MemberApprovalDialog
          open
          onOpenChange={(open) => {
            if (!open) setApproving(null);
          }}
          sessionId={approving.session_id}
          camelId={approving.camel_id}
          overlay={approving.overlay}
          approved={approvals[approving.session_id] ?? null}
          onApprove={(approval) => {
            dispatch(memberApproved({ sessionId: approving.session_id, ...approval }));
            setApproving(null);
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * One screen per comparison: going from one comparison to another (Compare again creates the next)
 * starts afresh, so no cover draft, dialog or error carries over to the other comparison.
 */
export function ComparisonScreen() {
  const { id = "" } = useParams();
  return <OneComparison key={id} id={id} />;
}

function OneComparison({ id }: { id: string }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const view = useGetComparisonQuery(id, { refetchOnMountOrArgChange: true });
  const again = useAppSelector((state) => state.comparisons);
  const [remove, removeState] = useDeleteComparisonMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [problem, setProblem] = useState<ApiErrorShape | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [coverDirty, setCoverDirty] = useState(false);
  const back = () => void navigate("/history?tab=comparisons");

  const compareAgain = async (current: ComparisonView) => {
    setProblem(null);
    setPreparing(true);
    const error = await dispatch(prepareCompareAgain(current));
    setPreparing(false);
    if (error !== null) setProblem(error);
  };

  const runDelete = async () => {
    setConfirmDelete(false);
    setProblem(null);
    const result = await remove(id);
    if ("error" in result && toApiError(result.error).status !== 404) {
      setProblem(toApiError(result.error));
      return;
    }
    back();
  };

  const data = view.data;
  const noneLeft =
    data !== undefined &&
    again.againFrom === data.comparison_id &&
    again.selection.length === 0 &&
    again.dropped.length > 0;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div>
        <Button size="sm" variant="ghost" onClick={back}>
          <ArrowLeft aria-hidden="true" className="rtl:-scale-x-100" />
          <Bi {...messagePair("comparison.backToList")} />
        </Button>
      </div>
      {view.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-ink-secondary" role="status">
          <Spinner size="sm" />
          <Bi {...messagePair("comparison.loading")} />
        </p>
      ) : null}
      {view.error ? (
        <ErrorPanel
          error={toApiError(view.error)}
          context={messagePair("comparison.loadFailed")}
          onRetry={() => void view.refetch()}
        />
      ) : null}
      {data !== undefined ? (
        <>
          <header className="flex flex-wrap items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h1 className="text-2xl font-semibold">
                {data.cover.title ? (
                  <bdi dir="auto">{data.cover.title}</bdi>
                ) : (
                  <Bi {...messagePair("comparisons.untitled")} />
                )}
              </h1>
              <p className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
                <Ltr className="font-mono">{data.comparison_id}</Ltr>
                <Ltr>{formatDateTime(data.created_at)}</Ltr>
                <Chip tone={data.status === "sealed" ? "success" : "neutral"}>
                  <CodeLabel group="comparison_statuses" code={data.status} />
                </Chip>
                {data.stale ? (
                  <Badge tone="warning">
                    <Bi {...messagePair("comparisons.stale")} />
                  </Badge>
                ) : null}
                {data.report_stale ? (
                  <Badge tone="warning">
                    <Bi {...messagePair("comparisons.reportStale")} />
                  </Badge>
                ) : null}
              </p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
                <Bi {...messagePair("comparison.modelVersion")} />
                <Ltr className="font-mono">
                  {`v${data.outputs.model.version} · ${data.outputs.model.sha256.slice(0, 12)}…`}
                </Ltr>
                {data.outputs.report ? (
                  <>
                    <span aria-hidden="true">{"·"}</span>
                    <Bi {...messagePair("comparison.sealedReport")} />
                    <Ltr className="font-mono">{`v${data.outputs.report.version}`}</Ltr>
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                loading={preparing}
                onClick={() => void compareAgain(data)}
                variant={data.stale ? "primary" : "secondary"}
              >
                <GitCompareArrows aria-hidden="true" />
                <Bi {...messagePair("comparison.compareAgain")} />
              </Button>
              <Button
                variant="ghost"
                className="text-danger-text"
                loading={removeState.isLoading}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden="true" />
                <Bi {...messagePair("history.delete")} />
              </Button>
            </div>
          </header>
          {problem !== null ? (
            <ErrorPanel error={problem} context={messagePair("comparisons.actionFailed")} />
          ) : null}
          {data.stale ? (
            <Alert tone="warning" title={messagePair("comparison.staleTitle")}>
              <Bi {...messagePair("comparison.staleExplain")} />
            </Alert>
          ) : null}
          {noneLeft ? (
            <Alert tone="warning" title={messagePair("compare.noneLeft")}>
              <ul className="flex flex-col gap-1 text-sm">
                {again.dropped.map((member) => (
                  <li key={member.sessionId} className="flex flex-wrap items-baseline gap-x-2">
                    {member.camelId ? <bdi dir="auto">{member.camelId}</bdi> : null}
                    <Ltr className="font-mono text-xs text-ink-muted">{member.sessionId}</Ltr>
                    <CodeLabel group={member.group} code={member.reason} />
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(20rem,30rem)]">
            <Members view={data} />
            <div className="flex flex-col gap-5">
              <CoverForm
                key={data.outputs.model.version}
                view={data}
                onDirtyChange={setCoverDirty}
              />
              <ComparisonPrintCard view={data} coverDirty={coverDirty} />
            </div>
          </div>
          <SealedComparison view={data} />
        </>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={messagePair("comparisons.deleteTitle")}
        description={messagePair("comparisons.deleteDescription")}
        confirmLabel={messagePair("history.delete")}
        tone="danger"
        onConfirm={() => void runDelete()}
      >
        <Ltr className="font-mono text-xs text-ink-muted">{id}</Ltr>
      </ConfirmDialog>
      <CompareDialog />
    </div>
  );
}
