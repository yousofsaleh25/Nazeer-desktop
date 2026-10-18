/**
 * The Compare dialog (D12 F2): the ticked camels in the operator's order — dragged by the handle, or
 * moved with the ▲ / ▼ buttons from the keyboard; nothing here sorts by a value —, each with its
 * image's approval (Q1: sealed in a report from the current image, approved here, or to approve on
 * the engine's full image); the cover (title, event, judge, council: printed as typed) and the
 * language; then Create, which asks the engine to make the comparison — it re-checks every camel
 * from its files and refuses the whole request naming each camel it refused. A created comparison
 * opens at #/comparisons/:id. "Compare again" opens this dialog with the old order and cover and
 * names the camels it had to leave out.
 */
import { ArrowDown, ArrowUp, GripVertical, ShieldCheck, X } from "lucide-react";
import { useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { useCreateComparisonMutation } from "@/api/engineApi";
import { isRecord, toApiError, type ApiErrorShape } from "@/api/errors";
import { constantOf } from "@/api/labels";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Ltr, Num } from "@/components/ui/Ltr";
import { messagePair, useT } from "@/i18n/t";
import { cn } from "@/lib/cn";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  approvalOf,
  compareDialogClosed,
  comparisonCreated,
  coverBody,
  coverChanged,
  languageChanged,
  memberApproved,
  memberMoved,
  memberRemoved,
  readyToCreate,
  type SelectedMember,
} from "@/store/slices/comparisons";
import { ErrorPanel } from "./ErrorPanel";
import { CodeLabel, useLabels } from "./labels";
import { MemberApprovalDialog } from "./MemberApprovalDialog";
import { ReportLanguagePicker } from "./ReportInputsForm";

const NAME_FIELDS = [
  ["event", "report.event"],
  ["judge", "report.judge"],
  ["council", "report.council"],
] as const;

interface RefusedMember {
  position: number;
  sessionId: string;
  reason: string;
}

/** `details.members` of a refused create (each camel the engine refused, with its reason). */
export function refusedMembers(error: ApiErrorShape): RefusedMember[] {
  const raw = error.details["members"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): RefusedMember[] =>
    isRecord(item) &&
    typeof item["position"] === "number" &&
    typeof item["session_id"] === "string" &&
    typeof item["reason"] === "string"
      ? [{ position: item["position"], sessionId: item["session_id"], reason: item["reason"] }]
      : [],
  );
}

function ApprovalCell({ member, onApprove }: { member: SelectedMember; onApprove: () => void }) {
  const approvals = useAppSelector((state) => state.comparisons.approvals);
  if (!member.eligible) {
    return (
      <span className="text-xs text-danger-text" data-ineligible={member.reason ?? ""}>
        <Bi {...messagePair("history.cannotCompare")} />{" "}
        {member.reason ? <CodeLabel group="comparison_ineligible" code={member.reason} /> : null}
      </span>
    );
  }
  const state = approvalOf(approvals, member);
  if (state === "seal") {
    return (
      <Chip tone="success" icon={ShieldCheck}>
        <Bi {...messagePair("compare.approvedBySeal")} />
      </Chip>
    );
  }
  if (state === "approved") {
    return (
      <Chip tone="success" icon={ShieldCheck}>
        <Bi {...messagePair("approval.approved")} />{" "}
        <Ltr>{`v${member.overlay?.version ?? ""}`}</Ltr>
      </Chip>
    );
  }
  return (
    <Button size="sm" onClick={onApprove} disabled={member.overlay === null}>
      <ShieldCheck aria-hidden="true" />
      <Bi {...messagePair("compare.approveImage")} />
    </Button>
  );
}

export function CompareDialog() {
  const t = useT();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const labels = useLabels();
  const state = useAppSelector((root) => root.comparisons);
  const [create, createState] = useCreateComparisonMutation();
  const [error, setError] = useState<ApiErrorShape | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const max = constantOf(labels, "COMPARISON_MAX_SESSIONS");
  const maxTitle = constantOf(labels, "COMPARISON_MAX_TITLE") ?? undefined;
  const maxName = constantOf(labels, "COMPARISON_MAX_NAME") ?? undefined;
  const { selection, cover, language, approvals, dropped } = state;
  const ready = readyToCreate(state, max);
  const needsApproval = selection.some(
    (member) => member.eligible && approvalOf(approvals, member) === "needed",
  );
  const approvingMember = selection.find((member) => member.sessionId === approving) ?? null;

  const close = () => {
    setError(null);
    dispatch(compareDialogClosed());
  };

  const submit = async () => {
    setError(null);
    const result = await create({
      session_ids: selection.map((member) => member.sessionId),
      cover: coverBody(cover),
      language,
    });
    if ("error" in result) {
      setError(toApiError(result.error));
      return;
    }
    dispatch(comparisonCreated());
    void navigate(`/comparisons/${result.data.comparison_id}`);
  };

  const dropOn = (event: DragEvent, to: number) => {
    event.preventDefault();
    if (dragging !== null) dispatch(memberMoved({ sessionId: dragging, to }));
    setDragging(null);
  };

  const refused = error === null ? [] : refusedMembers(error);

  return (
    <Dialog
      open={state.dialogOpen && selection.length > 0}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      size="lg"
      title={messagePair("compare.title")}
      description={messagePair("compare.description")}
      footer={
        <>
          {needsApproval ? (
            <p className="me-auto text-xs text-ink-secondary">
              <Bi {...messagePair("compare.needsApproval")} />
            </p>
          ) : null}
          <Button variant="secondary" onClick={close}>
            <Bi {...messagePair("common.cancel")} />
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            loading={createState.isLoading}
            onClick={() => void submit()}
          >
            <Bi {...messagePair("compare.create")} />
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5" data-testid="compare-dialog">
        {dropped.length > 0 ? (
          <Alert tone="warning" title={messagePair("compare.dropped")}>
            <ul className="flex flex-col gap-1 text-sm">
              {dropped.map((member) => (
                <li key={member.sessionId} className="flex flex-wrap items-baseline gap-x-2">
                  {member.camelId ? <bdi dir="auto">{member.camelId}</bdi> : null}
                  <Ltr className="font-mono text-xs text-ink-muted">{member.sessionId}</Ltr>
                  <CodeLabel group={member.group} code={member.reason} />
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            <Bi {...messagePair("compare.order")} />
          </h3>
          <ol className="flex flex-col gap-1.5" aria-label={t("compare.order")}>
            {selection.map((member, index) => (
              <li
                key={member.sessionId}
                data-session={member.sessionId}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", member.sessionId);
                  setDragging(member.sessionId);
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropOn(event, index)}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5",
                  dragging === member.sessionId && "opacity-50",
                  !member.eligible && "border-danger-border",
                )}
              >
                <span
                  className="cursor-grab text-ink-muted"
                  title={t("compare.drag")}
                  aria-hidden="true"
                >
                  <GripVertical className="size-4" />
                </span>
                <span className="w-8 shrink-0 text-sm font-semibold">
                  <Ltr>{"#"}</Ltr>
                  <Num value={index + 1} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  {member.camelId ? (
                    <bdi dir="auto" className="self-start truncate font-semibold">
                      {member.camelId}
                    </bdi>
                  ) : (
                    <span className="text-ink-muted">
                      <Bi {...messagePair("history.noCamelId")} />
                    </span>
                  )}
                  <Ltr className="font-mono text-xs text-ink-muted">{member.sessionId}</Ltr>
                </span>
                <ApprovalCell member={member} onApprove={() => setApproving(member.sessionId)} />
                <span className="flex items-center gap-0.5">
                  <IconButton
                    icon={ArrowUp}
                    size="icon-sm"
                    label={t("compare.moveUp")}
                    disabled={index === 0}
                    onClick={() =>
                      dispatch(memberMoved({ sessionId: member.sessionId, to: index - 1 }))
                    }
                  />
                  <IconButton
                    icon={ArrowDown}
                    size="icon-sm"
                    label={t("compare.moveDown")}
                    disabled={index === selection.length - 1}
                    onClick={() =>
                      dispatch(memberMoved({ sessionId: member.sessionId, to: index + 1 }))
                    }
                  />
                  <IconButton
                    icon={X}
                    size="icon-sm"
                    label={t("compare.remove")}
                    onClick={() => dispatch(memberRemoved(member.sessionId))}
                  />
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">
            <Bi {...messagePair("compare.cover")} />
          </h3>
          <Field label={messagePair("compare.coverTitle")} hint={messagePair("compare.coverHint")}>
            <Input
              value={cover.title}
              maxLength={maxTitle}
              dir="auto"
              onChange={(event) => dispatch(coverChanged({ title: event.target.value }))}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            {NAME_FIELDS.map(([key, label]) => (
              <Field key={key} label={messagePair(label)}>
                <Input
                  value={cover[key]}
                  maxLength={maxName}
                  dir="auto"
                  onChange={(event) => dispatch(coverChanged({ [key]: event.target.value }))}
                />
              </Field>
            ))}
          </div>
          <ReportLanguagePicker
            value={language}
            onChange={(next) => dispatch(languageChanged(next))}
          />
        </section>

        {error !== null ? (
          <div className="flex flex-col gap-2">
            <ErrorPanel error={error} context={messagePair("compare.createFailed")} />
            {refused.length > 0 ? (
              <div className="rounded-md border border-border px-3 py-2 text-sm">
                <p className="mb-1 font-medium">
                  <Bi {...messagePair("compare.refused")} />
                </p>
                <ul className="flex flex-col gap-1" data-testid="compare-refused">
                  {refused.map((member) => (
                    <li key={member.sessionId} className="flex flex-wrap items-baseline gap-x-2">
                      <Ltr>{"#"}</Ltr>
                      <Num value={member.position} />
                      <Ltr className="font-mono text-xs text-ink-muted">{member.sessionId}</Ltr>
                      <CodeLabel group="comparison_ineligible" code={member.reason} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {approvingMember !== null && approvingMember.overlay !== null ? (
        <MemberApprovalDialog
          open
          onOpenChange={(open) => {
            if (!open) setApproving(null);
          }}
          sessionId={approvingMember.sessionId}
          camelId={approvingMember.camelId}
          overlay={approvingMember.overlay}
          approved={approvals[approvingMember.sessionId] ?? null}
          onApprove={(approval) => {
            dispatch(memberApproved({ sessionId: approvingMember.sessionId, ...approval }));
            setApproving(null);
          }}
        />
      ) : null}
    </Dialog>
  );
}
