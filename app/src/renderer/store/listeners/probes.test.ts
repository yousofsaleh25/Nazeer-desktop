import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick, useStoreTimers } from "@/test/time";
import type { MeasurementInput } from "@/api/types";
import { setEngineConnection } from "@/api/connection";
import { engineState } from "@/test/engine";
import { SessionEngine } from "@/test/sessionEngine";
import { displayRows } from "../session/selectors";
import { depthRequested, measurementAdded, previewRequested, toolChanged } from "../slices/session";
import { makeStore } from "../store";
import { openSession } from "../thunks/session";
import { PROBE_TIMEOUT_MS } from "./probes";

async function setup() {
  const engine = new SessionEngine();
  const store = makeStore({ engine: engineState() });
  await store.dispatch(openSession(engine.id));
  return { engine, store, session: () => store.getState().session };
}

const depthCalls = (engine: SessionEngine) =>
  engine.requests.filter((r) => r.path.endsWith("/depth"));

beforeEach(() => {
  useStoreTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setEngineConnection(null);
});

describe("hover and preview", () => {
  it("one depth request in flight; the newest pointer position goes out when it answers", async () => {
    const { engine, store, session } = await setup();
    engine.pause();
    store.dispatch(depthRequested({ u: 1, v: 1, target: "camel" }));
    store.dispatch(depthRequested({ u: 2, v: 2, target: "camel" }));
    store.dispatch(depthRequested({ u: 3, v: 3, target: "ground" }));
    await tick();
    expect(depthCalls(engine).map((r) => r.body)).toEqual([
      { u: 1, v: 1, target: "camel", seq: 1 },
    ]);
    engine.resume();
    await tick();
    expect(depthCalls(engine).map((r) => r.body)).toEqual([
      { u: 1, v: 1, target: "camel", seq: 1 },
      { u: 3, v: 3, target: "ground", seq: 2 },
    ]);
    expect(session().depth.resultSeq).toBe(2);
    expect(session().depth.result?.seq).toBe(2);
  });

  it("an answer that lands after a tool change is dropped but frees the slot", async () => {
    const { engine, store, session } = await setup();
    engine.pause();
    store.dispatch(depthRequested({ u: 1, v: 1, target: "camel" }));
    await tick();
    store.dispatch(toolChanged("distance_3d"));
    engine.resume();
    await tick();
    expect(session().depth.result).toBeNull();
    expect(session().depth.inFlight).toBeNull();
  });

  it("a request that never answers times out after 5 s and frees the slot", async () => {
    const { engine, store, session } = await setup();
    engine.pause();
    store.dispatch(depthRequested({ u: 1, v: 1, target: "camel" }));
    await tick(PROBE_TIMEOUT_MS + 10);
    expect(session().depth.inFlight).toBeNull();
    engine.resume();
  });

  it("a preview row is kept for the input it was computed for and shown until saved", async () => {
    const { store, session } = await setup();
    const id = session().nextMeasurementId;
    const fields: Omit<MeasurementInput, "id"> = {
      kind: "curve_3d",
      name: "back line",
      points: [
        [1, 1],
        [5, 5],
        [9, 2],
      ],
      note: "",
    };
    const input: MeasurementInput = { ...fields, id };
    store.dispatch(previewRequested({ measurement: input }));
    await tick();
    expect(session().previews[id]?.input).toEqual(input);
    store.dispatch(measurementAdded(fields));
    expect(displayRows(session()).map((r) => r.status)).toEqual(["preview"]);
    // a different input (moved point) has no preview yet
    expect(displayRows({ ...session(), previews: {} }).map((r) => r.status)).toEqual(["pending"]);
  });
});
