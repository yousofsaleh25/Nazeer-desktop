/**
 * The proposed frames of one walk (#/candidates/:fp/:ph), in recording order, never ranked
 * (C2.5). Picking a frame opens the session dialog (camel id, operator, notes); the engine copies
 * the frame into a new session (`POST /sessions`) and the measuring screen opens. Another open
 * session's unsaved work is guarded first.
 */
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useGetCandidatesQuery } from "@/api/engineApi";
import { appError, toApiError, type ApiErrorShape } from "@/api/errors";
import type { CandidateItem } from "@/api/types";
import { engineUrl } from "@/api/urls";
import { CamelIdDialog, type SessionStartValues } from "@/components/domain/CamelIdDialog";
import { CandidateGrid } from "@/components/domain/CandidateGrid";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Ltr, PathText } from "@/components/ui/Ltr";
import { Spinner } from "@/components/ui/Spinner";
import { messagePair } from "@/i18n/t";
import { readString } from "@/lib/read";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { candidateJobRequested } from "@/store/listeners/candidates";
import { candidatePicked } from "@/store/slices/candidates";
import { createSession, type CandidateRef } from "@/store/thunks/session";
import { useUnsavedGuard } from "./session/useUnsavedGuard";

/** The `ref` a candidate carries: the body of `POST /sessions`' `candidate`. */
export function candidateRef(candidate: CandidateItem): CandidateRef | null {
  const { fingerprint, params_hash, candidate_id } = candidate.ref;
  return typeof fingerprint === "string" &&
    typeof params_hash === "string" &&
    typeof candidate_id === "string"
    ? { fingerprint, params_hash, candidate_id }
    : null;
}

export function CandidateSet() {
  const { fp = "", ph = "" } = useParams();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const connection = useAppSelector((state) => state.engine.connection);
  const set = useGetCandidatesQuery({ fingerprint: fp, paramsHash: ph });
  const { confirmDiscard, dialog } = useUnsavedGuard();
  const [picked, setPicked] = useState<CandidateItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorShape | null>(null);

  const assetUrl = (path: string) => (connection === null ? "" : engineUrl(connection, path));
  const bagPath = readString(set.data?.bag, "path");
  const bagName = readString(set.data?.bag, "name");

  const start = async (values: SessionStartValues) => {
    if (picked === null) return;
    const ref = candidateRef(picked);
    if (ref === null) {
      setError(appError("invalid_response", "the candidate has no session reference"));
      return;
    }
    setBusy(true);
    setError(null);
    if (!(await confirmDiscard(null))) {
      setBusy(false);
      return;
    }
    dispatch(candidatePicked(ref));
    const created = await dispatch(
      createSession({
        candidate: ref,
        camelId: values.camel_id,
        operator: values.operator,
        notes: values.notes,
      }),
    );
    setBusy(false);
    if ("error" in created) {
      setError(created.error);
      return;
    }
    setPicked(null);
    void navigate(`/sessions/${created.id}`);
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-2xl font-semibold">
            <Bi {...messagePair("candidates.title")} />
          </h1>
          {bagName ? <Ltr className="font-medium">{bagName}</Ltr> : null}
          {bagPath ? <PathText path={bagPath} className="text-xs text-ink-muted" /> : null}
        </div>
        <Button variant="ghost" asChild>
          <Link to="/">
            <ArrowLeft aria-hidden="true" className="rtl:-scale-x-100" />
            <Bi {...messagePair("nav.home")} />
          </Link>
        </Button>
        {bagPath ? (
          <Button
            onClick={() => {
              dispatch(candidateJobRequested({ bagPath, force: true }));
              void navigate("/candidates");
            }}
          >
            <RefreshCw aria-hidden="true" />
            <Bi {...messagePair("bag.searchAgain")} />
          </Button>
        ) : null}
      </div>
      {set.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-ink-secondary" role="status">
          <Spinner size="sm" />
          <Bi {...messagePair("candidates.loading")} />
        </p>
      ) : null}
      {set.error ? (
        <ErrorPanel error={toApiError(set.error)} onRetry={() => void set.refetch()} />
      ) : null}
      {set.data ? (
        <CandidateGrid
          set={set.data}
          assetUrl={assetUrl}
          selectedId={picked?.candidate_id ?? null}
          busyId={busy ? (picked?.candidate_id ?? null) : null}
          onPick={(candidate) => {
            setError(null);
            setPicked(candidate);
          }}
        />
      ) : null}
      <CamelIdDialog
        key={picked?.candidate_id ?? "none"}
        open={picked !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPicked(null);
        }}
        candidate={picked}
        busy={busy}
        error={error}
        onSubmit={(values) => void start(values)}
      />
      {dialog}
    </div>
  );
}
