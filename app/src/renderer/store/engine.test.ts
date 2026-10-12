import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineStatusEvent, NazeerApi } from "@shared/ipc";
import { activeEngine, setEngineConnection } from "@/api/connection";
import { engineApi } from "@/api/engineApi";
import { sampleConnection } from "@/design/samples";
import { connectEngineBridge } from "./engineBridge";
import { ENGINE_INITIAL, engineReducer, engineStatusReceived } from "./slices/engine";
import { makeStore } from "./store";

function event(seq: number, change: Partial<EngineStatusEvent> = {}): EngineStatusEvent {
  return {
    seq,
    status: "starting",
    connection: null,
    fatal: null,
    restarts: 0,
    unresponsive: false,
    ...change,
  };
}

function fakeBridge(initial: EngineStatusEvent) {
  let listener: ((e: EngineStatusEvent) => void) | null = null;
  let resolveStatus: (e: EngineStatusEvent) => void = () => undefined;
  const bridge: NazeerApi["engine"] = {
    getConnection: vi.fn(() => Promise.resolve(null)),
    getStatus: vi.fn(
      () =>
        new Promise<EngineStatusEvent>((resolve) => {
          resolveStatus = resolve;
        }),
    ),
    retry: vi.fn(() => Promise.resolve()),
    onStatus: vi.fn((l: (e: EngineStatusEvent) => void) => {
      listener = l;
      return () => {
        listener = null;
      };
    }),
  };
  return {
    bridge,
    push: (e: EngineStatusEvent) => listener?.(e),
    answerGetStatus: () => resolveStatus(initial),
    subscribed: () => listener !== null,
  };
}

afterEach(() => {
  setEngineConnection(null);
});

describe("engine slice", () => {
  it("applies newer events and drops older ones", () => {
    let state = engineReducer(ENGINE_INITIAL, engineStatusReceived(event(2, { status: "ready" })));
    expect(state.status).toBe("ready");
    state = engineReducer(state, engineStatusReceived(event(1, { status: "starting" })));
    expect(state.status).toBe("ready");
    state = engineReducer(
      state,
      engineStatusReceived(event(3, { status: "restarting", restarts: 1 })),
    );
    expect(state).toMatchObject({ status: "restarting", restarts: 1, seq: 3 });
  });
});

describe("connectEngineBridge", () => {
  it("a getStatus() reply older than a pushed event does not undo it", async () => {
    const store = makeStore();
    const fake = fakeBridge(event(1, { status: "starting" }));
    connectEngineBridge(store, fake.bridge);
    fake.push(event(2, { status: "ready", connection: sampleConnection }));
    fake.answerGetStatus();
    await Promise.resolve();
    expect(store.getState().engine.status).toBe("ready");
  });

  it("swaps the client and clears the API cache whenever the connection changes", () => {
    const store = makeStore();
    const fake = fakeBridge(event(1));
    connectEngineBridge(store, fake.bridge);
    fake.push(event(2, { status: "ready", connection: sampleConnection }));
    expect(activeEngine()?.connection).toEqual(sampleConnection);

    // something cached from this engine
    void store.dispatch(
      engineApi.util.upsertQueryData("getVersions", undefined, { engine_version: "0.1.0" }),
    );
    expect(Object.keys(store.getState().engineApi.queries)).not.toHaveLength(0);

    fake.push(event(3, { status: "restarting", connection: null, restarts: 1 }));
    expect(activeEngine()).toBeNull();
    expect(store.getState().engineApi.queries).toEqual({});

    const next = { ...sampleConnection, port: 52000, baseUrl: "http://127.0.0.1:52000", pid: 1 };
    fake.push(event(4, { status: "ready", connection: next, restarts: 1 }));
    expect(activeEngine()?.connection.port).toBe(52000);
  });

  it("an unchanged connection keeps the client and the cache (e.g. watchdog flips)", () => {
    const store = makeStore();
    const fake = fakeBridge(event(1));
    connectEngineBridge(store, fake.bridge);
    fake.push(event(2, { status: "ready", connection: sampleConnection }));
    const client = activeEngine()?.client;
    void store.dispatch(engineApi.util.upsertQueryData("getVersions", undefined, { a: "1" }));
    fake.push(event(3, { status: "ready", connection: sampleConnection, unresponsive: true }));
    expect(activeEngine()?.client).toBe(client);
    expect(Object.keys(store.getState().engineApi.queries)).not.toHaveLength(0);
    expect(store.getState().engine.unresponsive).toBe(true);
  });

  it("without the bridge the app shows bridge_missing", () => {
    const store = makeStore();
    connectEngineBridge(store, undefined);
    expect(store.getState().engine).toMatchObject({
      status: "fatal",
      fatal: { code: "bridge_missing" },
    });
  });

  it("disposing stops applying events", () => {
    const store = makeStore();
    const fake = fakeBridge(event(1));
    const dispose = connectEngineBridge(store, fake.bridge);
    dispose();
    expect(fake.subscribed()).toBe(false);
  });
});
