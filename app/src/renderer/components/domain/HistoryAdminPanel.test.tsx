import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fixtures } from "@/design/fixtures";
import { sampleStats } from "@/design/samples";
import { renderWithStore, uiState } from "@/test/render";
import { HistoryAdminPanel } from "./HistoryAdminPanel";

describe("HistoryAdminPanel", () => {
  it("shows what the data root holds and the last reconcile", () => {
    renderWithStore(
      <HistoryAdminPanel
        stats={sampleStats}
        reconciled={fixtures.historyList.reconciled}
        lastBackup={{ path: "E:\\data\\backups\\history_20261012T101500Z.sqlite", bytes: 40960 }}
        onBackup={() => {}}
        onRebuild={() => {}}
      />,
      { preloadedState: uiState("en") },
    );
    expect(screen.getByText("Sessions").closest("div")).toHaveTextContent("Sessions420.54 MB");
    expect(screen.getByText("missing_files: 1")).toBeInTheDocument();
    expect(screen.getByText("unchanged").parentElement).toHaveTextContent("unchanged: 1");
    expect(screen.getByText(/history_20261012T101500Z/)).toBeInTheDocument();
  });

  it("backup and rebuild; one at a time", async () => {
    const onBackup = vi.fn();
    const onRebuild = vi.fn();
    const { rerender } = renderWithStore(
      <HistoryAdminPanel stats={null} onBackup={onBackup} onRebuild={onRebuild} />,
      { preloadedState: uiState("en") },
    );
    await userEvent.click(screen.getByRole("button", { name: "Back up history" }));
    await userEvent.click(screen.getByRole("button", { name: "Rebuild history" }));
    expect(onBackup).toHaveBeenCalledOnce();
    expect(onRebuild).toHaveBeenCalledOnce();
    rerender(
      <HistoryAdminPanel stats={null} busy="backup" onBackup={onBackup} onRebuild={onRebuild} />,
    );
    expect(screen.getByRole("button", { name: "Back up history" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("button", { name: "Rebuild history" })).toBeDisabled();
  });
});
