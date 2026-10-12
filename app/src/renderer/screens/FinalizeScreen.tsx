/**
 * Finalize and approve (#/sessions/:id/finalize, C3.5 / D7). An open session is checked first
 * (camel id, unsaved work, conflicts); finalize makes the engine render the overlay once, from
 * exactly what the canvas shows, and seals the session. The app then downloads the overlay, hashes
 * it with WebCrypto and compares it with the engine's stamp: only matching bytes are shown, and
 * only they can be approved (a mismatch is a hard error). The approval is the app's (no engine
 * endpoint) and names the overlay version and SHA-256.
 */
import { ArrowLeft, CheckCheck, FileText, LockOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ApiErrorShape } from "@/api/errors";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { CodeLabel } from "@/components/domain/labels";
import { OverlayApproval, type OverlayVerification } from "@/components/domain/OverlayApproval";
import { UnsavedBadge } from "@/components/domain/UnsavedBadge";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Field, Input } from "@/components/ui/Field";
import { Ltr, Num } from "@/components/ui/Ltr";
import { Spinner } from "@/components/ui/Spinner";
import { STATUS_TONE } from "@/design";
import { messagePair } from "@/i18n/t";
import { useObjectUrl } from "@/lib/objectUrl";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { finalizeRequested, overlayVerifyRequested } from "@/store/listeners/finalize";
import { verifiedOverlay } from "@/store/services/overlayBytes";
import { saveStateOf } from "@/store/session/selectors";
import { approvalHolds, overlayApproved } from "@/store/slices/report";
import { textEdited } from "@/store/slices/session";
import { reopenSession } from "@/store/thunks/session";
import { TEXT_LIMITS } from "./measure/panels";
import { SessionGate, type LoadedSession } from "./session/SessionGate";

export function FinalizeScreen() {
  const { id = "" } = useParams();
  return (
    <SessionGate id={id}>
      {(session) => <FinalizeWorkspace key={session.id} session={session} />}
    </SessionGate>
  );
}

function CamelIdField({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const commit = () => {
    if (editing !== null && editing.trim() !== value) onCommit(editing.trim());
    setEditing(null);
  };
  return (
    <Field
      label={messagePair("session.camelId")}
      required
      error={
        value.trim() === "" && editing === null ? messagePair("finalize.camelIdMissing") : null
      }
    >
      <Input
        value={editing ?? value}
        maxLength={TEXT_LIMITS.camelId}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setEditing(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </Field>
  );
}

function FinalizeWorkspace({ session }: { session: LoadedSession }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const report = useAppSelector((state) => state.report);
  const { view, draft } = session;
  const sealed = view.status !== "open";
  const overlay = view.outputs.overlay ?? null;
  const check = report.overlay;
  const checked =
    overlay !== null &&
    check !== null &&
    check.sessionId === session.id &&
    check.version === overlay.version &&
    check.sha256 === overlay.sha256;
  const [reopenError, setReopenError] = useState<ApiErrorShape | null>(null);
  const [reopening, setReopening] = useState(false);

  // a sealed session opened here (from History, after a restart) gets its overlay checked
  useEffect(() => {
    if (sealed && overlay !== null && !checked) dispatch(overlayVerifyRequested());
  }, [sealed, overlay, checked, dispatch]);

  const kept =
    checked && check.state === "ok"
      ? verifiedOverlay(session.id, overlay.version, overlay.sha256)
      : null;
  const imageUrl = useObjectUrl(kept?.bytes ?? null, "image/png");

  let verification: OverlayVerification = { state: "verifying" };
  if (checked && check.state === "ok" && imageUrl !== null && check.computed !== null) {
    verification = { state: "match", computed: check.computed, imageUrl };
  } else if (checked && check.state === "mismatch" && check.computed !== null) {
    verification = { state: "mismatch", computed: check.computed };
  } else if (checked && check.state === "error" && check.error !== null) {
    verification = { state: "error", error: check.error };
  }
  const approved = approvalHolds(report, view);

  const reopen = async () => {
    setReopening(true);
    const error = await dispatch(reopenSession());
    setReopening(false);
    setReopenError(error);
    if (error === null) void navigate(`/sessions/${session.id}`);
  };

  const summary = view.summary;
  const saveState = saveStateOf(session);
  const camelMissing = draft.camelId.trim() === "";
  const blocked = session.save.conflict !== null || session.save.finalizing;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="ghost" asChild>
          <Link to={`/sessions/${session.id}`}>
            <ArrowLeft aria-hidden="true" className="rtl:-scale-x-100" />
            <Bi {...messagePair("finalize.backToMeasuring")} />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">
          <Bi {...messagePair(sealed ? "finalize.approveTitle" : "finalize.title")} />
        </h1>
        {draft.camelId ? <bdi dir="auto">{draft.camelId}</bdi> : null}
        <Ltr className="font-mono text-xs text-ink-muted">{session.id}</Ltr>
        <Chip tone={STATUS_TONE[view.status]}>
          <CodeLabel group="statuses" code={view.status} />
        </Chip>
      </div>

      {!sealed ? (
        <Card title={messagePair("finalize.checkTitle")} level={2}>
          <p className="text-sm text-ink-secondary">
            <Bi {...messagePair("finalize.explain")} />
          </p>
          <CamelIdField
            value={draft.camelId}
            onCommit={(value) => dispatch(textEdited({ field: "camelId", value }))}
          />
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-secondary">
              <Bi {...messagePair("measure.listTitle")} />
            </dt>
            <dd>
              <Num value={draft.measurements.length} />
            </dd>
            <dt className="text-ink-secondary">
              <Bi {...messagePair("measure.rejectedCount")} />
            </dt>
            <dd>
              <Num value={summary.n_rejected} />
            </dd>
            <dt className="text-ink-secondary">
              <Bi {...messagePair("measure.lowConfidence")} />
            </dt>
            <dd>
              <Num value={summary.n_low_confidence} />
            </dd>
            <dt className="text-ink-secondary">
              <Bi {...messagePair("finalize.saveState")} />
            </dt>
            <dd>
              <UnsavedBadge state={saveState} revision={session.storedRevision} />
            </dd>
          </dl>
          {summary.n_rejected > 0 ? (
            <Alert tone="warning" title={messagePair("finalize.rejectedWarning")} />
          ) : null}
          {session.save.conflict !== null ? (
            <Alert tone="danger" title={messagePair("finalize.conflict")}>
              <Link to={`/sessions/${session.id}`} className="underline">
                <Bi {...messagePair("finalize.backToMeasuring")} />
              </Link>
            </Alert>
          ) : null}
          {session.finalize.error ? (
            <ErrorPanel error={session.finalize.error} context={messagePair("finalize.failed")} />
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-3">
            {session.save.finalizing ? (
              <span className="flex items-center gap-2 text-sm text-ink-secondary" role="status">
                <Spinner size="sm" />
                <Bi {...messagePair("finalize.rendering")} />
              </span>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              onClick={() => dispatch(finalizeRequested())}
              disabled={camelMissing || blocked}
              loading={session.save.finalizing}
            >
              <CheckCheck aria-hidden="true" />
              <Bi {...messagePair("finalize.run")} />
            </Button>
          </div>
        </Card>
      ) : overlay === null ? (
        <Alert tone="danger" title={messagePair("finalize.noOverlay")} />
      ) : (
        <>
          <OverlayApproval
            overlay={overlay}
            verification={verification}
            approved={approved ? { version: overlay.version, sha256: overlay.sha256 } : null}
            onApprove={() => dispatch(overlayApproved())}
            onRetry={() => dispatch(overlayVerifyRequested())}
          />
          {reopenError ? (
            <ErrorPanel error={reopenError} context={messagePair("session.reopenFailed")} />
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => void reopen()} loading={reopening}>
              <LockOpen aria-hidden="true" />
              <Bi {...messagePair("history.reopen")} />
            </Button>
            {approved ? (
              <Button variant="primary" asChild>
                <Link to={`/sessions/${session.id}/report`}>
                  <FileText aria-hidden="true" />
                  <Bi {...messagePair("finalize.toReport")} />
                </Link>
              </Button>
            ) : (
              <Button variant="primary" disabled>
                <FileText aria-hidden="true" />
                <Bi {...messagePair("finalize.toReport")} />
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
