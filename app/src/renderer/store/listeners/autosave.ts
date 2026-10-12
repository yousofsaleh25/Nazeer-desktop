/**
 * Autosave (C3.4; the app-side rules are recorded in D10): the whole document is PUT at
 * revision = stored + 1 with If-Match when the ETag is known; one save in flight; edits coalesce
 * behind a 250 ms debounce; a flush sends at once (leaving the screen, closing the session,
 * quitting). Answers:
 *   200          the engine's view, its echo adopted into the draft; anything edited meanwhile is
 *                sent next;
 *   409 stale    reconciled with `details.current` (session/sync.ts): landed, rebased, blocked or a
 *                conflict for the operator;
 *   other 4xx    terminal: `error` until the draft changes (never retried as it is);
 *   no engine, network failure, 5xx, session_busy
 *                transient: `offline`, retried after 1, 2, 4, 8, 16, 30 s, and at once (after a GET
 *                of the session) when the engine is ready again.
 * Revisions and ids stay below 2**53; the session never autosaves while it is not open.
 */
import { createAction, isAnyOf } from "@reduxjs/toolkit";
import type { EngineConnection } from "@shared/ipc";
import { settle } from "@/api/client";
import { activeEngine, ENGINE_NOT_CONNECTED } from "@/api/connection";
import type { ApiErrorShape } from "@/api/errors";
import { sessionViewOrError } from "@/api/sessionView";
import type { SessionView } from "@/api/types";
import type { AppStartListening } from "../listener";
import { documentBody, MAX_SAFE_ID, sameDocument } from "../session/document";
import { getSessionView, reconcile, viewResult } from "../session/sync";
import { engineStatusReceived } from "../slices/engine";
import {
  conflictResolved,
  DRAFT_EDITS,
  saveFailed,
  saveStarted,
  saveSucceeded,
  type SessionState,
} from "../slices/session";

function connectionKey(connection: EngineConnection | null): string {
  return connection === null ? "" : `${connection.baseUrl}|${connection.token}|${connection.pid}`;
}

/** Send now if there is anything to save (the end of the debounce, a retry). */
export const autosaveDue = createAction("autosave/due");
/** Send now, without waiting for the debounce. */
export const autosaveFlushRequested = createAction("autosave/flushRequested");

export const AUTOSAVE_DEBOUNCE_MS = 250;
export const AUTOSAVE_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

/** Worth a PUT: an open session, nothing in flight, no conflict, a draft the engine lacks. */
export function shouldSave(session: SessionState): boolean {
  const { id, view, draft, base, inFlight, save } = session;
  if (id === null || view === null || draft === null || base === null) return false;
  if (inFlight !== null || view.status !== "open" || save.blocked || save.finalizing) return false;
  if (save.conflict !== null) return false;
  if (save.error !== null && sameDocument(save.error.draft, draft)) return false;
  return !sameDocument(draft, base);
}

/** Failures that may pass by themselves: no engine, network, the engine's 5xx, a busy session. */
export function isTransient(error: ApiErrorShape): boolean {
  return error.status === null || error.status >= 500 || error.code === "session_busy";
}

/** The `current` view a 409 carries, or null when it has none (then the session is fetched). */
function currentView(error: ApiErrorShape): SessionView | null {
  const parsed = sessionViewOrError(error.details["current"]);
  return "error" in parsed ? null : parsed.view;
}

function backoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), AUTOSAVE_BACKOFF_MS.length) - 1;
  return AUTOSAVE_BACKOFF_MS[index] ?? 30_000;
}

export function startAutosave(startListening: AppStartListening): void {
  // every edit restarts the debounce
  startListening({
    matcher: isAnyOf(...DRAFT_EDITS),
    effect: async (_action, api) => {
      api.cancelActiveListeners();
      await api.delay(AUTOSAVE_DEBOUNCE_MS);
      api.dispatch(autosaveDue());
    },
  });

  // a resolved conflict continues at once on the engine's revision
  startListening({
    actionCreator: conflictResolved,
    effect: (_action, api) => {
      api.dispatch(autosaveDue());
    },
  });

  // the save itself
  startListening({
    matcher: isAnyOf(autosaveDue, autosaveFlushRequested),
    effect: async (_action, api) => {
      const session = api.getState().session;
      if (!shouldSave(session)) return;
      const { id, draft, etag, nextMeasurementId } = session as SessionState & {
        id: string;
        draft: NonNullable<SessionState["draft"]>;
      };
      const revision = session.storedRevision + 1;
      if (revision > MAX_SAFE_ID) {
        api.dispatch(
          saveFailed({
            error: {
              status: null,
              code: "invalid_revision",
              message: "revision limit",
              details: {},
            },
            transient: false,
          }),
        );
        return;
      }
      const engine = activeEngine();
      if (engine === null) {
        // resumed by the engine-ready listener below
        api.dispatch(saveFailed({ error: ENGINE_NOT_CONNECTED, transient: true }));
        return;
      }
      api.dispatch(saveStarted({ revision, document: draft }));
      const result = await settle(() =>
        engine.client.PUT("/sessions/{session_id}/document", {
          params: {
            path: { session_id: id },
            header: etag === null ? {} : { "if-match": etag },
          },
          body: { revision, ...documentBody(draft, nextMeasurementId) },
        }),
      );
      const now = api.getState().session;
      // the session closed or another one opened while the save was out: its answer is moot
      if (now.id !== id || now.inFlight?.revision !== revision) return;

      const answer = viewResult(result);
      if (!("error" in answer)) {
        api.dispatch(saveSucceeded(answer));
        if (shouldSave(api.getState().session)) api.dispatch(autosaveDue());
        return;
      }
      const error = answer.error;
      if (error.status === 409 && error.code === "stale_revision") {
        let view = currentView(error);
        let viewEtag: string | null = null;
        if (view === null) {
          const fetched = await getSessionView(id);
          if ("error" in fetched) {
            api.dispatch(
              saveFailed({ error: fetched.error, transient: isTransient(fetched.error) }),
            );
            return;
          }
          ({ view, etag: viewEtag } = fetched);
        }
        reconcile(api.dispatch, api.getState().session, view, viewEtag);
        if (shouldSave(api.getState().session)) api.dispatch(autosaveDue());
        return;
      }
      const transient = isTransient(error);
      api.dispatch(saveFailed({ error, transient }));
      if (transient && activeEngine() !== null) {
        await api.delay(backoffMs(api.getState().session.save.offline?.attempts ?? 1));
        api.dispatch(autosaveDue());
      }
    },
  });

  // the engine is ready again (a restart: new port and token): catch up with its view, then save
  startListening({
    predicate: (action, current, previous) =>
      engineStatusReceived.match(action) &&
      current.engine.status === "ready" &&
      connectionKey(current.engine.connection) !== connectionKey(previous.engine.connection),
    effect: async (_action, api) => {
      const session = api.getState().session;
      if (session.id === null || session.view === null || session.load.state !== "ready") return;
      const fetched = await getSessionView(session.id);
      if ("error" in fetched) return;
      const now = api.getState().session;
      if (now.id !== session.id) return;
      reconcile(api.dispatch, now, fetched.view, fetched.etag);
      if (shouldSave(api.getState().session)) api.dispatch(autosaveDue());
    },
  });
}
