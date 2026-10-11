import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleHistoryRows } from "@/design/samples";
import { renderWithStore, uiState } from "@/test/render";
import { HistoryTable } from "./HistoryTable";

function setup() {
  const props = { onOpen: vi.fn(), onReopen: vi.fn(), onDelete: vi.fn() };
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
});
