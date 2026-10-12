/**
 * Bringing the session slice onto a newer engine view: the `current` of a 409, a GET after the
 * engine came back, the answer to a reopen. The order of the checks: my save in flight landed (the
 * answer was lost) → saved; the same document at the same revision (status, report inputs or the
 * ETag moved) → updated; the session is not open any more → blocked, my draft kept unsaved;
 * otherwise a three-way rebase of my draft → rebased, or a conflict for the operator.
 */
import type { Dispatch } from "@reduxjs/toolkit";
import { etagOf, settle, type Settled } from "@/api/client";
import { activeEngine, ENGINE_NOT_CONNECTED } from "@/api/connection";
import type { ApiErrorShape } from "@/api/errors";
import { sessionViewOrError } from "@/api/sessionView";
import type { SessionView } from "@/api/types";
import {
  saveConflicted,
  saveRebased,
  saveSucceeded,
  sessionBlocked,
  viewUpdated,
  type SessionState,
} from "../slices/session";
import { documentOf, sameDocument } from "./document";
import { rebase } from "./rebase";

export type ViewResult = { view: SessionView; etag: string | null } | { error: ApiErrorShape };

export async function getSessionView(id: string): Promise<ViewResult> {
  const engine = activeEngine();
  if (engine === null) return { error: ENGINE_NOT_CONNECTED };
  const result = await settle(() =>
    engine.client.GET("/sessions/{session_id}", { params: { path: { session_id: id } } }),
  );
  return viewResult(result);
}

/** A settled call that answers with a SessionView, as a view and its ETag (or the error). */
export function viewResult(result: Settled<unknown>): ViewResult {
  if ("error" in result) return result;
  const parsed = sessionViewOrError(result.data);
  return "error" in parsed ? parsed : { view: parsed.view, etag: etagOf(result.response) };
}

export type Reconciled = "saved" | "updated" | "blocked" | "rebased" | "conflict" | "ignored";

export function reconcile(
  dispatch: Dispatch,
  session: SessionState,
  view: SessionView,
  etag: string | null,
): Reconciled {
  const { base, draft, inFlight } = session;
  if (base === null || draft === null || view.session_id !== session.id) return "ignored";
  const theirs = documentOf(view);
  if (
    inFlight !== null &&
    view.revision === inFlight.revision &&
    sameDocument(theirs, inFlight.document)
  ) {
    dispatch(saveSucceeded({ view, etag }));
    return "saved";
  }
  if (view.revision === session.storedRevision && sameDocument(theirs, base)) {
    dispatch(
      inFlight === null ? viewUpdated({ view, etag }) : saveRebased({ view, merged: draft, etag }),
    );
    return "updated";
  }
  if (view.status !== "open") {
    dispatch(sessionBlocked(view));
    return "blocked";
  }
  const { merged, conflicts } = rebase(base, draft, theirs);
  if (conflicts.length === 0) {
    dispatch(saveRebased({ view, merged, etag }));
    return "rebased";
  }
  dispatch(saveConflicted({ conflicts, mine: draft, theirs, view }));
  return "conflict";
}
