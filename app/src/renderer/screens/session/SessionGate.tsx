/**
 * The session routes (`/sessions/:id`, `…/finalize`, `…/report`) show the session the URL names:
 * it is loaded unless it is the open one, and another open session's unsaved work is guarded
 * first (useUnsavedGuard). While it loads: a waiting line; a failure: the error, "try again" and
 * the way back to History.
 */
import { History as HistoryIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { SessionView } from "@/api/types";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { messagePair } from "@/i18n/t";
import { useAppDispatch, useAppSelector, useAppStore } from "@/store/hooks";
import type { SessionDocument } from "@/store/session/document";
import type { SessionState } from "@/store/slices/session";
import { openSession } from "@/store/thunks/session";
import { useUnsavedGuard } from "./useUnsavedGuard";

export type LoadedSession = SessionState & {
  id: string;
  view: SessionView;
  draft: SessionDocument;
  base: SessionDocument;
};

export function isLoaded(session: SessionState, id: string): session is LoadedSession {
  return (
    session.id === id &&
    session.load.state === "ready" &&
    session.view !== null &&
    session.draft !== null &&
    session.base !== null
  );
}

export function SessionGate({
  id,
  children,
}: {
  id: string;
  children: (session: LoadedSession) => ReactNode;
}) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const navigate = useNavigate();
  const session = useAppSelector((state) => state.session);
  const { confirmDiscard, dialog } = useUnsavedGuard();
  const here = session.id === id && session.load.state !== "idle";

  useEffect(() => {
    if (here) return;
    let cancelled = false;
    const other = store.getState().session.id;
    void confirmDiscard(id).then((discard) => {
      if (cancelled) return;
      if (discard) void dispatch(openSession(id));
      else if (other !== null) void navigate(`/sessions/${other}`, { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [here, id, confirmDiscard, dispatch, navigate, store]);

  let body: ReactNode;
  if (isLoaded(session, id)) {
    body = children(session);
  } else if (session.id === id && session.load.state === "error" && session.load.error) {
    body = (
      <div className="flex flex-col gap-3 p-5">
        <ErrorPanel
          error={session.load.error}
          context={messagePair("session.openFailed")}
          onRetry={() => void dispatch(openSession(id))}
          actions={
            <Button size="sm" variant="ghost" asChild>
              <Link to="/history">
                <HistoryIcon aria-hidden="true" />
                <Bi {...messagePair("nav.history")} />
              </Link>
            </Button>
          }
        />
      </div>
    );
  } else {
    body = (
      <p className="flex items-center gap-2 p-5 text-sm text-ink-secondary" role="status">
        <Spinner size="sm" />
        <Bi {...messagePair("session.opening")} />
      </p>
    );
  }
  return (
    <>
      {body}
      {dialog}
    </>
  );
}
