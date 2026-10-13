import { afterEach, describe, expect, it } from "vitest";
import { setEngineConnection } from "@/api/connection";
import { sampleConnection } from "@/design/samples";
import { connectFixtureEngine, engineState } from "@/test/engine";
import { historyPageChanged, historyParams, historyQueryChanged } from "../slices/history";
import { makeStore } from "../store";
import { inspectBag } from "./bag";

afterEach(() => setEngineConnection(null));

const INFO = { path: "D:\\bags\\006.bag", name: "006.bag", fingerprint: "a".repeat(64) };

describe("inspectBag", () => {
  it("sends only the path and keeps what the engine read", async () => {
    const fetchImpl = connectFixtureEngine(undefined, {
      "/bags/inspect": { status: 200, body: INFO },
    });
    const store = makeStore({ engine: engineState() });
    await expect(store.dispatch(inspectBag(INFO.path))).resolves.toBeNull();
    const request = fetchImpl.requests.find((r) => r.url.endsWith("/bags/inspect"));
    await expect(request?.clone().json()).resolves.toEqual({ path: INFO.path });
    expect(store.getState().bag).toMatchObject({ path: INFO.path, inspect: { state: "ready" } });
    expect(store.getState().bag.info?.fingerprint).toBe(INFO.fingerprint);
  });

  it("a slow answer for an earlier bag never replaces the bag opened after it", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    setEngineConnection(sampleConnection, async (request) => {
      const { path } = (await request.clone().json()) as { path: string };
      const slow = path.endsWith("A.bag");
      if (slow) await held;
      if (slow) {
        return new Response(
          JSON.stringify({ error: { code: "bag_unreadable", message: "A", details: {} } }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ...INFO, path, fingerprint: "b".repeat(64) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const store = makeStore({ engine: engineState() });
    const first = store.dispatch(inspectBag("D:\\bags\\A.bag"));
    await store.dispatch(inspectBag("D:\\bags\\B.bag"));
    release();
    await first;
    expect(store.getState().bag).toMatchObject({
      path: "D:\\bags\\B.bag",
      inspect: { state: "ready", error: null },
      info: { fingerprint: "b".repeat(64) },
    });
  });

  it("an engine error is kept for the screen", async () => {
    connectFixtureEngine(undefined, {
      "/bags/inspect": {
        status: 404,
        body: { error: { code: "bag_not_found", message: "no such bag", details: {} } },
      },
    });
    const store = makeStore({ engine: engineState() });
    const error = await store.dispatch(inspectBag("D:\\missing.bag"));
    expect(error?.code).toBe("bag_not_found");
    expect(store.getState().bag.inspect).toMatchObject({ state: "error" });
  });
});

describe("History's query", () => {
  it("maps to GET /sessions parameters; a new query starts at the first page", () => {
    const store = makeStore();
    store.dispatch(historyPageChanged(3));
    expect(historyParams(store.getState().history)).toMatchObject({ offset: 150, limit: 50 });
    store.dispatch(historyQueryChanged({ q: "  جمل-7 ", status: "exported" }));
    expect(historyParams(store.getState().history)).toEqual({
      q: "جمل-7",
      status: "exported",
      index_state: undefined,
      sort: "updated_desc",
      limit: 50,
      offset: 0,
    });
  });
});
