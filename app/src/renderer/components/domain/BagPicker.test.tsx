import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fixtures } from "@/design/fixtures";
import { sampleScan } from "@/design/samples";
import { renderWithStore, uiState } from "@/test/render";
import { BagPicker, isBagPath } from "./BagPicker";

const recent = fixtures.recentBags.items;

function setup(overrides: Partial<Parameters<typeof BagPicker>[0]> = {}) {
  const props = {
    recent,
    onBrowse: vi.fn(),
    onOpen: vi.fn(),
    onForget: vi.fn(),
    onScan: vi.fn(),
    onConfigureFolders: vi.fn(),
    ...overrides,
  };
  renderWithStore(<BagPicker {...props} />, { preloadedState: uiState("en") });
  return props;
}

describe("BagPicker", () => {
  it("the file dialog is the main action", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Choose a .bag file…" }));
    expect(props.onBrowse).toHaveBeenCalledOnce();
  });

  it("a pasted path opens only when it names a .bag file (left-to-right input)", async () => {
    const props = setup();
    const input = screen.getByLabelText("Or paste the path of a .bag file");
    expect(input).toHaveAttribute("dir", "ltr");
    const open = screen.getAllByRole("button", { name: "Open" })[0]!;
    expect(open).toBeDisabled();
    await userEvent.type(input, "  D:\\captures\\x.BAG ");
    expect(open).toBeEnabled();
    await userEvent.click(open);
    expect(props.onOpen).toHaveBeenCalledWith("D:\\captures\\x.BAG");
  });

  it("lists recent recordings; a missing file is marked and cannot be opened", async () => {
    const props = setup({
      recent: [
        recent[0]!,
        { ...recent[0]!, path: "D:\\gone.bag", name: "gone.bag", exists: false },
      ],
    });
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("20260414_175757-006.bag");
    expect(items[0]).toHaveTextContent("5.86 GB");
    expect(within(items[1]!).getByText("File not found")).toBeInTheDocument();
    expect(within(items[1]!).getByRole("button", { name: "Open" })).toBeDisabled();
    await userEvent.click(within(items[1]!).getByRole("button", { name: "Remove from the list" }));
    expect(props.onForget).toHaveBeenCalledWith("D:\\gone.bag");
  });

  it("capture-folder scan: results, the truncation note and per-folder errors", async () => {
    const props = setup({ scan: { state: "done", result: sampleScan } });
    // the name, and the last segment of the path (each folder is its own isolate)
    expect(screen.getAllByText("20260414_181203-007.bag")).toHaveLength(2);
    expect(screen.getByTitle(sampleScan.bags[1]!.path)).toHaveAttribute("dir", "ltr");
    expect(screen.getByText(/The scan stopped at its limit/)).toBeInTheDocument();
    expect(screen.getByText("drive not ready")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(props.onScan).toHaveBeenCalledOnce();
  });

  it("isBagPath", () => {
    expect(isBagPath("a.bag")).toBe(true);
    expect(isBagPath("a.bag.txt")).toBe(false);
    expect(isBagPath("")).toBe(false);
  });
});
