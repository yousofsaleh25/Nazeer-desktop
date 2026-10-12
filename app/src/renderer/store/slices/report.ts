/**
 * Approving the engine's overlay (D7): after finalize the app fetches the overlay PNG, hashes it
 * with WebCrypto and compares with the engine's stamp: equal → it can be approved; different →
 * `overlay_hash_mismatch`, a hard error. The approval lives here, in the app (no engine endpoint;
 * not persisted) and names the overlay version and SHA-256 it was given for, so a newer overlay is
 * never covered by an older approval. Printing (Stage 7): the last export of the open session —
 * printing, sealed (the engine's probe passed) or failed (the error, the probe of a refused PDF,
 * the print page's own checks).
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PrintPreflight } from "@shared/ipc";
import { appError, type ApiErrorShape } from "@/api/errors";
import type { SessionView } from "@/api/types";
import { sessionClosed, sessionLoaded, sessionLoadStarted } from "./session";

export interface OverlayCheck {
  sessionId: string;
  version: number;
  /** the engine's stamp */
  sha256: string;
  url: string;
  state: "checking" | "ok" | "mismatch" | "error";
  /** the app's own SHA-256 of the bytes it fetched */
  computed: string | null;
  error: ApiErrorShape | null;
}

export interface ExportState {
  sessionId: string;
  state: "printing" | "sealed" | "failed";
  error: ApiErrorShape | null;
  /** the engine's probe: of the sealed PDF, or of a refused one (DRIFT) */
  probe: unknown;
  /** the print page's own checks (warnings too), when it got that far */
  preflight: PrintPreflight | null;
  timingsMs: Record<string, number>;
}

export interface ReportState {
  overlay: OverlayCheck | null;
  approved: { sessionId: string; version: number; sha256: string } | null;
  export: ExportState | null;
}

export const REPORT_INITIAL: ReportState = { overlay: null, approved: null, export: null };

const reportSlice = createSlice({
  name: "report",
  initialState: REPORT_INITIAL,
  reducers: {
    overlayCheckStarted(
      state,
      action: PayloadAction<{ sessionId: string; version: number; sha256: string; url: string }>,
    ) {
      state.overlay = { ...action.payload, state: "checking", computed: null, error: null };
    },
    overlayChecked(state, action: PayloadAction<{ version: number; computed: string }>) {
      const check = state.overlay;
      if (check === null || check.version !== action.payload.version) return;
      check.computed = action.payload.computed;
      if (action.payload.computed === check.sha256) {
        check.state = "ok";
      } else {
        check.state = "mismatch";
        check.error = appError(
          "overlay_hash_mismatch",
          "the overlay bytes do not match the engine's SHA-256",
          { engine: check.sha256, computed: action.payload.computed, version: check.version },
        );
      }
    },
    overlayCheckFailed(state, action: PayloadAction<{ version: number; error: ApiErrorShape }>) {
      const check = state.overlay;
      if (check === null || check.version !== action.payload.version) return;
      check.state = "error";
      check.error = action.payload.error;
    },
    overlayApproved(state) {
      const check = state.overlay;
      if (check === null || check.state !== "ok") return;
      state.approved = { sessionId: check.sessionId, version: check.version, sha256: check.sha256 };
    },
    exportStarted(state, action: PayloadAction<string>) {
      state.export = {
        sessionId: action.payload,
        state: "printing",
        error: null,
        probe: null,
        preflight: null,
        timingsMs: {},
      };
    },
    exportFinished(
      state,
      action: PayloadAction<{
        sessionId: string;
        ok: boolean;
        error: ApiErrorShape | null;
        probe: unknown;
        preflight: PrintPreflight | null;
        timingsMs: Record<string, number>;
      }>,
    ) {
      const { sessionId, ok, ...rest } = action.payload;
      if (state.export?.sessionId !== sessionId) return;
      state.export = { sessionId, state: ok ? "sealed" : "failed", ...rest };
    },
  },
  extraReducers: (builder) => {
    // a different (or re-read) session starts without an overlay check or an approval
    builder.addCase(sessionLoadStarted, () => REPORT_INITIAL);
    builder.addCase(sessionLoaded, () => REPORT_INITIAL);
    builder.addCase(sessionClosed, () => REPORT_INITIAL);
  },
});

export const {
  overlayCheckStarted,
  overlayChecked,
  overlayCheckFailed,
  overlayApproved,
  exportStarted,
  exportFinished,
} = reportSlice.actions;
export const reportReducer = reportSlice.reducer;

/** The approval holds only for the overlay the view names now (same version, same SHA-256). */
export function approvalHolds(report: ReportState, view: SessionView | null): boolean {
  const overlay = view?.outputs.overlay;
  const approved = report.approved;
  return (
    overlay !== null &&
    overlay !== undefined &&
    approved !== null &&
    approved.sessionId === view?.session_id &&
    approved.version === overlay.version &&
    approved.sha256 === overlay.sha256
  );
}
