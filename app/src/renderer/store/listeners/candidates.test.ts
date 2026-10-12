import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "@/api/client";
import { setEngineConnection } from "@/api/connection";
import { setJobStreamFactory, type JobStreamHandlers } from "@/api/jobEvents";
import type { JobSnapshot } from "@/api/types";
import { sampleConnection } from "@/design/samples";
import { engineState } from "@/test/engine";
import { tick, useStoreTimers } from "@/test/time";
import { makeStore } from "../store";
import { candidateJobRequested, candidateJobStopRequested, POLL_INTERVAL_MS } from "./candidates";

const FP = "f".repeat(64);
const PH = "abcdef012345";

function snapshot(change: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    job_id: "job1",
    bag_path: "D:\\bags\\006.bag",
    fingerprint: FP,
    params_hash: PH,
    state: "running",
    stage: "walking",
    progress_fraction: 0.2,
    counters: {},
    eta_s: 10,
    elapsed_s: 2,
    message: "",
    warnings: [],
    error: null,
    result: null,
    started_at: "2026-10-12T15:00:00Z",
    finished_at: null,
    terminal: false,
    ...change,
  } as JobSnapshot;
}

const DONE = snapshot({
  state: "done",
  stage: "done",
  progress_fraction: 1,
  terminal: true,
  result: { fingerprint: FP, params_hash: PH, n_candidates: 12, partial: false, cached: false },
});

type Answer = { status: number; body: unknown };

/** A fake engine for the job endpoints: answers by "METHOD path" (each answer used once). */
function jobEngine(answers: Record<string, Answer[]>) {
  const seen: string[] = [];
  const fetchImpl: FetchLike = (request) => {
    const key = `${request.method} ${new URL(request.url).pathname}`;
    seen.push(key);
    const answer = answers[key]?.shift() ?? {
      status: 404,
      body: { error: { code: "not_found", message: "", details: {} } },
    };
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  setEngineConnection(sampleConnection, fetchImpl);
  return seen;
}

/** A fake event stream: the test drives it. */
function fakeStream() {
  const streams: { url: string; on: JobStreamHandlers; closed: boolean }[] = [];
  const restore = setJobStreamFactory((url, on) => {
    const stream = { url, on, closed: false };
    streams.push(stream);
    return {
      close: () => {
        stream.closed = true;
      },
    };
  });
  return { streams, restore };
}

let restore: () => void = () => undefined;
beforeEach(() => useStoreTimers());
afterEach(() => {
  restore();
  vi.useRealTimers();
  setEngineConnection(null);
});

describe("the candidate job", () => {
  it("a cached set is ready at once, without a walk", async () => {
    jobEngine({
      "POST /candidates/jobs": [
        {
          status: 200,
          body: {
            cached: true,
            job: null,
            result: { fingerprint: FP, params_hash: PH, n_candidates: 12, partial: false },
            candidates_url: `/candidates/${FP}/${PH}`,
          },
        },
      ],
    });
    const store = makeStore({ engine: engineState() });
    store.dispatch(candidateJobRequested({ bagPath: "D:\\bags\\006.bag" }));
    await tick();
    expect(store.getState().candidates.set).toEqual({
      fingerprint: FP,
      paramsHash: PH,
      partial: false,
      nCandidates: 12,
      cached: true,
    });
  });

  it("a new job is followed over SSE (token in the URL) until done, then the set is ready", async () => {
    jobEngine({
      "POST /candidates/jobs": [
        {
          status: 202,
          body: { cached: false, job: snapshot(), result: null, candidates_url: null },
        },
      ],
    });
    const fake = fakeStream();
    restore = fake.restore;
    const store = makeStore({ engine: engineState() });
    store.dispatch(candidateJobRequested({ bagPath: "D:\\bags\\006.bag" }));
    await tick();
    const [stream] = fake.streams;
    expect(stream?.url).toContain("/candidates/jobs/job1/events");
    expect(new URL(stream?.url ?? "").searchParams.get("token")).toBe(sampleConnection.token);
    stream?.on.snapshot(snapshot({ progress_fraction: 0.6 }));
    expect(store.getState().candidates.job?.snapshot.progress_fraction).toBe(0.6);
    stream?.on.terminal(DONE);
    await tick();
    expect(store.getState().candidates.set).toMatchObject({ fingerprint: FP, nCandidates: 12 });
  });

  it("when the stream fails it polls every 500 ms until the job is terminal", async () => {
    const seen = jobEngine({
      "POST /candidates/jobs": [
        {
          status: 202,
          body: { cached: false, job: snapshot(), result: null, candidates_url: null },
        },
      ],
      "GET /candidates/jobs/job1": [
        { status: 200, body: snapshot({ progress_fraction: 0.5 }) },
        { status: 200, body: DONE },
      ],
    });
    const fake = fakeStream();
    restore = fake.restore;
    const store = makeStore({ engine: engineState() });
    store.dispatch(candidateJobRequested({ bagPath: "D:\\bags\\006.bag" }));
    await tick();
    fake.streams[0]?.on.error();
    await tick();
    expect(store.getState().candidates.job?.transport).toBe("poll");
    expect(store.getState().candidates.job?.snapshot.progress_fraction).toBe(0.5);
    await tick(POLL_INTERVAL_MS);
    expect(seen.filter((s) => s === "GET /candidates/jobs/job1")).toHaveLength(2);
    expect(store.getState().candidates.set?.fingerprint).toBe(FP);
  });

  it("job_busy: attaches to the job that is already running", async () => {
    const seen = jobEngine({
      "POST /candidates/jobs": [
        {
          status: 409,
          body: { error: { code: "job_busy", message: "busy", details: { job_id: "job1" } } },
        },
      ],
      "GET /candidates/jobs/job1": [{ status: 200, body: snapshot() }],
    });
    const fake = fakeStream();
    restore = fake.restore;
    const store = makeStore({ engine: engineState() });
    store.dispatch(candidateJobRequested({ bagPath: "D:\\bags\\other.bag" }));
    await tick();
    expect(seen).toEqual(["POST /candidates/jobs", "GET /candidates/jobs/job1"]);
    expect(store.getState().candidates.job?.id).toBe("job1");
    expect(fake.streams).toHaveLength(1);
  });

  it("stop asks the engine; a stopped walk is a partial set", async () => {
    const seen = jobEngine({
      "POST /candidates/jobs": [
        {
          status: 202,
          body: { cached: false, job: snapshot(), result: null, candidates_url: null },
        },
      ],
      "POST /candidates/jobs/job1/stop": [{ status: 202, body: snapshot({ state: "running" }) }],
    });
    const fake = fakeStream();
    restore = fake.restore;
    const store = makeStore({ engine: engineState() });
    store.dispatch(candidateJobRequested({ bagPath: "D:\\bags\\006.bag" }));
    await tick();
    store.dispatch(candidateJobStopRequested());
    await tick();
    expect(seen).toContain("POST /candidates/jobs/job1/stop");
    fake.streams[0]?.on.terminal({
      ...DONE,
      result: { fingerprint: FP, params_hash: PH, n_candidates: 4, partial: true, cached: false },
    });
    await tick();
    expect(store.getState().candidates.set).toMatchObject({ partial: true, nCandidates: 4 });
  });

  it("a new request stops following the previous job", async () => {
    jobEngine({
      "POST /candidates/jobs": [
        {
          status: 202,
          body: { cached: false, job: snapshot(), result: null, candidates_url: null },
        },
        {
          status: 202,
          body: {
            cached: false,
            job: snapshot({ job_id: "job2" }),
            result: null,
            candidates_url: null,
          },
        },
      ],
    });
    const fake = fakeStream();
    restore = fake.restore;
    const store = makeStore({ engine: engineState() });
    store.dispatch(candidateJobRequested({ bagPath: "D:\\bags\\a.bag" }));
    await tick();
    store.dispatch(candidateJobRequested({ bagPath: "D:\\bags\\b.bag", force: true }));
    await tick();
    expect(fake.streams.map((s) => s.closed)).toEqual([true, false]);
    expect(store.getState().candidates.job?.id).toBe("job2");
  });
});
