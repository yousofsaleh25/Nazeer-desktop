import { describe, expect, it } from "vitest";
import fixture from "../../../../fixtures/session_view.json";
import type { MeasurementInput, SessionView } from "@/api/types";
import { MAX_MEASUREMENTS } from "../session/document";
import { canAddMeasurement, displayRows, hasUnsavedWork, saveStateOf } from "../session/selectors";
import {
  finalizeStarted,
  measurementAdded,
  measurementMoved,
  measurementRemoved,
  redone,
  sessionLoaded,
  sessionReducer,
  SESSION_INITIAL,
  textEdited,
  undone,
  type SessionState,
} from "./session";

const exported = fixture as unknown as SessionView;
const open: SessionView = { ...exported, status: "open" };
const fields: Omit<MeasurementInput, "id"> = {
  kind: "distance_2d",
  name: "x",
  points: [
    [1, 1],
    [2, 2],
  ],
  note: "",
};

function loaded(view: SessionView = open): SessionState {
  return sessionReducer(SESSION_INITIAL, sessionLoaded({ view, etag: '"r9-a"' }));
}

describe("the session slice", () => {
  it("a loaded session is clean; its rows are the engine's (saved)", () => {
    const state = loaded();
    expect(saveStateOf(state)).toBe("clean");
    expect(hasUnsavedWork(state)).toBe(false);
    expect(displayRows(state).every((r) => r.status === "saved" && r.row !== null)).toBe(true);
    expect(state.nextMeasurementId).toBe(open.next_measurement_id);
  });

  it("an exported session is read-only: blocked, edits ignored", () => {
    const state = loaded(exported);
    expect(saveStateOf(state)).toBe("blocked");
    const after = sessionReducer(state, measurementAdded(fields));
    expect(after.draft).toBe(state.draft);
    expect(canAddMeasurement(state)).toBe(false);
  });

  it("edits are frozen while finalizing", () => {
    const state = sessionReducer(loaded(), finalizeStarted());
    expect(sessionReducer(state, textEdited({ field: "notes", value: "x" })).draft).toBe(
      state.draft,
    );
  });

  it("a new measurement is pending (no engine row yet) and makes the session dirty", () => {
    const state = sessionReducer(loaded(), measurementAdded(fields));
    const rows = displayRows(state);
    expect(rows.at(-1)).toMatchObject({ status: "pending", row: null });
    expect(saveStateOf(state)).toBe("dirty");
    expect(hasUnsavedWork(state)).toBe(true);
    expect(state.selection).toBe(open.next_measurement_id);
  });

  it("moves stay inside the list; undo and redo walk the history", () => {
    let state = loaded();
    const first = state.draft?.measurements[0]?.id as number;
    expect(sessionReducer(state, measurementMoved({ id: first, delta: -1 }))).toBe(state);
    state = sessionReducer(state, measurementMoved({ id: first, delta: 1 }));
    expect(state.draft?.measurements[1]?.id).toBe(first);
    state = sessionReducer(state, measurementRemoved(first));
    expect(state.draft?.measurements.some((m) => m.id === first)).toBe(false);
    state = sessionReducer(state, undone());
    state = sessionReducer(state, undone());
    expect(state.draft?.measurements[0]?.id).toBe(first);
    state = sessionReducer(state, redone());
    expect(state.draft?.measurements[1]?.id).toBe(first);
  });

  it("at most 500 measurements", () => {
    const many: SessionView = {
      ...open,
      measurements: Array.from({ length: MAX_MEASUREMENTS }, (_, i) => ({
        ...(open.measurements[0] as SessionView["measurements"][number]),
        id: i + 1,
        order: i,
        input: { ...fields, id: i + 1 },
      })),
      next_measurement_id: MAX_MEASUREMENTS + 1,
    };
    const state = loaded(many);
    expect(canAddMeasurement(state)).toBe(false);
    expect(sessionReducer(state, measurementAdded(fields)).draft?.measurements).toHaveLength(
      MAX_MEASUREMENTS,
    );
  });
});
