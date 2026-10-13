/**
 * The report (#/sessions/:id/report): the report's explicit inputs (D7 — language, scoring form,
 * judge / council / event, observations; the form's labels and options come from the engine's
 * report model), printing and sealing (ADR-D7: main lays the print page out from the report model
 * and the approved overlay bytes in a hidden window, prints it, and the engine probes and seals
 * the PDF — or refuses it, with its probe), and the sealed PDF — downloaded, its SHA-256 checked
 * against the engine's stamp, shown with pdf.js, with the checks the engine ran when it sealed it.
 */
import { ArrowLeft, CircleCheck, Printer, Save, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { PRINT_REPORT_MODEL_VERSION, type PreflightProblem } from "@shared/ipc";
import { useEngineJson, useVerifiedEngineBytes, type LoadedJson } from "@/api/assets";
import type { ApiErrorShape } from "@/api/errors";
import { reportFormContent } from "@/api/reportModel";
import type { ReportInputs } from "@/api/types";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { CodeLabel } from "@/components/domain/labels";
import { PdfViewer } from "@/components/domain/PdfViewer";
import { ProbeReport } from "@/components/domain/ProbeReport";
import { ReportInputsForm } from "@/components/domain/ReportInputsForm";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Ltr } from "@/components/ui/Ltr";
import { Spinner } from "@/components/ui/Spinner";
import { STATUS_TONE } from "@/design";
import { errorLabel, messagePair } from "@/i18n/t";
import { isRecord } from "@/lib/read";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { sameValue } from "@/store/session/document";
import { approvalHolds } from "@/store/slices/report";
import { exportReport, updateReportInputs, type ReportInputsPatch } from "@/store/thunks/session";
import { SessionGate, type LoadedSession } from "./session/SessionGate";

export function ReportScreen() {
  const { id = "" } = useParams();
  return (
    <SessionGate id={id}>
      {(session) => <ReportWorkspace key={session.id} session={session} />}
    </SessionGate>
  );
}

/** The patch that turns `from` into `to` (only what changed). */
export function inputsPatch(from: ReportInputs, to: ReportInputs): ReportInputsPatch {
  const patch: ReportInputsPatch = {};
  if (from.language !== to.language) patch.language = to.language;
  if (from.rubric_variant !== to.rubric_variant) patch.rubric_variant = to.rubric_variant;
  if (!sameValue(from.names, to.names)) patch.names = { ...to.names };
  if (!sameValue(from.observations, to.observations)) patch.observations = { ...to.observations };
  return patch;
}

function trimmed(inputs: ReportInputs): ReportInputs {
  const trim = (record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value.trim()]));
  return { ...inputs, names: trim(inputs.names), observations: trim(inputs.observations) };
}

/** The report inputs the operator is editing and what saving them would change. */
function inputsEdit(view: LoadedSession["view"], edited: ReportInputs | null) {
  const value = edited ?? view.report_inputs;
  const patch = inputsPatch(view.report_inputs, trimmed(value));
  return { value, patch, dirty: Object.keys(patch).length > 0 };
}

/** The print for this session is running (its inputs are frozen until it ends). */
function usePrinting(sessionId: string): boolean {
  return useAppSelector(
    (state) =>
      state.report.export?.sessionId === sessionId && state.report.export.state === "printing",
  );
}

function ReportInputsCard({
  session,
  loaded,
  edited,
  onEdit,
}: {
  session: LoadedSession;
  loaded: LoadedJson;
  edited: ReportInputs | null;
  onEdit: (inputs: ReportInputs | null) => void;
}) {
  const dispatch = useAppDispatch();
  const { view } = session;
  const model = view.outputs.report_model ?? null;
  const content = loaded.state === "ready" ? reportFormContent(loaded.data) : null;
  const printing = usePrinting(session.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiErrorShape | null>(null);
  const { value, patch, dirty } = inputsEdit(view, edited);

  const save = async () => {
    setSaving(true);
    setError(null);
    const failure = await dispatch(updateReportInputs(patch));
    setSaving(false);
    if (failure === null) onEdit(null);
    else setError(failure);
  };

  return (
    <Card
      title={messagePair("report.inputsTitle")}
      level={2}
      actions={
        <Button
          variant="primary"
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || content === null || printing}
          loading={saving}
        >
          <Save aria-hidden="true" />
          <Bi {...messagePair("report.saveInputs")} />
        </Button>
      }
    >
      {model === null ? (
        <p className="text-sm text-ink-secondary">
          <Bi {...messagePair("report.finalizeFirst")} />
        </p>
      ) : loaded.state === "loading" ? (
        <p className="flex items-center gap-2 text-sm text-ink-secondary" role="status">
          <Spinner size="sm" />
          <Bi {...messagePair("report.loadingModel")} />
        </p>
      ) : loaded.state === "error" ? (
        <ErrorPanel error={loaded.error} context={messagePair("report.modelFailed")} />
      ) : content === null ? (
        <Alert tone="danger" title={messagePair("report.modelUnreadable")} />
      ) : (
        <ReportInputsForm
          value={value}
          content={content}
          onChange={onEdit}
          disabled={saving || printing}
        />
      )}
      {model !== null ? (
        <p className="text-xs text-ink-muted">
          <Bi {...messagePair("report.modelVersion")} />{" "}
          <Ltr className="font-mono">{`v${model.version} · ${(model.sha256 ?? "").slice(0, 16)}`}</Ltr>
        </p>
      ) : null}
      {dirty ? (
        <p className="text-xs text-warning-text">
          <Bi {...messagePair("report.unsavedInputs")} />
        </p>
      ) : null}
      {error ? <ErrorPanel error={error} context={messagePair("report.saveFailed")} /> : null}
    </Card>
  );
}

function ProblemList({ problems }: { problems: readonly PreflightProblem[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {problems.map((problem, i) => {
        const label = errorLabel(problem.code);
        return (
          <li key={`${problem.code}-${i}`} data-code={problem.code} className="flex flex-col">
            <span className="font-medium">
              {label ? <Bi {...label} /> : <Ltr className="font-mono">{problem.code}</Ltr>}
            </span>
            <bdi dir="ltr" lang="en" className="text-xs text-ink-secondary">
              {problem.message}
            </bdi>
            {Object.keys(problem.details).length > 0 ? (
              <pre
                dir="ltr"
                className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-surface-raised p-2 font-mono text-[0.72rem] whitespace-pre-wrap"
              >
                {JSON.stringify(problem.details, null, 2)}
              </pre>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The report model the session names: is it the version this app's print page lays out? */
function modelSchema(loaded: LoadedJson): string | null {
  if (loaded.state !== "ready" || !isRecord(loaded.data)) return null;
  const version = loaded.data["report_model_version"];
  return typeof version === "string" ? version : null;
}

function PrintCard({
  session,
  loaded,
  inputsDirty,
}: {
  session: LoadedSession;
  loaded: LoadedJson;
  /** report details edited and not saved: a print now would carry the previous ones */
  inputsDirty: boolean;
}) {
  const dispatch = useAppDispatch();
  const reportState = useAppSelector((state) => state.report);
  const { view } = session;
  const sealed = view.status !== "open" && !view.outputs_stale;
  const approved = approvalHolds(reportState, view);
  const schema = modelSchema(loaded);
  const outdated = schema !== null && schema !== PRINT_REPORT_MODEL_VERSION;
  const job = reportState.export?.sessionId === session.id ? reportState.export : null;
  const printing = job?.state === "printing";
  const canPrint =
    sealed && approved && schema === PRINT_REPORT_MODEL_VERSION && !printing && !inputsDirty;
  const rejectedFile =
    job?.error !== null &&
    job?.error !== undefined &&
    typeof job.error.details["rejected_file"] === "string"
      ? job.error.details["rejected_file"]
      : null;
  const warnings = job?.preflight?.warnings ?? [];

  return (
    <Card title={messagePair("report.printTitle")} level={2}>
      <p className="text-sm text-ink-secondary">
        <Bi {...messagePair("report.printExplain")} />
      </p>
      {outdated ? (
        <Alert tone="warning" title={messagePair("report.modelOutdated")}>
          <Bi {...messagePair("report.modelOutdatedHint")} />{" "}
          <Ltr className="font-mono text-xs">{`${schema} → ${PRINT_REPORT_MODEL_VERSION}`}</Ltr>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={!canPrint}
          loading={printing}
          onClick={() => void dispatch(exportReport())}
        >
          <Printer aria-hidden="true" />
          <Bi {...messagePair(view.outputs.report ? "report.printAgain" : "report.print")} />
        </Button>
        {printing ? (
          <span className="flex items-center gap-2 text-sm text-ink-secondary" role="status">
            <Spinner size="sm" />
            <Bi {...messagePair("report.printing")} />
          </span>
        ) : inputsDirty ? (
          <span className="text-sm text-warning-text" data-testid="save-before-print">
            <Bi {...messagePair("report.saveBeforePrint")} />
          </span>
        ) : null}
      </div>
      {job?.state === "sealed" ? (
        <Alert tone="success" title={messagePair("report.sealed")}>
          <span className="inline-flex items-center gap-1.5">
            <CircleCheck aria-hidden="true" className="size-4" />
            <Bi {...messagePair("report.sealedExplain")} />
          </span>
        </Alert>
      ) : null}
      {job?.state === "failed" && job.error !== null ? (
        <ErrorPanel error={job.error} context={messagePair("report.printFailed")} />
      ) : null}
      {job?.state === "failed" && job.preflight !== null && job.preflight.problems.length > 0 ? (
        <Alert tone="danger" title={messagePair("report.printProblems")}>
          <ProblemList problems={job.preflight.problems} />
        </Alert>
      ) : null}
      {warnings.length > 0 ? (
        <Alert tone="warning" title={messagePair("report.printWarnings")}>
          <Bi {...messagePair("report.printWarningsHint")} />
          <ProblemList problems={warnings} />
        </Alert>
      ) : null}
      {job?.state === "failed" && job.probe !== null && job.probe !== undefined ? (
        <ProbeReport probe={job.probe} rejectedFile={rejectedFile} />
      ) : null}
    </Card>
  );
}

function SealedReport({ session }: { session: LoadedSession }) {
  const { view } = session;
  const report = view.outputs.report ?? null;
  const [retry, setRetry] = useState(0);
  const pdf = useVerifiedEngineBytes(report?.url ?? null, report?.sha256 ?? null, retry);
  // the manifest keeps its URL across prints: read it again for every sealed version (one read
  // at finalize time, before any print, would otherwise stay on screen without the probes)
  const manifest = useEngineJson(view.outputs.manifest_url ?? null, report?.version ?? 0);
  const probe =
    manifest.state === "ready" && isRecord(manifest.data) ? manifest.data["probes"] : undefined;
  if (report === null) {
    return (
      <Card title={messagePair("report.pdfTitle")} level={2}>
        <p className="text-sm text-ink-secondary">
          <Bi {...messagePair("pdf.none")} />
        </p>
      </Card>
    );
  }
  const stale = report.stale || view.report_stale;
  return (
    <Card title={messagePair("report.pdfTitle")} level={2}>
      {stale ? (
        <Alert tone="warning" title={messagePair("report.stale")}>
          <Bi {...messagePair("report.staleHint")} />
        </Alert>
      ) : null}
      {pdf.state === "error" ? (
        <ErrorPanel
          error={pdf.error}
          context={messagePair("report.pdfFailed")}
          onRetry={() => setRetry((n) => n + 1)}
        />
      ) : null}
      {pdf.state === "mismatch" ? (
        <Alert tone="danger" title={messagePair("report.pdfMismatch")}>
          <Ltr className="font-mono text-xs break-all">{pdf.computed}</Ltr>
        </Alert>
      ) : null}
      <PdfViewer
        data={pdf.state === "match" ? pdf.bytes : null}
        fileName={report.file}
        verified={pdf.state === "match"}
        className="h-[48rem]"
      />
      {probe !== undefined ? <ProbeReport probe={probe} /> : null}
    </Card>
  );
}

function ReportWorkspace({ session }: { session: LoadedSession }) {
  const reportState = useAppSelector((state) => state.report);
  const { view, draft } = session;
  const sealed = view.status !== "open";
  const approved = approvalHolds(reportState, view);
  const loaded = useEngineJson(view.outputs.report_model?.url ?? null);
  // shared by both cards: printing waits until edited report details are saved
  const [edited, setEdited] = useState<ReportInputs | null>(null);
  const { dirty } = inputsEdit(view, edited);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="ghost" asChild>
          <Link to={`/sessions/${session.id}`}>
            <ArrowLeft aria-hidden="true" className="rtl:-scale-x-100" />
            <Bi {...messagePair("finalize.backToMeasuring")} />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">
          <Bi {...messagePair("report.title")} />
        </h1>
        {draft.camelId ? <bdi dir="auto">{draft.camelId}</bdi> : null}
        <Ltr className="font-mono text-xs text-ink-muted">{session.id}</Ltr>
        <Chip tone={STATUS_TONE[view.status]}>
          <CodeLabel group="statuses" code={view.status} />
        </Chip>
      </div>
      {!sealed ? (
        <Alert tone="info" title={messagePair("report.notFinalized")}>
          <Link to={`/sessions/${session.id}/finalize`} className="underline">
            <Bi {...messagePair("session.finalize")} />
          </Link>
        </Alert>
      ) : !approved ? (
        <Alert tone="warning" title={messagePair("report.approveFirst")}>
          <Link
            to={`/sessions/${session.id}/finalize`}
            className="inline-flex items-center gap-1 underline"
          >
            <ShieldCheck aria-hidden="true" className="size-4" />
            <Bi {...messagePair("session.approval")} />
          </Link>
        </Alert>
      ) : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <ReportInputsCard session={session} loaded={loaded} edited={edited} onEdit={setEdited} />
          <PrintCard session={session} loaded={loaded} inputsDirty={dirty} />
        </div>
        <SealedReport session={session} />
      </div>
    </div>
  );
}
