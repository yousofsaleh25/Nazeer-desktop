/**
 * Opt-in (`npm run test:store-real`, scripts/store-real.mjs): the session store against a real
 * engine — the stub-model engine on a throwaway copy of the dev data root's session — instead of
 * the simulated one. Reopen; autosave with If-Match and the engine's echo adopted; a concurrent
 * writer's save merged by the 409 rebase; a report-inputs change (new ETag) followed by an
 * autosave; finalize; the overlay re-hashed with WebCrypto and approved.
 */
import { describe, expect, it } from "vitest";
import { setEngineConnection } from "@/api/connection";
import type { MeasurementInput, SessionView } from "@/api/types";
import { sampleConnection } from "@/design/samples";
import { engineState } from "@/test/engine";
import { finalizeRequested } from "./listeners/finalize";
import { saveStateOf } from "./session/selectors";
import { approvalHolds, overlayApproved } from "./slices/report";
import { measurementAdded, measurementChanged, textEdited } from "./slices/session";
import { makeStore } from "./store";
import { openSession, reopenSession, updateReportInputs } from "./thunks/session";

const spec = (import.meta.env as Record<string, string | undefined>)["NAZEER_REAL_ENGINE"];
const [baseUrl = "", token = "", sessionId = ""] = (spec ?? "").split("|");

async function waitFor(ready: () => boolean, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.runIf(spec !== undefined)("the session store against a real engine", () => {
  it("reopen, autosave, a concurrent save rebased, report inputs, finalize, overlay check", async () => {
    const connection = { ...sampleConnection, baseUrl, token, port: Number(new URL(baseUrl).port) };
    setEngineConnection(connection);
    const store = makeStore({ engine: engineState({ connection }) });
    const session = () => store.getState().session;
    const clean = () => saveStateOf(session()) === "clean";

    expect(await store.dispatch(openSession(sessionId))).toBeNull();
    expect(saveStateOf(session())).toBe("blocked");
    expect(await store.dispatch(reopenSession())).toBeNull();
    expect(session().view?.status).toBe("open");
    const start = session().storedRevision;

    // autosave: one PUT at stored + 1, the engine's echo (its colour) adopted
    store.dispatch(
      measurementAdded({
        kind: "distance_2d",
        name: "store check",
        points: [
          [600, 300],
          [700, 320],
        ],
        note: "",
      }),
    );
    await waitFor(() => clean() && session().storedRevision === start + 1, "the first autosave");
    const added = session().draft?.measurements.at(-1) as MeasurementInput;
    expect(added.color).toMatch(/^#[0-9A-Fa-f]{6}$/);

    // another writer saves first: my next save gets a 409 and is rebased onto it
    const headers = { "X-Nazeer-Token": token, "Content-Type": "application/json" };
    const current = (await (
      await fetch(`${baseUrl}/sessions/${sessionId}`, { headers })
    ).json()) as SessionView;
    const inputs = current.measurements.map((row) => row.input);
    const firstId = inputs[0]?.id;
    const other = await fetch(`${baseUrl}/sessions/${sessionId}/document`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        revision: current.revision + 1,
        measurements: inputs.map((input, i) =>
          i === 0 ? { ...input, name: "renamed elsewhere" } : input,
        ),
      }),
    });
    expect(other.status).toBe(200);
    store.dispatch(measurementChanged({ id: added.id, changes: { note: "mine" } }));
    await waitFor(() => clean() && session().storedRevision === start + 3, "the rebased save");
    const merged = session().view?.measurements ?? [];
    expect(merged.find((r) => r.id === firstId)?.input.name).toBe("renamed elsewhere");
    expect(merged.find((r) => r.id === added.id)?.input.note).toBe("mine");

    // a report-inputs change moves the ETag; the next autosave carries the new one
    expect(await store.dispatch(updateReportInputs({ language: "both" }))).toBeNull();
    store.dispatch(textEdited({ field: "notes", value: "after report inputs" }));
    await waitFor(() => clean() && session().view?.notes === "after report inputs", "autosave");

    // finalize: the overlay rendered once, its bytes re-hashed here, then approved
    store.dispatch(finalizeRequested());
    await waitFor(
      () => ["ok", "mismatch", "error"].includes(store.getState().report.overlay?.state ?? ""),
      "the overlay check",
      60_000,
    );
    expect(store.getState().report.overlay?.state).toBe("ok");
    expect(session().view?.status).toBe("finalized");
    store.dispatch(overlayApproved());
    expect(approvalHolds(store.getState().report, session().view)).toBe(true);
  }, 120_000);
});
