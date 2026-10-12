import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "@/api/client";
import { setEngineConnection } from "@/api/connection";
import { sampleConnection } from "@/design/samples";
import { engineState } from "@/test/engine";
import { SessionEngine } from "@/test/sessionEngine";
import { tick, useStoreTimers } from "@/test/time";
import { keepVerifiedOverlay, verifiedOverlay } from "../services/overlayBytes";
import { makeStore } from "../store";
import { DELETE_RETRY_MS, deleteSessionById, reopenSessionById } from "./history";
import { openSession } from "./session";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const busy = () => json(409, { error: { code: "session_busy", message: "busy", details: {} } });

/** An engine answering DELETE with the given responses, in order. */
function deleteEngine(...answers: (() => Response)[]) {
  const seen: string[] = [];
  const fetchImpl: FetchLike = (request) => {
    seen.push(`${request.method} ${new URL(request.url).pathname}`);
    const next = answers.shift() ?? (() => json(200, { deleted: true, trashed_to: "t" }));
    return Promise.resolve(next());
  };
  setEngineConnection(sampleConnection, fetchImpl);
  return seen;
}

beforeEach(() => {
  useStoreTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setEngineConnection(null);
});

describe("deleting a session from History", () => {
  it("a busy session (a save finishing) is tried again; then it is gone", async () => {
    const seen = deleteEngine(busy, busy);
    const store = makeStore({ engine: engineState() });
    const done = store.dispatch(deleteSessionById("20261012_101010_abcdef"));
    await tick(DELETE_RETRY_MS);
    await tick(DELETE_RETRY_MS);
    expect(await done).toBeNull();
    expect(seen).toEqual(Array(3).fill("DELETE /sessions/20261012_101010_abcdef"));
  });

  it("a 404 means it is already gone: done", async () => {
    deleteEngine(() =>
      json(404, { error: { code: "session_not_found", message: "gone", details: {} } }),
    );
    const store = makeStore({ engine: engineState() });
    expect(await store.dispatch(deleteSessionById("20261012_101010_abcdef"))).toBeNull();
  });

  it("any other failure is reported, and a session that stays busy too", async () => {
    deleteEngine(() =>
      json(409, { error: { code: "delete_failed", message: "a file is open", details: {} } }),
    );
    const store = makeStore({ engine: engineState() });
    expect(await store.dispatch(deleteSessionById("x"))).toMatchObject({ code: "delete_failed" });

    deleteEngine(busy, busy, busy, busy, busy);
    const done = store.dispatch(deleteSessionById("y"));
    for (let i = 0; i < 4; i += 1) await tick(DELETE_RETRY_MS);
    expect(await done).toMatchObject({ code: "session_busy" });
  });

  it("the open session is forgotten first (with its verified overlay); others are not touched", async () => {
    const engine = new SessionEngine();
    const store = makeStore({ engine: engineState() });
    await store.dispatch(openSession(engine.id));
    keepVerifiedOverlay({ sessionId: engine.id, version: 1, sha256: "a", bytes: new Uint8Array() });
    deleteEngine();
    expect(await store.dispatch(deleteSessionById(engine.id))).toBeNull();
    expect(store.getState().session.id).toBeNull();
    expect(verifiedOverlay(engine.id, 1, "a")).toBeNull();
  });
});

describe("reopening from History", () => {
  it("loads the session, reopens it and leaves it open in the store", async () => {
    const engine = new SessionEngine();
    engine.status = "exported";
    const store = makeStore({ engine: engineState() });
    expect(await store.dispatch(reopenSessionById(engine.id))).toBeNull();
    expect(engine.requests.map((r) => `${r.method} ${r.path.split("/").pop()}`)).toEqual([
      `GET ${engine.id}`,
      "POST reopen",
    ]);
    expect(store.getState().session).toMatchObject({
      id: engine.id,
      view: { status: "open" },
      save: { blocked: false },
    });
  });
});
