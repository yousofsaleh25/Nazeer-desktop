/**
 * Finalize (C3.5, D7): the engine renders the overlay once, from exactly what the canvas shows.
 * Edits and undo freeze, the debounce is skipped and a save in flight lands first; then one call:
 * a clean draft sends {revision: stored}, a dirty one {revision: stored + 1, document} (the engine
 * saves it, then renders), plus the report inputs when given. Success seals the session (no more
 * autosave) and starts the overlay check. Any failure (`camel_id_required` included) unfreezes,
 * fetches the session again and reconciles before autosave resumes.
 *
 * The overlay check (also on request, e.g. a finalized session reopened from History): fetch the
 * PNG the view names, SHA-256 it with WebCrypto, compare with the engine's stamp (slices/report).
 * Matching bytes are kept (services/overlayBytes.ts): the approval shows them and the print sends
 * them.
 */
import { createAction } from "@reduxjs/toolkit";
import type { components } from "@shared/api";
import { settle } from "@/api/client";
import { activeEngine, ENGINE_NOT_CONNECTED } from "@/api/connection";
import { appError, errorFromResponse, networkError } from "@/api/errors";
import type { SessionView } from "@/api/types";
import { engineUrl } from "@/api/urls";
import type { AppStartListening, AppThunkDispatch } from "../listener";
import type { RootState } from "../store";
import { documentBody, sameDocument } from "../session/document";
import { forgetVerifiedOverlay, keepVerifiedOverlay } from "../services/overlayBytes";
import { getSessionView, reconcile, viewResult } from "../session/sync";
import {
  isCheckOf,
  overlayChecked,
  overlayCheckFailed,
  overlayCheckStarted,
} from "../slices/report";
import { finalizeFailed, finalizeStarted, finalizeSucceeded } from "../slices/session";
import { autosaveDue, shouldSave } from "./autosave";

export type ReportInputsIn = components["schemas"]["ReportInputsIn"];

export const finalizeRequested = createAction<{ reportInputs?: ReportInputsIn } | undefined>(
  "session/finalizeRequested",
);
/** Check the overlay the open session's view names (no-op without one). */
export const overlayVerifyRequested = createAction("report/overlayVerifyRequested");

/** How long finalize waits for a save in flight to land. */
export const FINALIZE_WAIT_MS = 30_000;

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyOverlay(
  api: { dispatch: AppThunkDispatch; getState: () => RootState },
  view: SessionView,
): Promise<void> {
  const { dispatch } = api;
  const overlay = view.outputs.overlay;
  if (overlay === null || overlay === undefined) return;
  const ours = { sessionId: view.session_id, version: overlay.version };
  dispatch(overlayCheckStarted({ ...ours, sha256: overlay.sha256, url: overlay.url }));
  const engine = activeEngine();
  if (engine === null) {
    dispatch(overlayCheckFailed({ ...ours, error: ENGINE_NOT_CONNECTED }));
    return;
  }
  try {
    const response = await engine.fetch(
      new Request(engineUrl(engine.connection, overlay.url), { cache: "no-store" }),
    );
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      dispatch(overlayCheckFailed({ ...ours, error: errorFromResponse(response.status, body) }));
      return;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const computed = hex(await crypto.subtle.digest("SHA-256", bytes));
    // another session (or a newer check) took the slot meanwhile: its kept bytes stay untouched
    if (!isCheckOf(api.getState().report.overlay, ours)) return;
    // kept before the result is announced, so a screen reading the result finds the bytes
    if (computed === overlay.sha256) {
      keepVerifiedOverlay({ ...ours, sha256: computed, bytes });
    } else {
      forgetVerifiedOverlay(view.session_id);
    }
    dispatch(overlayChecked({ ...ours, computed }));
  } catch (error) {
    dispatch(overlayCheckFailed({ ...ours, error: networkError(error) }));
  }
}

export function startFinalize(startListening: AppStartListening): void {
  startListening({
    actionCreator: finalizeRequested,
    effect: async (action, api) => {
      const before = api.getState().session;
      if (before.id === null || before.view === null || before.draft === null) return;
      if (before.save.finalizing || before.save.conflict !== null) return;
      const id = before.id;
      api.dispatch(finalizeStarted());
      if (api.getState().session.inFlight !== null) {
        const landed = await api.condition(
          (_a, state) => state.session.inFlight === null,
          FINALIZE_WAIT_MS,
        );
        if (!landed) {
          api.dispatch(
            finalizeFailed(appError("network_error", "the last save did not land in time")),
          );
          return;
        }
      }
      const session = api.getState().session;
      if (session.id !== id || session.draft === null || session.base === null) return;
      const clean = sameDocument(session.draft, session.base);
      const body: components["schemas"]["FinalizeIn"] = clean
        ? { revision: session.storedRevision }
        : {
            revision: session.storedRevision + 1,
            document: documentBody(session.draft, session.nextMeasurementId),
          };
      const reportInputs = action.payload?.reportInputs;
      if (reportInputs !== undefined) body.report_inputs = reportInputs;
      const engine = activeEngine();
      if (engine === null) {
        api.dispatch(finalizeFailed(ENGINE_NOT_CONNECTED));
        return;
      }
      const answer = viewResult(
        await settle(() =>
          engine.client.POST("/sessions/{session_id}/finalize", {
            params: { path: { session_id: id } },
            body,
          }),
        ),
      );
      if (api.getState().session.id !== id) return;
      if ("error" in answer) {
        api.dispatch(finalizeFailed(answer.error));
        const fetched = await getSessionView(id);
        if (!("error" in fetched) && api.getState().session.id === id) {
          reconcile(api.dispatch, api.getState().session, fetched.view, fetched.etag);
        }
        if (shouldSave(api.getState().session)) api.dispatch(autosaveDue());
        return;
      }
      api.dispatch(finalizeSucceeded(answer));
      await verifyOverlay(api, answer.view);
    },
  });

  startListening({
    actionCreator: overlayVerifyRequested,
    effect: async (_action, api) => {
      const view = api.getState().session.view;
      if (view !== null) await verifyOverlay(api, view);
    },
  });
}
