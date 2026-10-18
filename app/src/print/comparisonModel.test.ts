import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/comparison_model.json";
import { columnBlocks, columnsPerBlock, parseComparisonModel } from "./comparisonModel";
import { ModelError } from "./model";

const raw = () => structuredClone(fixture) as unknown as Record<string, unknown>;

describe("parseComparisonModel", () => {
  it("reads the engine's comparison model: camels in order, rows with one cell per camel", () => {
    const model = parseComparisonModel(fixture);
    expect(model.members.map((m) => m.position)).toEqual([1, 2, 3]);
    expect(model.rows.every((row) => row.cells.length === 3)).toBe(true);
    // the cases the engine matched: a camel without the measurement, a name used twice by one
    // camel, an unnamed measurement, a rejected one
    expect(model.rows.some((row) => row.cells.includes(null))).toBe(true);
    expect(model.rows.map((row) => row.occurrenceText?.en ?? null)).toContain("(2/2)");
    expect(model.rows.filter((row) => row.unnamed)).toHaveLength(1);
    expect(model.rows.some((row) => row.cells.some((cell) => cell?.rejected === true))).toBe(true);
    expect(model.labels.missing).toEqual({ ar: "—", en: "—" });
    expect(model.labels.disclaimers.length).toBeGreaterThanOrEqual(2);
  });

  it("carries no number to sort or subtract: every value is the engine's text", () => {
    const model = parseComparisonModel(fixture);
    for (const row of model.rows) {
      for (const cell of row.cells) {
        if (cell === null || cell.valueText === null) continue;
        expect(typeof cell.valueText.en).toBe("string");
        expect(Object.keys(cell)).not.toContain("value");
      }
    }
  });

  it("names the first wrong field and refuses another schema", () => {
    const wrongSchema = raw();
    wrongSchema["comparison_model_version"] = "2.0";
    expect(() => parseComparisonModel(wrongSchema)).toThrow(/comparison model 2.0/);

    const shortRow = raw();
    const rows = shortRow["rows"] as { cells: unknown[] }[];
    rows[0]?.cells.pop();
    expect(() => parseComparisonModel(shortRow)).toThrow(/rows\[0\]\.cells has 2 cells for 3/);

    const moved = raw();
    const members = moved["members"] as { position: number }[];
    if (members[1] !== undefined) members[1].position = 5;
    expect(() => parseComparisonModel(moved)).toThrow(ModelError);

    const noHeading = raw();
    const first = (noHeading["members"] as { texts: Record<string, unknown> }[])[0];
    if (first !== undefined) delete first.texts["heading"];
    expect(() => parseComparisonModel(noHeading)).toThrow(/members\[0\]\.texts\.heading/);
  });
});

describe("column blocks", () => {
  it("six camels a block in one language, four when each cell holds both", () => {
    expect(columnsPerBlock("ar")).toBe(6);
    expect(columnsPerBlock("en")).toBe(6);
    expect(columnsPerBlock("both")).toBe(4);
  });

  it("keeps the operator's order and splits 20 camels into full blocks and a rest", () => {
    expect(columnBlocks(3, 6)).toEqual([[0, 1, 2]]);
    const blocks = columnBlocks(20, 6);
    expect(blocks.map((b) => b.length)).toEqual([6, 6, 6, 2]);
    expect(blocks.flat()).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(columnBlocks(20, 4)).toHaveLength(5);
  });
});
