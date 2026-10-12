import { describe, expect, it } from "vitest";
import type { MeasurementInput } from "@/api/types";
import type { SessionDocument } from "./document";
import { rebase } from "./rebase";

function m(id: number, name = `m${id}`): MeasurementInput {
  return {
    id,
    kind: "distance_3d",
    name,
    points: [
      [1, 2],
      [3, 4],
    ],
    note: "",
  };
}

function doc(list: MeasurementInput[], text: Partial<SessionDocument> = {}): SessionDocument {
  return { measurements: list, camelId: "camel", operator: "op", notes: "", ...text };
}

const ids = (d: SessionDocument) => d.measurements.map((x) => x.id);
const base = doc([m(1), m(2), m(3)]);

describe("rebase", () => {
  it("nothing changed on either side: the base", () => {
    expect(rebase(base, base, base)).toEqual({ merged: base, conflicts: [] });
  });

  it("takes my changes and theirs when they touch different measurements", () => {
    const mine = doc([m(1, "mine"), m(2), m(3), m(4)]);
    const theirs = doc([m(1), m(2, "theirs"), m(5)]);
    const { merged, conflicts } = rebase(base, mine, theirs);
    expect(conflicts).toEqual([]);
    // 3 was deleted on their side and untouched by me; 4 is mine, 5 theirs
    expect(ids(merged)).toEqual([1, 2, 4, 5]);
    expect(merged.measurements.map((x) => x.name)).toEqual(["mine", "theirs", "m4", "m5"]);
  });

  it("the same change on both sides is no conflict", () => {
    const same = doc([m(1, "x"), m(2), m(3)]);
    expect(rebase(base, same, same).conflicts).toEqual([]);
  });

  it("two different changes to one measurement are a conflict (mine kept tentatively)", () => {
    const { merged, conflicts } = rebase(
      base,
      doc([m(1, "a"), m(2), m(3)]),
      doc([m(1, "b"), m(2), m(3)]),
    );
    expect(conflicts).toEqual([{ kind: "both_edited", id: 1 }]);
    expect(merged.measurements[0]?.name).toBe("a");
  });

  it("an edit against a delete is a conflict, either way round", () => {
    expect(rebase(base, doc([m(1, "edited"), m(2), m(3)]), doc([m(2), m(3)])).conflicts).toEqual([
      { kind: "edited_deleted", id: 1 },
    ]);
    expect(rebase(base, doc([m(2), m(3)]), doc([m(1, "edited"), m(2), m(3)])).conflicts).toEqual([
      { kind: "deleted_edited", id: 1 },
    ]);
  });

  it("a delete on one side and nothing on the other is taken", () => {
    expect(ids(rebase(base, doc([m(2), m(3)]), base).merged)).toEqual([2, 3]);
    expect(ids(rebase(base, base, doc([m(2), m(3)])).merged)).toEqual([2, 3]);
  });

  it("the same new id added differently on both sides is a conflict", () => {
    const { conflicts } = rebase(
      base,
      doc([...base.measurements, m(4, "a")]),
      doc([...base.measurements, m(4, "b")]),
    );
    expect(conflicts).toEqual([{ kind: "both_added", id: 4 }]);
  });

  it("a reorder on one side is taken; different reorders on both sides conflict", () => {
    const mineMoved = doc([m(3), m(1), m(2)]);
    expect(ids(rebase(base, mineMoved, base).merged)).toEqual([3, 1, 2]);
    expect(ids(rebase(base, base, mineMoved).merged)).toEqual([3, 1, 2]);
    expect(rebase(base, mineMoved, doc([m(2), m(1), m(3)])).conflicts).toEqual([{ kind: "order" }]);
    expect(rebase(base, mineMoved, mineMoved).conflicts).toEqual([]);
  });

  it("text fields merge three ways", () => {
    const { merged, conflicts } = rebase(
      base,
      doc(base.measurements, { camelId: "mine", notes: "n" }),
      doc(base.measurements, { operator: "theirs", notes: "other" }),
    );
    expect(merged).toMatchObject({ camelId: "mine", operator: "theirs", notes: "n" });
    expect(conflicts).toEqual([{ kind: "field", field: "notes" }]);
  });
});
