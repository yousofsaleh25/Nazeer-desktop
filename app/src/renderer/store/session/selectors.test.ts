import { describe, expect, it } from "vitest";
import fixture from "../../../../fixtures/session_view.json";
import type { MeasurementInput, MeasurementRow, SessionView } from "@/api/types";
import {
  measurementAdded,
  measurementChanged,
  measurementRemoved,
  previewReplied,
  previewRequested,
  sessionLoaded,
  sessionReducer,
  SESSION_INITIAL,
  type SessionState,
} from "../slices/session";
import { displayRows, sameGeometry } from "./selectors";

const view: SessionView = { ...(fixture as unknown as SessionView), status: "open" };
const rows = view.measurements;
const line = rows.find((row) => row.kind === "distance_2d")!;
const otherLine = rows.find((row) => row.kind === "distance_2d" && row.id !== line.id)!;

function loaded(measurements: MeasurementRow[] = rows): SessionState {
  return sessionReducer(
    SESSION_INITIAL,
    sessionLoaded({ view: { ...view, measurements }, etag: null }),
  );
}

const statusOf = (state: SessionState, id: number) =>
  displayRows(state).find((item) => item.input.id === id);

describe("the rows the measuring screen shows", () => {
  it("geometry is kind, points, targets and lines; name, note and colour are not", () => {
    const input = line.input;
    expect(sameGeometry(input, { ...input, name: "x", note: "y", color: "#000000" })).toBe(true);
    expect(
      sameGeometry(input, {
        ...input,
        points: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toBe(false);
    expect(sameGeometry(input, { ...input, targets: ["ground", "camel"] })).toBe(false);
    // targets left out are the engine's default: every point on the camel
    expect(input.targets).toEqual(["camel", "camel"]);
    expect(sameGeometry({ ...input, targets: null }, input)).toBe(true);
  });

  it("a rename keeps the engine's stored value on screen, marked not saved yet", () => {
    const state = sessionReducer(
      loaded(),
      measurementChanged({ id: line.id, changes: { name: "renamed", color: "#2C57BE" } }),
    );
    const item = statusOf(state, line.id)!;
    expect(item.status).toBe("pending");
    expect(item.row?.presentation).toEqual(line.presentation);
    expect(item.row).toMatchObject({ name: "renamed", display_color: "#2C57BE" });
  });

  it("a moved point has no value until the engine computes one", () => {
    const state = sessionReducer(
      loaded(),
      measurementChanged({
        id: line.id,
        changes: {
          points: [
            [10, 10],
            [20, 20],
          ],
        },
      }),
    );
    expect(statusOf(state, line.id)).toMatchObject({ status: "pending", row: null });
  });

  it("the drawing preview (unnamed) counts for the named measurement of the same geometry", () => {
    let state = loaded([]);
    const id = state.nextMeasurementId;
    const fields: Omit<MeasurementInput, "id"> = {
      kind: "distance_3d",
      name: "",
      points: [
        [1, 1],
        [9, 9],
      ],
      targets: ["camel", "camel"],
      note: "",
    };
    const unnamed: MeasurementInput = { id, ...fields };
    state = sessionReducer(state, previewRequested({ measurement: unnamed }));
    const seq = state.preview.inFlight!.seq;
    state = sessionReducer(state, previewReplied({ seq, row: { ...line, id, input: unnamed } }));
    state = sessionReducer(state, measurementAdded({ ...fields, name: "withers" }));
    const item = statusOf(state, id)!;
    expect(item.status).toBe("preview");
    expect(item.row?.name).toBe("withers");
  });

  it("a 4-point angle waits while one of its lines is changed or deleted and not saved", () => {
    const angle: MeasurementRow = {
      ...line,
      id: 900,
      kind: "angle_2d_4point",
      family: "angles",
      input_kind: "angle_4point",
      input: {
        id: 900,
        kind: "angle_4point",
        name: "between",
        points: [],
        targets: [],
        line_a_id: line.id,
        line_b_id: otherLine.id,
        color: null,
        note: "",
      },
    };
    const base = loaded([line, otherLine, angle]);
    expect(statusOf(base, 900)?.status).toBe("saved");
    const moved = sessionReducer(
      base,
      measurementChanged({
        id: line.id,
        changes: {
          points: [
            [5, 5],
            [6, 6],
          ],
        },
      }),
    );
    expect(statusOf(moved, 900)).toMatchObject({ status: "pending", row: null });
    const deleted = sessionReducer(base, measurementRemoved(otherLine.id));
    expect(statusOf(deleted, 900)?.status).toBe("pending");
    // a line already gone from both sides: the stored angle (rejected) is final
    const gone = loaded([line, angle]);
    expect(statusOf(gone, 900)?.status).toBe("saved");
  });
});
