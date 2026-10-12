import { afterEach, describe, expect, it } from "vitest";
import { setEngineConnection } from "@/api/connection";
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
