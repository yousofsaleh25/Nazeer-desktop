/**
 * The candidate job (C2.8). Start: 200 cached → the candidate set at once; 202 → follow the job;
 * 409 `job_busy` → attach to the job that is running (one at a time, engine-wide) when it walks
 * the same recording; a job walking another recording is reported (`busyElsewhere`, with its own
 * path, and Cancel reaches it), never followed as this one's. Follow over SSE (`progress`, then
 * `done` / `cancelled` / `failed`); when the stream fails, poll every 500 ms. A finished job
 * becomes the candidate set (partial when the operator stopped it). Cancel and stop are requests
 * to the engine; the stream (or the poll) then reports the terminal state. A new start request
 * stops following the previous job.
 */
import { createAction } from "@reduxjs/toolkit";
import { settle } from "@/api/client";
import { activeEngine, ENGINE_NOT_CONNECTED } from "@/api/connection";
import { appError, isRecord } from "@/api/errors";
import { openJobStream } from "@/api/jobEvents";
import type { JobSnapshot } from "@/api/types";
import { engineUrl } from "@/api/urls";
import type { AppStartListening } from "../listener";
import {
  candidateJobAttached,
  candidateJobBusyElsewhere,
  candidateJobPolling,
  candidateJobSnapshot,
  candidateJobStartFailed,
  candidateJobStarting,
  candidateSetReady,
  setFromSnapshot,
} from "../slices/candidates";

export const candidateJobRequested = createAction<{ bagPath: string; force?: boolean }>(
  "candidates/jobRequested",
);
export const candidateJobCancelRequested = createAction("candidates/cancelRequested");
export const candidateJobStopRequested = createAction("candidates/stopRequested");

export const POLL_INTERVAL_MS = 500;

/**
 * Two Windows paths name the same file: the engine keeps a job's bag as `str(Path(...))`
 * (backslashes, repeated separators collapsed), and Windows paths ignore case.
 */
export function sameWindowsPath(a: string, b: string): boolean {
  const key = (path: string): string => {
    const p = path.trim().replace(/\//g, "\\");
    const unc = p.startsWith("\\\\");
    const rest = (unc ? p.slice(2) : p).replace(/\\{2,}/g, "\\").replace(/\\+$/, "");
    return (unc ? "\\\\" : "") + rest.toLowerCase();
  };
  return key(a) === key(b);
}

/** The typed client's data (tuples widened) as a snapshot, checked for what the store uses. */
function asSnapshot(raw: unknown): JobSnapshot | null {
  return isRecord(raw) &&
    typeof raw["job_id"] === "string" &&
    typeof raw["state"] === "string" &&
    typeof raw["terminal"] === "boolean"
    ? (raw as unknown as JobSnapshot)
    : null;
}

export function startCandidateJobs(startListening: AppStartListening): void {
  startListening({
    actionCreator: candidateJobRequested,
    effect: async (action, api) => {
      api.cancelActiveListeners();
      const { bagPath, force = false } = action.payload;
      api.dispatch(candidateJobStarting(bagPath));
      const engine = activeEngine();
      if (engine === null) {
        api.dispatch(candidateJobStartFailed(ENGINE_NOT_CONNECTED));
        return;
      }
      const started = await settle(() =>
        engine.client.POST("/candidates/jobs", { body: { bag_path: bagPath, force } }),
      );
      let snapshot: JobSnapshot | null;
      if ("error" in started) {
        const busy = started.error.code === "job_busy" ? started.error.details["job_id"] : null;
        if (typeof busy !== "string") {
          api.dispatch(candidateJobStartFailed(started.error));
          return;
        }
        const running = await settle(() =>
          engine.client.GET("/candidates/jobs/{job_id}", { params: { path: { job_id: busy } } }),
        );
        if ("error" in running) {
          api.dispatch(candidateJobStartFailed(running.error));
          return;
        }
        snapshot = asSnapshot(running.data);
        if (snapshot !== null && !sameWindowsPath(snapshot.bag_path, bagPath)) {
          api.dispatch(candidateJobBusyElsewhere({ error: started.error, snapshot }));
          return;
        }
      } else {
        const out = started.data;
        const cached = out.result;
        if (out.cached && cached !== null) {
          api.dispatch(
            candidateSetReady({
              fingerprint: cached.fingerprint,
              paramsHash: cached.params_hash,
              partial: cached.partial === true,
              nCandidates: cached.n_candidates ?? null,
              cached: true,
            }),
          );
          return;
        }
        snapshot = asSnapshot(out.job);
      }
      if (snapshot === null) {
        api.dispatch(candidateJobStartFailed(appError("invalid_response", "no job snapshot")));
        return;
      }
      api.dispatch(candidateJobAttached(snapshot));
      const final = snapshot.terminal ? snapshot : await follow(api, snapshot.job_id);
      if (final === null) return;
      api.dispatch(candidateJobSnapshot(final));
      const set = setFromSnapshot(final);
      if (set !== null) api.dispatch(candidateSetReady(set));
    },
  });

  for (const [request, verb] of [
    [candidateJobCancelRequested, "cancel"],
    [candidateJobStopRequested, "stop"],
  ] as const) {
    startListening({
      actionCreator: request,
      effect: async (_action, api) => {
        // the followed job, or the other recording's job that kept this search from starting
        const { job, busyElsewhere } = api.getState().candidates;
        const target = job?.snapshot ?? busyElsewhere;
        const engine = activeEngine();
        if (target === null || target.terminal || engine === null) return;
        const path = { job_id: target.job_id };
        const result = await settle(() =>
          verb === "cancel"
            ? engine.client.POST("/candidates/jobs/{job_id}/cancel", { params: { path } })
            : engine.client.POST("/candidates/jobs/{job_id}/stop", { params: { path } }),
        );
        const snapshot = "error" in result ? null : asSnapshot(result.data);
        if (snapshot !== null) api.dispatch(candidateJobSnapshot(snapshot));
      },
    });
  }
}

type Follower = Parameters<Parameters<AppStartListening>[0]["effect"]>[1];

/** SSE until the terminal event; polling when the stream fails; null when no longer followed. */
async function follow(api: Follower, jobId: string): Promise<JobSnapshot | null> {
  const engine = activeEngine();
  const streamed = await new Promise<JobSnapshot | "poll" | null>((resolve) => {
    if (engine === null) {
      resolve("poll");
      return;
    }
    const stream = openJobStream(engineUrl(engine.connection, `/candidates/jobs/${jobId}/events`), {
      snapshot: (snapshot) => api.dispatch(candidateJobSnapshot(snapshot)),
      terminal: (snapshot) => resolve(snapshot),
      error: () => resolve("poll"),
    });
    api.signal.addEventListener("abort", () => {
      stream.close();
      resolve(null);
    });
  });
  if (streamed !== "poll") return streamed;
  api.dispatch(candidateJobPolling());
  for (;;) {
    const current = activeEngine();
    if (current !== null) {
      const result = await settle(() =>
        current.client.GET("/candidates/jobs/{job_id}", { params: { path: { job_id: jobId } } }),
      );
      if ("error" in result) {
        if (result.error.status === 404) {
          api.dispatch(candidateJobStartFailed(result.error));
          return null;
        }
      } else {
        const snapshot = asSnapshot(result.data);
        if (snapshot !== null) {
          api.dispatch(candidateJobSnapshot(snapshot));
          if (snapshot.terminal) return snapshot;
        }
      }
    }
    // throws (ending the effect) when a newer request cancelled this one
    await api.delay(POLL_INTERVAL_MS);
  }
}
