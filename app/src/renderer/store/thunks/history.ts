/**
 * History's actions on a session that may not be the open one. Reopen: load it, then
 * `POST …/reopen` (its outputs become stale, C3.5). Delete (C3.5): the session must not be held
 * open — the store forgets it first (the operator confirmed, so its unsaved changes go with it)
 * — then `DELETE`; the engine takes the session lock without waiting, so `session_busy` (a save
 * still finishing) is retried; a 404 means it is already gone, which is what was asked.
 */
import { settle } from "@/api/client";
import { activeEngine, ENGINE_NOT_CONNECTED } from "@/api/connection";
import { engineApi } from "@/api/engineApi";
import type { ApiErrorShape } from "@/api/errors";
import { forgetVerifiedOverlay } from "../services/overlayBytes";
import { memberRemoved } from "../slices/comparisons";
import { sessionClosed } from "../slices/session";
import { openSession, reopenSession, type AppThunk } from "./session";

export const DELETE_ATTEMPTS = 4;
export const DELETE_RETRY_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function reopenSessionById(id: string): AppThunk<Promise<ApiErrorShape | null>> {
  return async (dispatch, getState) => {
    const session = getState().session;
    if (session.id !== id || session.load.state !== "ready") {
      const error = await dispatch(openSession(id));
      if (error !== null) return error;
    }
    const error = await dispatch(reopenSession());
    dispatch(engineApi.util.invalidateTags(["History", "Comparisons"]));
    return error;
  };
}

export function deleteSessionById(id: string): AppThunk<Promise<ApiErrorShape | null>> {
  return async (dispatch, getState) => {
    if (getState().session.id === id) dispatch(sessionClosed());
    forgetVerifiedOverlay(id);
    const engine = activeEngine();
    if (engine === null) return ENGINE_NOT_CONNECTED;
    for (let attempt = 1; ; attempt += 1) {
      const result = await settle(() =>
        engine.client.DELETE("/sessions/{session_id}", { params: { path: { session_id: id } } }),
      );
      if (!("error" in result) || result.error.status === 404) break;
      if (result.error.code !== "session_busy" || attempt >= DELETE_ATTEMPTS) {
        dispatch(engineApi.util.invalidateTags(["History", "Comparisons"]));
        return result.error;
      }
      await sleep(DELETE_RETRY_MS);
    }
    // a deleted camel leaves the comparison being picked; the comparisons that hold it turn stale
    dispatch(memberRemoved(id));
    dispatch(engineApi.util.invalidateTags(["History", "Comparisons"]));
    return null;
  };
}
