import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick, useStoreTimers } from "@/test/time";
import type { MeasurementInput } from "@/api/types";
import { setEngineConnection } from "@/api/connection";
import { sampleConnection } from "@/design/samples";
import { engineState } from "@/test/engine";
import { SessionEngine } from "@/test/sessionEngine";
import { flushAutosave } from "../session/flush";
import { saveStateOf } from "../session/selectors";
import { engineStatusReceived } from "../slices/engine";
import {
  conflictResolved,
  measurementAdded,
  measurementChanged,
  textEdited,
  undone,
} from "../slices/session";
import { makeStore } from "../store";
import { openSession, reopenSession } from "../thunks/session";
import { AUTOSAVE_DEBOUNCE_MS, autosaveFlushRequested } from "./autosave";

type NewInput = Omit<MeasurementInput, "id">;

function line(name: string): NewInput {
  return {
    kind: "distance_3d",
    name,
    points: [
      [10, 10],
      [40, 30],
    ],
    note: "",
  };
}

async function setup(prepare?: (engine: SessionEngine) => void) {
  const engine = new SessionEngine();
  prepare?.(engine);
  const store = makeStore({ engine: engineState() });
  await store.dispatch(openSession(engine.id));
  return { engine, store, session: () => store.getState().session };
}

const puts = (engine: SessionEngine) => engine.requests.filter((r) => r.method === "PUT");

beforeEach(() => {
  useStoreTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setEngineConnection(null);
});

describe("autosave", () => {
  it("waits 250 ms after the last edit, then PUTs the whole list at stored + 1 with If-Match", async () => {
    const { engine, store, session } = await setup();
    store.dispatch(measurementAdded(line("first")));
    await tick(100);
    store.dispatch(measurementAdded(line("second")));
    await tick(AUTOSAVE_DEBOUNCE_MS - 10);
    expect(puts(engine)).toHaveLength(0);
    expect(saveStateOf(session())).toBe("dirty");
    await tick(20);
    expect(puts(engine)).toHaveLength(1);
    const [put] = puts(engine);
    expect(put?.headers.get("If-Match")).toBe('"r0-0"');
    expect(put?.body).toMatchObject({
      revision: 1,
      camel_id: "C-1",
      next_measurement_id: 3,
      measurements: [
        { id: 1, name: "first" },
        { id: 2, name: "second" },
      ],
    });
    expect(saveStateOf(session())).toBe("clean");
    expect(session().storedRevision).toBe(1);
    // the engine's echo (it filled the colour) is adopted, so nothing looks unsaved
    expect(session().draft?.measurements[0]?.color).toBe("#BE2C2C");
  });

  it("keeps one save in flight and sends what changed meanwhile right after its answer", async () => {
    const { engine, store, session } = await setup();
    engine.pause();
    store.dispatch(measurementAdded(line("a")));
    await tick(AUTOSAVE_DEBOUNCE_MS);
    expect(saveStateOf(session())).toBe("saving");
    store.dispatch(measurementAdded(line("b")));
    store.dispatch(measurementChanged({ id: 1, changes: { name: "a2" } }));
    await tick(AUTOSAVE_DEBOUNCE_MS * 4);
    expect(puts(engine)).toHaveLength(1);
    engine.resume();
    await tick();
    expect(puts(engine)).toHaveLength(2);
    expect(puts(engine)[1]?.body).toMatchObject({
      revision: 2,
      measurements: [{ name: "a2" }, { name: "b" }],
    });
    expect(saveStateOf(session())).toBe("clean");
    expect(engine.inputs.map((i) => i.name)).toEqual(["a2", "b"]);
  });

  it("a save whose answer was lost is retried as it was and lands once (replay = 200)", async () => {
    const { engine, store, session } = await setup();
    engine.inject("PUT", "/document", "lost");
    store.dispatch(measurementAdded(line("a")));
    await tick(AUTOSAVE_DEBOUNCE_MS);
    expect(saveStateOf(session())).toBe("offline");
    expect(engine.revision).toBe(1);
    await tick(1000);
    expect(puts(engine).map((p) => (p.body as { revision: number }).revision)).toEqual([1, 1]);
    expect(saveStateOf(session())).toBe("clean");
    expect(session().storedRevision).toBe(1);
  });

  it("409: my addition is rebased onto another save and sent at its revision + 1", async () => {
    const { engine, store, session } = await setup();
    engine.externalSave((inputs) => [...inputs, { ...line("theirs"), id: 50 }]);
    store.dispatch(measurementAdded(line("mine")));
    await tick(AUTOSAVE_DEBOUNCE_MS);
    expect(puts(engine)).toHaveLength(2);
    expect(puts(engine)[1]?.body).toMatchObject({ revision: 2 });
    expect(engine.inputs.map((i) => [i.id, i.name])).toEqual([
      [1, "mine"],
      [50, "theirs"],
    ]);
    expect(saveStateOf(session())).toBe("clean");
    expect(session().nextMeasurementId).toBe(51);
  });

  it("409 with a clash: a conflict until the operator chooses; keep mine is sent next", async () => {
    const { engine, store, session } = await setup((e) => {
      e.inputs = [{ ...line("base"), id: 1, color: "#BE2C2C" }];
      e.nextId = 2;
    });
    engine.externalSave((inputs) => inputs.map((i) => ({ ...i, name: "theirs" })));
    store.dispatch(measurementChanged({ id: 1, changes: { name: "mine" } }));
    await tick(AUTOSAVE_DEBOUNCE_MS * 8);
    expect(saveStateOf(session())).toBe("conflict");
    expect(session().save.conflict?.conflicts).toEqual([{ kind: "both_edited", id: 1 }]);
    expect(puts(engine)).toHaveLength(1);
    // no edits while the conflict is open
    store.dispatch(textEdited({ field: "notes", value: "x" }));
    expect(session().draft?.notes).toBe("");
    store.dispatch(conflictResolved("mine"));
    await tick();
    expect(puts(engine)[1]?.body).toMatchObject({ revision: 2, measurements: [{ name: "mine" }] });
    expect(saveStateOf(session())).toBe("clean");
  });

  it("409 on a session finalized elsewhere: blocked, nothing sent; reopening saves the draft", async () => {
    const { engine, store, session } = await setup();
    store.dispatch(measurementAdded(line("mine")));
    engine.externalSave((inputs) => inputs);
    engine.status = "finalized";
    await tick(AUTOSAVE_DEBOUNCE_MS * 8);
    expect(saveStateOf(session())).toBe("blocked");
    expect(puts(engine)).toHaveLength(1);
    // the operator's measurement is still shown, unsaved
    expect(session().draft?.measurements.map((m) => m.name)).toEqual(["mine"]);
    await store.dispatch(reopenSession());
    await tick();
    expect(engine.inputs.map((i) => i.name)).toEqual(["mine"]);
    expect(saveStateOf(session())).toBe("clean");
  });

  it("a terminal 4xx: error, no retry until the draft changes", async () => {
    const { engine, store, session } = await setup();
    engine.inject("PUT", "/document", {
      status: 422,
      body: { error: { code: "invalid_measurement", message: "bad", details: {} } },
    });
    store.dispatch(measurementAdded(line("a")));
    await tick(AUTOSAVE_DEBOUNCE_MS);
    expect(saveStateOf(session())).toBe("error");
    await tick(60_000);
    // not even a flush (quitting, leaving the screen) sends the same refused document again
    store.dispatch(autosaveFlushRequested());
    await tick();
    expect(puts(engine)).toHaveLength(1);
    store.dispatch(measurementChanged({ id: 1, changes: { name: "fixed" } }));
    await tick(AUTOSAVE_DEBOUNCE_MS);
    expect(puts(engine)).toHaveLength(2);
    expect(saveStateOf(session())).toBe("clean");
  });

  it("network failures are retried after 1 s, then 2 s, until the engine answers", async () => {
    const { engine, store, session } = await setup();
    engine.inject("PUT", "/document", "network");
    engine.inject("PUT", "/document", "network");
    store.dispatch(measurementAdded(line("a")));
    await tick(AUTOSAVE_DEBOUNCE_MS);
    expect(saveStateOf(session())).toBe("offline");
    await tick(999);
    expect(puts(engine)).toHaveLength(1);
    await tick(1);
    expect(puts(engine)).toHaveLength(2);
    await tick(2000);
    expect(puts(engine)).toHaveLength(3);
    expect(saveStateOf(session())).toBe("clean");
  });

  it("no engine: offline; when it is ready again the session is fetched, then saved", async () => {
    const { engine, store, session } = await setup();
    setEngineConnection(null);
    store.dispatch(measurementAdded(line("a")));
    await tick(AUTOSAVE_DEBOUNCE_MS + 60_000);
    expect(saveStateOf(session())).toBe("offline");
    expect(puts(engine)).toHaveLength(0);
    const restarted = { ...sampleConnection, token: "f".repeat(64), pid: 4242 };
    setEngineConnection(restarted, engine.fetch);
    const gets = engine.requests.length;
    store.dispatch(
      engineStatusReceived({
        seq: 9,
        status: "ready",
        connection: restarted,
        fatal: null,
        restarts: 1,
        unresponsive: false,
      }),
    );
    await tick();
    expect(engine.requests.slice(gets).map((r) => r.method)).toEqual(["GET", "PUT"]);
    expect(saveStateOf(session())).toBe("clean");
  });

  it("flush sends at once and reports nothing unsaved after the answer", async () => {
    const { engine, store } = await setup();
    store.dispatch(measurementAdded(line("a")));
    const flushed = flushAutosave(store);
    await tick();
    await expect(flushed).resolves.toEqual({ unsaved: false });
    expect(puts(engine)).toHaveLength(1);
  });

  it("flush with the engine gone reports the unsaved work at once", async () => {
    const { store } = await setup();
    setEngineConnection(null);
    store.dispatch(measurementAdded(line("a")));
    const flushed = flushAutosave(store);
    await tick();
    await expect(flushed).resolves.toEqual({ unsaved: true });
  });

  it("ids never decrease: undo removes the measurement but not its id", async () => {
    const { store, session } = await setup();
    store.dispatch(measurementAdded(line("a")));
    store.dispatch(undone());
    store.dispatch(measurementAdded(line("b")));
    expect(session().draft?.measurements.map((m) => m.id)).toEqual([2]);
    expect(session().nextMeasurementId).toBe(3);
  });
});
