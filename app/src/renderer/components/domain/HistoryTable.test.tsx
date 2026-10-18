import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleHistoryRows } from "@/design/samples";
import { historyRow } from "@/test/comparisons";
import { renderWithStore, uiState } from "@/test/render";
import { HistoryTable } from "./HistoryTable";

function setup() {
  const props = { onOpen: vi.fn(), onReopen: vi.fn(), onDelete: vi.fn(), onSaveAs: vi.fn() };
  renderWithStore(
    <HistoryTable rows={sampleHistoryRows} assetUrl={(p) => `dev${p}`} {...props} />,
    {
      preloadedState: uiState("en"),
    },
  );
  const row = (id: string) => document.querySelector<HTMLElement>(`tr[data-session="${id}"]`)!;
  return { props, row };
}

describe("HistoryTable", () => {
  it("every session is listed with its status and, when not ok, its index state", () => {
    const { row } = setup();
    expect(screen.getAllByRole("row")).toHaveLength(1 + sampleHistoryRows.length);
    const exported = row("20261011_152956_e20a7c");
    expect(within(exported).getByText("exported")).toBeInTheDocument();
    expect(within(exported).getByText("جمل-تجربة-1")).toHaveAttribute("dir", "auto");
    expect(within(exported).getByRole("img")).toHaveAttribute(
      "src",
      expect.stringMatching(/^dev\/sessions\//),
    );
    expect(within(row("20261010_120000_0a0b0c")).getByText("files missing")).toBeInTheDocument();
    const corrupt = row("20261009_080000_ffeedd");
    expect(within(corrupt).getByText("corrupt")).toBeInTheDocument();
    expect(within(corrupt).getByText(/Expecting value/)).toHaveAttribute("dir", "ltr");
    expect(
      within(row("20261012_101010_d4e5f6")).getByText("Report out of date"),
    ).toBeInTheDocument();
    expect(within(row("20261012_101010_d4e5f6")).getByText("No camel ID")).toBeInTheDocument();
  });

  it("open sessions continue, sealed ones open for inspection and can be reopened", async () => {
    const { props, row } = setup();
    await userEvent.click(
      within(row("20261012_091500_a1b2c3")).getByRole("button", { name: "Continue" }),
    );
    expect(props.onOpen).toHaveBeenCalledWith(sampleHistoryRows[1]);
    expect(
      within(row("20261012_091500_a1b2c3")).queryByRole("button", { name: "Reopen for editing" }),
    ).toBeNull();
    await userEvent.click(
      within(row("20261011_152956_e20a7c")).getByRole("button", { name: "Reopen for editing" }),
    );
    expect(props.onReopen).toHaveBeenCalledWith(sampleHistoryRows[0]);
  });

  it("broken sessions cannot be opened but can be deleted", async () => {
    const { props, row } = setup();
    const corrupt = row("20261009_080000_ffeedd");
    expect(within(corrupt).getByRole("button", { name: "Continue" })).toBeDisabled();
    await userEvent.click(within(corrupt).getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith(sampleHistoryRows[4]);
  });

  it("Save PDF as… appears on rows with a sealed report only (D12)", async () => {
    const { props, row } = setup();
    const withReport = sampleHistoryRows.filter(
      (r) => r.report_version > 0 && (r.index_state === "ok" || r.index_state === "unindexed"),
    );
    expect(withReport.length).toBeGreaterThan(0);
    for (const r of sampleHistoryRows) {
      const button = within(row(r.session_id)).queryByRole("button", { name: "Save PDF as…" });
      expect(button !== null, r.session_id).toBe(withReport.includes(r));
    }
    const first = withReport[0]!;
    await userEvent.click(
      within(row(first.session_id)).getByRole("button", { name: "Save PDF as…" }),
    );
    expect(props.onSaveAs).toHaveBeenCalledWith(first);
  });
});

describe("HistoryTable selection for a comparison (D12)", () => {
  const A = "20261017_100000_aaaaaa";
  const B = "20261017_100100_bbbbbb";
  const C = "20261017_100200_cccccc";
  const rows = [
    historyRow(A, "camel-A"),
    historyRow(B, "camel-B", { eligible: false, reason: "reopened" }),
    historyRow(C, "camel-C"),
  ];

  function pick(lang: "en" | "ar", selected: string[] = [], full = false) {
    const onToggle = vi.fn();
    renderWithStore(
      <HistoryTable
        rows={rows}
        assetUrl={(p) => p}
        onOpen={vi.fn()}
        selection={{ selectedIds: new Set(selected), full, onToggle }}
      />,
      { preloadedState: uiState(lang) },
    );
    const row = (id: string) => document.querySelector<HTMLElement>(`tr[data-session="${id}"]`)!;
    return { onToggle, row };
  }

  it("ticks eligible rows; an ineligible one cannot be ticked and says why (English)", async () => {
    const { onToggle, row } = pick("en", [A]);
    const boxA = within(row(A)).getByRole("checkbox", { name: "Select for a comparison camel-A" });
    expect(boxA).toBeChecked();
    expect(row(A)).toHaveAttribute("data-selected", "true");
    const boxB = within(row(B)).getByRole("checkbox");
    expect(boxB).toBeDisabled();
    expect(row(B)).toHaveTextContent(
      "Cannot join a comparison: reopened after finalizing: finalize it again",
    );
    await userEvent.click(within(row(C)).getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith(rows[2]);
  });

  it("when full, unticked rows are locked and ticked ones can still be unticked (Arabic)", async () => {
    const { onToggle, row } = pick("ar", [A], true);
    expect(within(row(C)).getByRole("checkbox")).toBeDisabled();
    const boxA = within(row(A)).getByRole("checkbox", { name: "اختيار للمقارنة camel-A" });
    expect(boxA).toBeEnabled();
    await userEvent.click(boxA);
    expect(onToggle).toHaveBeenCalledWith(rows[0]);
    expect(row(B)).toHaveTextContent("لا يمكن ضمّها إلى مقارنة:");
  });

  it("without a selection there is no selection column", () => {
    renderWithStore(<HistoryTable rows={rows} assetUrl={(p) => p} onOpen={vi.fn()} />, {
      preloadedState: uiState("en"),
    });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/Cannot join a comparison/)).toBeNull();
  });
});
