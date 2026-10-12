import { describe, expect, it } from "vitest";
import view from "../../../../fixtures/session_view.json";
import type { MeasurementInput, SessionView } from "@/api/types";
import {
  adoptEcho,
  documentBody,
  documentOf,
  nextIdAfter,
  sameDocument,
  sameValue,
  type SessionDocument,
} from "./document";

const sample = view as unknown as SessionView;

function line(id: number, extra: Partial<MeasurementInput> = {}): MeasurementInput {
  return {
    id,
    kind: "distance_2d",
    name: `line ${id}`,
    points: [
      [10, 10],
      [20, 20],
    ],
    note: "",
    ...extra,
  };
}

function doc(
  measurements: MeasurementInput[],
  text: Partial<SessionDocument> = {},
): SessionDocument {
  return { measurements, camelId: "c", operator: "o", notes: "", ...text };
}

describe("documentOf", () => {
  it("takes the stored inputs in their stored order and the three text fields", () => {
    const document = documentOf(sample);
    expect(document.measurements.map((m) => m.id)).toEqual(
      [...sample.measurements].sort((a, b) => a.order - b.order).map((r) => r.id),
    );
    expect(document.measurements[0]).toEqual(
      sample.measurements.find((r) => r.id === document.measurements[0]?.id)?.input,
    );
    expect(document).toMatchObject({
      camelId: sample.camel_id,
      operator: sample.operator,
      notes: sample.notes,
    });
  });

  it("orders by `order`, not by the position in the list", () => {
    const shuffled = { ...sample, measurements: [...sample.measurements].reverse() };
    expect(documentOf(shuffled).measurements.map((m) => m.id)).toEqual(
      documentOf(sample).measurements.map((m) => m.id),
    );
  });
});

describe("sameValue and sameDocument", () => {
  it("compare plain data structurally (order of keys aside, order of lists kept)", () => {
    expect(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue({ a: null }, { a: undefined })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameDocument(doc([line(1), line(2)]), doc([line(1), line(2)]))).toBe(true);
    expect(sameDocument(doc([line(1), line(2)]), doc([line(2), line(1)]))).toBe(false);
    expect(sameDocument(doc([line(1)]), doc([line(1)], { notes: "x" }))).toBe(false);
  });
});

describe("adoptEcho", () => {
  it("takes the engine's echo of what is unchanged since sending, keeps edits made meanwhile", () => {
    const sent = doc([line(1, { color: null }), line(2, { color: null })]);
    const stored = doc([line(1, { color: "#BE2C2C" }), line(2, { color: "#2C57BE" })], {
      camelId: "C-1",
    });
    const draft = doc([
      line(1, { color: null }),
      line(2, { color: null, name: "renamed" }),
      line(3),
    ]);
    const adopted = adoptEcho(draft, sent, { ...stored, camelId: "C-1" });
    expect(adopted.measurements[0]?.color).toBe("#BE2C2C");
    expect(adopted.measurements[1]).toMatchObject({ name: "renamed", color: null });
    expect(adopted.measurements[2]?.id).toBe(3);
    expect(adopted.camelId).toBe("C-1");
  });
});

describe("documentBody and nextIdAfter", () => {
  it("send the whole ordered list, the text fields and the id counter", () => {
    expect(documentBody(doc([line(4)], { camelId: "x" }), 9)).toEqual({
      measurements: [line(4)],
      camel_id: "x",
      operator: "o",
      notes: "",
      next_measurement_id: 9,
    });
  });

  it("never go below an id the document holds", () => {
    expect(nextIdAfter(3, doc([line(1), line(7)]))).toBe(8);
    expect(nextIdAfter(12, doc([line(1), line(7)]))).toBe(12);
  });
});
