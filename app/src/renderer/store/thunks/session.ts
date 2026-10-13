/**
 * Opening, creating and reopening a session, and changing its report inputs. Each answer is a
 * SessionView with its ETag: a new session replaces the slice; for the open one the view is
 * reconciled with the draft (session/sync.ts) so unsaved edits survive and the next autosave
 * carries the new ETag (a report-inputs change moves it).
 */
import type { ThunkAction, UnknownAction } from "@reduxjs/toolkit";
import type { components } from "@shared/api";
import type { ExportResult, NazeerApi } from "@shared/ipc";
import { settle } from "@/api/client";
import { activeEngine, ENGINE_NOT_CONNECTED } from "@/api/connection";
import { appError, type ApiErrorShape } from "@/api/errors";
import { sessionViewOrError } from "@/api/sessionView";
import { autosaveDue, shouldSave } from "../listeners/autosave";
import { verifiedOverlay } from "../services/overlayBytes";
import { getSessionView, reconcile, viewResult, type ViewResult } from "../session/sync";
import { approvalHolds, exportFinished, exportStarted } from "../slices/report";
import { sessionLoaded, sessionLoadFailed, sessionLoadStarted } from "../slices/session";
import type { RootState } from "../store";

export type AppThunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;
export type CandidateRef = components["schemas"]["CandidateRefIn"];
export type ReportInputsPatch = components["schemas"]["ReportInputsIn"];

export function openSession(id: string): AppThunk<Promise<ApiErrorShape | null>> {
  return async (dispatch) => {
    dispatch(sessionLoadStarted(id));
    const answer = await getSessionView(id);
    if ("error" in answer) {
      dispatch(sessionLoadFailed(answer.error));
      return answer.error;
    }
    dispatch(sessionLoaded(answer));
    return null;
  };
}

export interface NewSession {
  candidate: CandidateRef;
  camelId: string;
  operator?: string;
  notes?: string;
}

export function createSession(
  input: NewSession,
): AppThunk<Promise<{ id: string } | { error: ApiErrorShape }>> {
  return async (dispatch) => {
    const engine = activeEngine();
    if (engine === null) return { error: ENGINE_NOT_CONNECTED };
    const answer = viewResult(
      await settle(() =>
        engine.client.POST("/sessions", {
          body: {
            candidate: input.candidate,
            camel_id: input.camelId,
            operator: input.operator ?? "",
            notes: input.notes ?? "",
          },
        }),
      ),
    );
    if ("error" in answer) return answer;
    dispatch(sessionLoaded(answer));
    return { id: answer.view.session_id };
  };
}

/** Adopt an answer for the open session (same id) and save whatever is still pending. */
function adopt(answer: ViewResult, id: string): AppThunk<ApiErrorShape | null> {
  return (dispatch, getState) => {
    if ("error" in answer) return answer.error;
    if (getState().session.id !== id) return null;
    reconcile(dispatch, getState().session, answer.view, answer.etag);
    if (shouldSave(getState().session)) dispatch(autosaveDue());
    return null;
  };
}

/** Reopen a finalized or exported session for editing (its outputs become stale). */
export function reopenSession(): AppThunk<Promise<ApiErrorShape | null>> {
  return async (dispatch, getState) => {
    const id = getState().session.id;
    if (id === null) return null;
    const engine = activeEngine();
    if (engine === null) return ENGINE_NOT_CONNECTED;
    const answer = viewResult(
      await settle(() =>
        engine.client.POST("/sessions/{session_id}/reopen", {
          params: { path: { session_id: id } },
        }),
      ),
    );
    return dispatch(adopt(answer, id));
  };
}

function printBridge(): NazeerApi["print"] | undefined {
  return (window as { nazeer?: NazeerApi }).nazeer?.print;
}

/**
 * Print the report with the approved overlay and have the engine seal it (ADR-D7): main lays the
 * print page out in a hidden window from the report model and exactly the bytes the operator
 * approved, prints it, and uploads the PDF; the engine probes it, attaches the evidence and seals
 * it, or refuses it. Afterwards the session is read again (its outputs and ETag moved; a refused
 * PDF is recorded too). Resolves with the failure, or null when the report was sealed.
 */
export function exportReport(): AppThunk<Promise<ApiErrorShape | null>> {
  return async (dispatch, getState) => {
    const { session, report } = getState();
    const view = session.view;
    if (session.id === null || view === null) return null;
    const id = session.id;
    const print = printBridge();
    if (print === undefined) return appError("bridge_missing", "printing needs the Nazeer app");
    const overlay = view.outputs.overlay ?? null;
    const model = view.outputs.report_model ?? null;
    if (overlay === null || model === null || model.sha256 === null) {
      // the engine's own code for this refusal (labelled in errors.*)
      return {
        status: null,
        code: "status_not_finalized",
        message: "finalize the session before printing",
        details: {},
      };
    }
    const verified = verifiedOverlay(id, overlay.version, overlay.sha256);
    if (!approvalHolds(report, view) || verified === null) {
      return appError("approval_required", "approve the engine's image before printing");
    }

    dispatch(exportStarted(id));
    let result: ExportResult;
    try {
      result = await print.exportPdf({
        sessionId: id,
        overlay: { version: overlay.version, sha256: overlay.sha256, bytes: verified.bytes },
        reportModel: { version: model.version, sha256: model.sha256 },
      });
    } catch (error) {
      result = {
        ok: false,
        error: appError("print_failed", error instanceof Error ? error.message : String(error)),
        probe: null,
        preflight: null,
        timingsMs: {},
      };
    }
    // read the session again after every attempt: the engine sealed it, recorded a refused PDF,
    // or may have sealed it although its answer was lost (a timeout, a broken connection)
    const fresh = await getSessionView(id);
    if (!("error" in fresh)) {
      dispatch(adopt(fresh, id));
    } else if (result.ok) {
      const parsed = sessionViewOrError(result.session);
      if (!("error" in parsed)) dispatch(adopt({ view: parsed.view, etag: null }, id));
    }
    dispatch(
      exportFinished({
        sessionId: id,
        ok: result.ok,
        error: result.ok ? null : result.error,
        probe: result.probe,
        preflight: result.preflight,
        timingsMs: result.timingsMs,
      }),
    );
    return result.ok ? null : result.error;
  };
}

/** Language, rubric, names, observations: a change writes a new report model version. */
export function updateReportInputs(
  patch: ReportInputsPatch,
): AppThunk<Promise<ApiErrorShape | null>> {
  return async (dispatch, getState) => {
    const id = getState().session.id;
    if (id === null) return null;
    const engine = activeEngine();
    if (engine === null) return ENGINE_NOT_CONNECTED;
    const answer = viewResult(
      await settle(() =>
        engine.client.PATCH("/sessions/{session_id}/report-inputs", {
          params: { path: { session_id: id } },
          body: patch,
        }),
      ),
    );
    return dispatch(adopt(answer, id));
  };
}
