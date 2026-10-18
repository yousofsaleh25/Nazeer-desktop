import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ComparisonRow } from "@/api/types";
import { comparisonRow, COMPARISON_ID } from "@/test/comparisons";
import { renderWithStore, uiState } from "@/test/render";
import { ComparisonTable } from "./ComparisonTable";

function setup(rows: ComparisonRow[], lang: "en" | "ar" = "en") {
  const props = { onOpen: vi.fn(), onDelete: vi.fn(), onSaveAs: vi.fn() };
  renderWithStore(<ComparisonTable rows={rows} {...props} />, { preloadedState: uiState(lang) });
  const row = (id: string) => document.querySelector<HTMLElement>(`tr[data-comparison="${id}"]`)!;
  return { props, row };
}

describe("ComparisonTable", () => {
  it("lists the camels in the operator's order with the cover and status", async () => {
    const r = comparisonRow();
    const { props, row } = setup([r]);
    const cells = within(row(COMPARISON_ID));
    const chips = cells.getAllByRole("listitem").map((li) => li.textContent);
    expect(chips).toEqual(["#1 جمل-أ", "#2 camel-B"]);
    expect(cells.getByText("مزاين ١")).toHaveAttribute("dir", "auto");
    expect(cells.getByText("not sealed yet")).toBeInTheDocument();
    expect(cells.queryByText("Out of date")).toBeNull();
    await userEvent.click(cells.getByRole("button", { name: "Open" }));
    expect(props.onOpen).toHaveBeenCalledWith(r);
    await userEvent.click(cells.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith(r);
  });

  it("an out-of-date comparison says which camel changed and why", () => {
    const r = comparisonRow({
      stale: true,
      report_stale: true,
      status: "sealed",
      members: [
        {
          position: 1,
          session_id: "20261017_100000_aaaaaa",
          camel_id: "جمل-أ",
          stale_reasons: ["member_reopened", "member_edited"],
        },
        { position: 2, session_id: "20261017_100500_bbbbbb", camel_id: "", stale_reasons: [] },
      ],
    });
    const { row } = setup([r]);
    const cells = within(row(COMPARISON_ID));
    expect(cells.getByText("Out of date")).toBeInTheDocument();
    expect(cells.getByText("Sealed report out of date")).toBeInTheDocument();
    expect(cells.getByText("sealed")).toBeInTheDocument();
    expect(row(COMPARISON_ID)).toHaveTextContent(
      "#1 this camel's session was reopened · this camel's measurements or details changed",
    );
    // a camel without an id is named by its session
    expect(cells.getByText("20261017_100500_bbbbbb")).toBeInTheDocument();
  });

  it("an untitled or broken comparison (Arabic)", () => {
    const r = comparisonRow({ title: "", index_state: "corrupt", index_error: "bad json" });
    const { row } = setup([r], "ar");
    const cells = within(row(COMPARISON_ID));
    expect(cells.getByText("مقارنة بلا عنوان")).toBeInTheDocument();
    expect(cells.getByRole("button", { name: "فتح" })).toBeDisabled();
    expect(cells.getByText("bad json")).toHaveAttribute("dir", "ltr");
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("offers Save PDF as… only on a sealed comparison (D12)", async () => {
    const sealed = comparisonRow({ status: "sealed", report_version: 2 });
    const other = comparisonRow({ comparison_id: "20261017_130000_bbbbbb" });
    const { props, row } = setup([sealed, other]);
    expect(
      within(row(other.comparison_id)).queryByRole("button", { name: "Save PDF as…" }),
    ).toBeNull();
    await userEvent.click(within(row(COMPARISON_ID)).getByRole("button", { name: "Save PDF as…" }));
    expect(props.onSaveAs).toHaveBeenCalledWith(sealed);
  });
});
