/**
 * A comparison's print and its sealed PDF (D12 Stage 5), on #/comparisons/:id.
 *
 * Print and seal: main fetches each camel's approved image from the engine (checked against the
 * approval given in the app, or the engine's `approved_by_seal`), lays the comparison model out in
 * the hidden print window, prints it and has the engine probe and seal it — or refuse it, with its
 * probe. Printing waits until the comparison is current, every image approved and the cover saved.
 *
 * The sealed PDF: downloaded, its SHA-256 checked against the engine's stamp, shown with pdf.js with
 * the checks the engine ran (each camel's page). "Save as" writes a copy where the operator chooses;
 * after a print sealed here the Save dialog opens by itself once the viewer verified those bytes.
 */
import { CircleCheck, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { comparisonReportFileName } from "@shared/fileNames";
import type { SavedCopyQuery } from "@shared/ipc";
import { useEngineJson, useVerifiedEngineBytes } from "@/api/assets";
import type { ComparisonView } from "@/api/types";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { PdfViewer } from "@/components/domain/PdfViewer";
import { ProbeReport } from "@/components/domain/ProbeReport";
import { ProblemList } from "@/components/domain/ProblemList";
import { SaveCopyPanel } from "@/components/domain/SaveCopyPanel";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Ltr } from "@/components/ui/Ltr";
import { Spinner } from "@/components/ui/Spinner";
import { useLanguage } from "@/design/language";
import { messagePair, type MessageKey } from "@/i18n/t";
import { isRecord } from "@/lib/read";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { exportApprovals } from "@/store/slices/comparisons";
import { savedFileOf } from "@/store/slices/savedFiles";
import { useDropSaveOfferOnLeave } from "@/store/useDropSaveOffer";
import { exportComparisonReport } from "@/store/thunks/comparisons";
import {
  loadSavedCopy,
  openSavedCopy,
  saveReportCopy,
  takeSaveOffer,
} from "@/store/thunks/savedFiles";

/** Why the comparison cannot be printed now (the first reason), or null. */
function blockedBy(
  view: ComparisonView,
  approvalsReady: boolean,
  coverDirty: boolean,
): MessageKey | null {
  if (view.stale) return "comparison.printStale";
  if (!approvalsReady) return "comparison.approveAll";
  if (coverDirty) return "comparison.saveCoverFirst";
  return null;
}

export function ComparisonPrintCard({
  view,
  coverDirty,
}: {
  view: ComparisonView;
  /** the cover form has edits not saved yet: a print now would carry the previous cover */
  coverDirty: boolean;
}) {
  const dispatch = useAppDispatch();
  const approvals = useAppSelector((state) => state.comparisons.approvals);
  const job = useAppSelector((state) =>
    state.comparisons.export?.comparisonId === view.comparison_id ? state.comparisons.export : null,
  );
  const printing = job?.state === "printing";
  const blocked = blockedBy(view, exportApprovals(approvals, view.members) !== null, coverDirty);
  const rejectedFile =
    job?.error !== null &&
    job?.error !== undefined &&
    typeof job.error.details["rejected_file"] === "string"
      ? job.error.details["rejected_file"]
      : null;
  const warnings = job?.preflight?.warnings ?? [];

  return (
    <Card title={messagePair("report.printTitle")} level={2} data-testid="comparison-print">
      <p className="text-sm text-ink-secondary">
        <Bi {...messagePair("comparison.printExplain")} />
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={blocked !== null || printing}
          loading={printing}
          onClick={() => void dispatch(exportComparisonReport(view))}
        >
          <Printer aria-hidden="true" />
          <Bi {...messagePair(view.outputs.report ? "report.printAgain" : "comparison.print")} />
        </Button>
        {printing ? (
          <span className="flex items-center gap-2 text-sm text-ink-secondary" role="status">
            <Spinner size="sm" />
            <Bi {...messagePair("report.printing")} />
          </span>
        ) : blocked !== null ? (
          <span className="text-sm text-warning-text" data-testid="print-blocked">
            <Bi {...messagePair(blocked)} />
          </span>
        ) : null}
      </div>
      {job?.state === "sealed" ? (
        <Alert tone="success" title={messagePair("comparison.sealed")}>
          <span className="inline-flex items-center gap-1.5">
            <CircleCheck aria-hidden="true" className="size-4" />
            <Bi {...messagePair("comparison.sealedExplain")} />
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

/** "Save as" for the sealed comparison PDF this screen shows (D12 F1). */
function SaveComparisonCopy({
  view,
  version,
  verified,
}: {
  view: ComparisonView;
  version: number;
  verified: boolean;
}) {
  const dispatch = useAppDispatch();
  const { lang } = useLanguage();
  const id = view.comparison_id;
  const entry = useAppSelector((state) =>
    savedFileOf(state.savedFiles, { kind: "comparison", id, version }),
  );
  const offered = useAppSelector((state) => state.savedFiles.offer !== null);
  const fileName = comparisonReportFileName({
    members: view.n_members,
    createdAt: view.created_at,
    version,
    lang,
  });

  useEffect(() => {
    void dispatch(loadSavedCopy({ kind: "comparison", id, version }));
  }, [dispatch, id, version]);
  // a print sealed on this screen: the Save dialog opens once the viewer verified the bytes
  useEffect(() => {
    if (verified && offered) {
      void dispatch(takeSaveOffer({ kind: "comparison", id, version }, fileName));
    }
  }, [dispatch, verified, offered, id, version, fileName]);
  // leaving the screen drops the offer it did not take
  useDropSaveOfferOnLeave({ kind: "comparison", id, version });

  const ref: SavedCopyQuery = { kind: "comparison", id, version };
  return (
    <SaveCopyPanel
      entry={entry}
      onSave={() => void dispatch(saveReportCopy(ref, fileName))}
      onOpen={() => void dispatch(openSavedCopy(ref, "open"))}
      onShow={() => void dispatch(openSavedCopy(ref, "show"))}
    />
  );
}

export function SealedComparison({ view }: { view: ComparisonView }) {
  const report = view.outputs.report ?? null;
  const [retry, setRetry] = useState(0);
  const pdf = useVerifiedEngineBytes(report?.url ?? null, report?.sha256 ?? null, retry);
  // the manifest keeps its URL across prints: read it again for every sealed version
  const manifest = useEngineJson(view.outputs.manifest_url ?? null, report?.version ?? 0);
  const probe =
    manifest.state === "ready" && isRecord(manifest.data) ? manifest.data["probes"] : undefined;
  if (report === null) {
    return (
      <Card title={messagePair("comparison.pdfTitle")} level={2}>
        <p className="text-sm text-ink-secondary">
          <Bi {...messagePair("pdf.none")} />
        </p>
      </Card>
    );
  }
  const stale = report.stale || view.report_stale || view.stale;
  return (
    <Card title={messagePair("comparison.pdfTitle")} level={2} data-testid="comparison-pdf">
      {stale ? (
        <Alert tone="warning" title={messagePair("comparison.pdfStale")}>
          <Bi
            {...messagePair(view.stale ? "comparison.pdfStaleMembers" : "comparison.pdfStaleCover")}
          />
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
      <SaveComparisonCopy view={view} version={report.version} verified={pdf.state === "match"} />
      <PdfViewer
        data={pdf.state === "match" ? pdf.bytes : null}
        fileName={report.file}
        verified={pdf.state === "match"}
        className="h-[48rem]"
      />
      {probe !== undefined && probe !== null ? <ProbeReport probe={probe} /> : null}
    </Card>
  );
}
