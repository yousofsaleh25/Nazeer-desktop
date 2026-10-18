/**
 * "Save as" for a sealed PDF (D12 F1): the renderer asks main (`window.nazeer.report`) and keeps
 * its answers in the `savedFiles` slice. The renderer names the report version and suggests a file
 * name; main opens the Save dialog, fetches the bytes from the engine, writes and checks the copy.
 */
import type { NazeerApi, SaveAsResult, SavedCopyQuery } from "@shared/ipc";
import { appError, type ApiErrorShape } from "@/api/errors";
import {
  sameReport,
  savedCopyLoaded,
  openFinished,
  savedFileKey,
  saveFinished,
  saveOfferCleared,
  saveStarted,
} from "../slices/savedFiles";
import type { AppThunk } from "./session";

function reportBridge(): NazeerApi["report"] | undefined {
  return (window as { nazeer?: Partial<NazeerApi> }).nazeer?.report;
}

const BRIDGE_MISSING = (): ApiErrorShape =>
  appError("bridge_missing", "saving a copy needs the Nazeer app");

/** Ask main which copy of this report version it recorded, and whether it is still there. */
export function loadSavedCopy(ref: SavedCopyQuery): AppThunk<Promise<void>> {
  return async (dispatch) => {
    const bridge = reportBridge();
    if (bridge === undefined) return;
    try {
      const copy = await bridge.savedCopy(ref);
      dispatch(savedCopyLoaded({ key: savedFileKey(ref), copy }));
    } catch {
      dispatch(savedCopyLoaded({ key: savedFileKey(ref), copy: null }));
    }
  };
}

/** Save a copy of the sealed PDF where the operator chooses (main's Save dialog). */
export function saveReportCopy(
  ref: SavedCopyQuery,
  suggestedName: string,
): AppThunk<Promise<SaveAsResult>> {
  return async (dispatch) => {
    const key = savedFileKey(ref);
    const bridge = reportBridge();
    let result: SaveAsResult;
    dispatch(saveStarted(key));
    if (bridge === undefined) {
      result = { state: "failed", error: BRIDGE_MISSING() };
    } else {
      try {
        result = await bridge.saveAs({ ...ref, suggestedName });
      } catch (error) {
        result = {
          state: "failed",
          error: appError(
            "invalid_response",
            error instanceof Error ? error.message : String(error),
          ),
        };
      }
    }
    dispatch(saveFinished({ key, result }));
    return result;
  };
}

/**
 * After a seal (D12): the screen showing that report, once its viewer verified the sealed bytes,
 * opens the Save dialog — once. The offer is read from the store when the thunk runs, so an effect
 * that runs twice (React's StrictMode) cannot open two dialogs.
 */
export function takeSaveOffer(
  ref: SavedCopyQuery,
  suggestedName: string,
): AppThunk<Promise<SaveAsResult | null>> {
  return async (dispatch, getState) => {
    if (!sameReport(getState().savedFiles.offer, ref)) return null;
    dispatch(saveOfferCleared(ref));
    return dispatch(saveReportCopy(ref, suggestedName));
  };
}

/** Open the recorded copy, or show it in its folder; a failure is kept on the entry. */
export function openSavedCopy(
  ref: SavedCopyQuery,
  action: "open" | "show",
): AppThunk<Promise<ApiErrorShape | null>> {
  return async (dispatch) => {
    const key = savedFileKey(ref);
    const bridge = reportBridge();
    if (bridge === undefined) {
      dispatch(openFinished({ key, error: BRIDGE_MISSING() }));
      return BRIDGE_MISSING();
    }
    let error: ApiErrorShape | null;
    try {
      const answer = await bridge.openSaved({ ...ref, action });
      error = answer.ok ? null : answer.error;
    } catch (thrown) {
      error = appError(
        "invalid_response",
        thrown instanceof Error ? thrown.message : String(thrown),
      );
    }
    dispatch(openFinished({ key, error }));
    // the copy may have moved or gone: ask main again what it finds
    if (error !== null) await dispatch(loadSavedCopy(ref));
    return error;
  };
}
