import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/comparison_model.json";
import { parseComparisonModel, type ComparisonPrintModel } from "./comparisonModel";
import { ComparisonPage } from "./ComparisonPage";
import type { Language } from "./model";

const MODEL_REF = { version: 2, sha256: "c".repeat(64) };

function renderPage(language: Language = "both") {
  const model: ComparisonPrintModel = { ...parseComparisonModel(fixture), language };
  const overlayUrls = Object.fromEntries(
    model.members.map((m) => [m.sessionId, `blob:${m.sessionId}`]),
  );
  const view = render(
    <ComparisonPage
      model={model}
      overlayUrls={overlayUrls}
      logoUrl="blob:logo"
      comparisonModel={MODEL_REF}
    />,
  );
  return { ...view, model };
}

/** The engine's required_texts: every camel's names and camel id, and the cover. */
function requiredTexts(model: ComparisonPrintModel): string[] {
  const texts = model.members.flatMap((m) => [...m.rows.map((r) => r.name), m.camelId]);
  const { title, event, judge, council } = model.cover;
  return [...texts, title, event, judge, council].filter((t) => t !== "");
}

describe("the comparison print page", () => {
  it("draws every string the engine's text probe requires, verbatim", () => {
    const { container, model } = renderPage();
    for (const text of requiredTexts(model)) expect(container.textContent, text).toContain(text);
  });

  it("shows each camel's image once, in the operator's order, in its own section", () => {
    const { container, model } = renderPage();
    const images = [...container.querySelectorAll<HTMLImageElement>('img[data-role="overlay"]')];
    expect(images.map((img) => img.dataset["member"])).toEqual(
      model.members.map((m) => m.sessionId),
    );
    const sections = [...container.querySelectorAll<HTMLElement>("section[data-member]")];
    expect(sections.map((s) => s.dataset["member"])).toEqual(model.members.map((m) => m.sessionId));
    for (const [i, section] of sections.entries()) {
      const member = model.members[i];
      if (member === undefined) throw new Error("no member");
      // its section starts a page, holds its own image, its names and its camel id
      expect(section.className).toContain("break-before-page");
      expect(section.querySelectorAll('img[data-role="overlay"]')).toHaveLength(1);
      for (const row of member.rows) {
        if (row.name) expect(section.textContent).toContain(row.name);
      }
      expect(section.textContent).toContain(member.camelId);
    }
  });

  it("lays the table out as the engine matched it: the operator's columns, '—', (k/n), rejected", () => {
    const { container, model } = renderPage("ar");
    const table = container.querySelector<HTMLElement>("table[data-block]");
    if (table === null) throw new Error("no comparison table");
    expect(table.dataset["block"]).toBe("1,2,3");
    const heads = [...table.querySelectorAll<HTMLElement>("th[data-position]")];
    expect(heads.map((th) => th.dataset["position"])).toEqual(["1", "2", "3"]);
    const rows = [...table.querySelectorAll<HTMLElement>("tbody tr")];
    expect(rows).toHaveLength(model.rows.length);
    // the rows in the engine's order (first appearance), never re-sorted
    expect(rows.map((tr) => tr.dataset["row"])).toEqual(model.rows.map((r) => String(r.rowId)));
    expect(table.querySelectorAll("td[data-missing]").length).toBe(
      model.rows.flatMap((r) => r.cells).filter((c) => c === null).length,
    );
    expect(table.textContent).toContain("(2/2)");
    expect(table.textContent).toContain(model.labels.rejected.ar);
    expect(table.textContent).toContain(model.labels.columns["measurement"]?.ar ?? "?");
    // one language: no English half in the cells
    expect(table.textContent).not.toContain(model.labels.columns["measurement"]?.en ?? "?");
  });

  it("splits the camels into blocks of four when both languages print", () => {
    const base = parseComparisonModel(fixture);
    const first = base.members[0];
    if (first === undefined) throw new Error("no member");
    // five camels (the first repeated with other ids): a block of four and one of one
    const members = Array.from({ length: 5 }, (_, i) => ({
      ...first,
      position: i + 1,
      sessionId: `20261017_10000${i}_aaaaaa`,
    }));
    const model = {
      ...base,
      language: "both" as const,
      members,
      rows: base.rows.map((row) => ({ ...row, cells: members.map(() => row.cells[0] ?? null) })),
    };
    const { container } = render(
      <ComparisonPage model={model} overlayUrls={{}} logoUrl={null} comparisonModel={MODEL_REF} />,
    );
    const blocks = [...container.querySelectorAll<HTMLElement>("table[data-block]")];
    expect(blocks.map((t) => t.dataset["block"])).toEqual(["1,2,3,4", "5"]);
    // each block repeats the measurement and kind columns
    for (const block of blocks) {
      expect(within(block).getAllByText(base.labels.columns["kind"]?.en ?? "?")).toHaveLength(1);
    }
  });

  it("prints the provenance without the data root, and every disclaimer", () => {
    const { container, model } = renderPage("en");
    const footer = container.querySelector("footer");
    expect(footer?.textContent).toContain(
      `comparison_model_v2.json · 1.0 · sha256 ${MODEL_REF.sha256}`,
    );
    expect(footer?.textContent).toContain("python 3.11.9");
    expect(footer?.textContent).not.toContain("data_root");
    for (const disclaimer of model.labels.disclaimers) {
      expect(footer?.textContent).toContain(disclaimer.en);
    }
  });
});
