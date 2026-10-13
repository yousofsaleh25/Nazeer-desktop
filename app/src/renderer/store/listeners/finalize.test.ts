import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick, until, useStoreTimers } from "@/test/time";
import type { MeasurementInput } from "@/api/types";
import { setEngineConnection } from "@/api/connection";
import { engineState } from "@/test/engine";
import { OVERLAY_BYTES, SessionEngine, sha256Hex } from "@/test/sessionEngine";
import {
  forgetVerifiedOverlay,
  keepVerifiedOverlay,
  verifiedOverlay,
} from "../services/overlayBytes";
import { saveStateOf } from "../session/selectors";
import { approvalHolds, overlayApproved, overlayCheckStarted } from "../slices/report";
import { measurementAdded, textEdited } from "../slices/session";
import { makeStore, type RootState } from "../store";
import { openSession } from "../thunks/session";
import { AUTOSAVE_DEBOUNCE_MS } from "./autosave";
import { finalizeRequested, overlayVerifyRequested } from "./finalize";

const line: Omit<MeasurementInput, "id"> = {
  kind: "distance_2d",
  name: "withers height",
  points: [
    [10, 10],
    [10, 90],
  ],
  note: "",
};

async function setup(prepare?: (engine: SessionEngine) => void) {
  const engine = new SessionEngine();
  engine.overlayStamp = await sha256Hex(OVERLAY_BYTES);
  prepare?.(engine);
  const store = makeStore({ engine: engineState() });
  await store.dispatch(openSession(engine.id));
  return { engine, store, state: () => store.getState() };
}

const finalizeCalls = (engine: SessionEngine) =>
  engine.requests.filter((r) => r.path.endsWith("/finalize"));

beforeEach(() => {
  useStoreTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setEngineConnection(null);
  forgetVerifiedOverlay();
});

/** The overlay check has an answer (WebCrypto's digest runs on Node's thread pool). */
const checked = (state: () => RootState) => () =>
  state().report.overlay !== null && state().report.overlay?.state !== "checking";

describe("finalize", () => {
  it("a dirty draft goes with the call at stored + 1; the session seals and the overlay checks out", async () => {
    const { engine, store, state } = await setup();
    store.dispatch(measurementAdded(line));
    store.dispatch(finalizeRequested());
    expect(saveStateOf(state().session)).toBe("finalizing");
    // edits are frozen meanwhile
    store.dispatch(textEdited({ field: "notes", value: "late" }));
    await tick();
    expect(finalizeCalls(engine)[0]?.body).toMatchObject({
      revision: 1,
      document: { measurements: [{ id: 1, name: "withers height" }] },
    });
    expect(state().session.view?.status).toBe("finalized");
    expect(saveStateOf(state().session)).toBe("blocked");
    expect(state().session.draft?.notes).toBe("");
    await until(checked(state));
    expect(state().report.overlay).toMatchObject({ state: "ok", version: 1 });
    // the verified bytes are kept for the approval screen and the print
    expect(verifiedOverlay(engine.id, 1, engine.overlayStamp)?.bytes).toEqual(OVERLAY_BYTES);
    expect(verifiedOverlay(engine.id, 2, engine.overlayStamp)).toBeNull();
    store.dispatch(overlayApproved());
    expect(approvalHolds(state().report, state().session.view)).toBe(true);
    // autosave is off on a sealed session
    await tick(AUTOSAVE_DEBOUNCE_MS * 10);
    expect(engine.requests.filter((r) => r.method === "PUT")).toHaveLength(0);
  });

  it("a clean draft sends only the stored revision", async () => {
    const { engine, store } = await setup((e) => {
      e.inputs = [{ ...line, id: 1, color: "#BE2C2C" }];
      e.revision = 4;
    });
    store.dispatch(finalizeRequested());
    await tick();
    expect(finalizeCalls(engine)[0]?.body).toEqual({ revision: 4 });
  });

  it("a save in flight lands before finalize, which then has nothing more to send", async () => {
    const { engine, store } = await setup();
    engine.pause();
    store.dispatch(measurementAdded(line));
    await tick(AUTOSAVE_DEBOUNCE_MS);
    store.dispatch(finalizeRequested());
    await tick();
    expect(finalizeCalls(engine)).toHaveLength(0);
    engine.resume();
    await tick();
    expect(engine.requests.map((r) => r.method + " " + r.path.split("/").pop())).toEqual([
      `GET ${engine.id}`,
      "PUT document",
      "POST finalize",
      "GET overlay_v1.png",
    ]);
    expect(finalizeCalls(engine)[0]?.body).toEqual({ revision: 1 });
  });

  it("overlay bytes that do not match the engine's stamp are a hard error and cannot be approved", async () => {
    const { engine, store, state } = await setup((e) => {
      e.overlayStamp = "0".repeat(64);
    });
    store.dispatch(finalizeRequested());
    await tick();
    await until(checked(state));
    expect(state().report.overlay).toMatchObject({
      state: "mismatch",
      error: { code: "overlay_hash_mismatch" },
    });
    expect(verifiedOverlay(engine.id, 1, "0".repeat(64))).toBeNull();
    store.dispatch(overlayApproved());
    expect(state().report.approved).toBeNull();
  });

  it("camel_id_required: unfrozen, reconciled with the engine, edits and autosave go on", async () => {
    const { engine, store, state } = await setup((e) => {
      e.camelId = "";
    });
    store.dispatch(finalizeRequested());
    await tick();
    expect(state().session.finalize.error?.code).toBe("camel_id_required");
    expect(state().session.save.finalizing).toBe(false);
    expect(engine.requests.at(-1)?.method).toBe("GET");
    store.dispatch(textEdited({ field: "camelId", value: "C-7" }));
    await tick(AUTOSAVE_DEBOUNCE_MS);
    expect(engine.camelId).toBe("C-7");
    store.dispatch(finalizeRequested());
    await tick();
    expect(state().session.view?.status).toBe("finalized");
  });

  it("a slow check of one session never touches another session's check or kept bytes", async () => {
    const { engine, store, state } = await setup();
    store.dispatch(finalizeRequested());
    await tick();
    await until(checked(state));
    expect(state().report.overlay?.state).toBe("ok");
    // this session's overlay is checked again, its answer held at the engine...
    engine.pause();
    store.dispatch(overlayVerifyRequested());
    await tick();
    // ...while another session's check takes the slot and its bytes are kept
    const other = { sessionId: "20261013_120000_bbbbbb", version: 1, sha256: "b".repeat(64) };
    store.dispatch(overlayCheckStarted({ ...other, url: "/sessions/other/overlay_v1.png" }));
    keepVerifiedOverlay({ ...other, bytes: new Uint8Array([1, 2, 3]) });
    let digests = 0;
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
      const out = await digest(...args);
      digests += 1;
      return out;
    });
    try {
      engine.resume();
      await until(() => digests === 1);
      await tick();
    } finally {
      spy.mockRestore();
    }
    expect(digests).toBe(1);
    expect(state().report.overlay).toMatchObject({ ...other, state: "checking" });
    expect(verifiedOverlay(other.sessionId, other.version, other.sha256)).not.toBeNull();
  });

  it("the overlay of an already finalized session can be checked on request", async () => {
    const { engine, store, state } = await setup();
    store.dispatch(finalizeRequested());
    await tick();
    await until(checked(state));
    const before = engine.requests.length;
    store.dispatch(overlayVerifyRequested());
    await tick();
    await until(checked(state));
    expect(engine.requests.slice(before).map((r) => r.path.split("/").pop())).toEqual([
      "overlay_v1.png",
    ]);
    expect(state().report.overlay?.state).toBe("ok");
  });
});
