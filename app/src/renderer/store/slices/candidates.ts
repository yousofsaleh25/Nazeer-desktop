/**
 * Proposing frames from a bag (C2): the candidate job the engine runs for it — its latest snapshot
 * (stage, progress, live counters, rejected-by-reason, warnings), how the app follows it (SSE, or
 * polling every 500 ms when the stream fails) — and the resulting candidate set, the location of
 * the grid (`/candidates/{fingerprint}/{params_hash}`, fetched through RTK Query). A walk the
 * operator stopped early is a partial set: shown, never a cache hit. The picked candidate opens a
 * session (thunks/session.ts createSession).
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ApiErrorShape } from "@/api/errors";
import type { JobSnapshot } from "@/api/types";
import type { CandidateRef } from "../thunks/session";

export interface CandidateSetRef {
  fingerprint: string;
  paramsHash: string;
  partial: boolean;
  nCandidates: number | null;
  /** from the cache (no walk ran) */
  cached: boolean;
}

export interface CandidatesState {
  bagPath: string | null;
  start: { state: "idle" | "starting" | "error"; error: ApiErrorShape | null };
  job: { id: string; snapshot: JobSnapshot; transport: "sse" | "poll" } | null;
  /**
   * The engine runs one job at a time: a search of another recording that kept this one from
   * starting (`job_busy`). Shown with its own recording and never followed as this one's.
   */
  busyElsewhere: JobSnapshot | null;
  set: CandidateSetRef | null;
  picked: CandidateRef | null;
}

export const CANDIDATES_INITIAL: CandidatesState = {
  bagPath: null,
  start: { state: "idle", error: null },
  job: null,
  busyElsewhere: null,
  set: null,
  picked: null,
};

const candidatesSlice = createSlice({
  name: "candidates",
  initialState: CANDIDATES_INITIAL,
  reducers: {
    candidateJobStarting(_state, action: PayloadAction<string>) {
      return {
        ...CANDIDATES_INITIAL,
        bagPath: action.payload,
        start: { state: "starting", error: null },
      };
    },
    candidateJobStartFailed(state, action: PayloadAction<ApiErrorShape>) {
      state.start = { state: "error", error: action.payload };
    },
    candidateJobAttached(state, action: PayloadAction<JobSnapshot>) {
      state.start = { state: "idle", error: null };
      state.job = { id: action.payload.job_id, snapshot: action.payload, transport: "sse" };
    },
    candidateJobBusyElsewhere(
      state,
      action: PayloadAction<{ error: ApiErrorShape; snapshot: JobSnapshot }>,
    ) {
      state.start = { state: "error", error: action.payload.error };
      state.busyElsewhere = action.payload.snapshot;
    },
    candidateJobSnapshot(state, action: PayloadAction<JobSnapshot>) {
      if (state.busyElsewhere?.job_id === action.payload.job_id) {
        state.busyElsewhere = action.payload;
      }
      if (state.job === null || state.job.id !== action.payload.job_id) return;
      state.job.snapshot = action.payload;
    },
    candidateJobPolling(state) {
      if (state.job !== null) state.job.transport = "poll";
    },
    candidateSetReady(state, action: PayloadAction<CandidateSetRef>) {
      state.start = { state: "idle", error: null };
      state.set = action.payload;
    },
    candidatePicked(state, action: PayloadAction<CandidateRef | null>) {
      state.picked = action.payload;
    },
    candidatesCleared() {
      return CANDIDATES_INITIAL;
    },
  },
});

export const {
  candidateJobStarting,
  candidateJobStartFailed,
  candidateJobAttached,
  candidateJobBusyElsewhere,
  candidateJobSnapshot,
  candidateJobPolling,
  candidateSetReady,
  candidatePicked,
  candidatesCleared,
} = candidatesSlice.actions;
export const candidatesReducer = candidatesSlice.reducer;

/** The set a finished job produced (its `result`), or null for a cancelled / failed job. */
export function setFromSnapshot(snapshot: JobSnapshot): CandidateSetRef | null {
  const result = snapshot.result;
  if (snapshot.state !== "done" || result === null || result === undefined) return null;
  const fingerprint = result["fingerprint"];
  const paramsHash = result["params_hash"];
  if (typeof fingerprint !== "string" || typeof paramsHash !== "string") return null;
  const n = result["n_candidates"];
  return {
    fingerprint,
    paramsHash,
    partial: result["partial"] === true,
    nCandidates: typeof n === "number" ? n : null,
    cached: result["cached"] === true,
  };
}
