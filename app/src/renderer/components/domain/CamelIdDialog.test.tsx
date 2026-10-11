import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fixtures } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { CamelIdDialog } from "./CamelIdDialog";

const candidate = fixtures.candidateSet.candidates[5]!;

describe("CamelIdDialog", () => {
  it("submits trimmed values; the camel ID may stay empty until finalize", async () => {
    const onSubmit = vi.fn();
    renderWithStore(
      <CamelIdDialog open onOpenChange={() => {}} candidate={candidate} onSubmit={onSubmit} />,
      { preloadedState: uiState("en") },
    );
    expect(screen.getByRole("dialog", { name: "Start a measuring session" })).toBeInTheDocument();
    expect(screen.getByText("Required before finalizing (can be added later)")).toBeInTheDocument();
    const camelId = screen.getByLabelText("Camel ID");
    expect(camelId).toHaveFocus();
    expect(camelId).toHaveAttribute("dir", "auto");
    await userEvent.type(camelId, "  جمل-تجربة-1 ");
    await userEvent.type(screen.getByLabelText("Operator"), "المشغل");
    await userEvent.click(screen.getByRole("button", { name: "Start measuring" }));
    expect(onSubmit).toHaveBeenCalledWith({
      camel_id: "جمل-تجربة-1",
      operator: "المشغل",
      notes: "",
    });
  });

  it("shows the engine's error and keeps the values", () => {
    renderWithStore(
      <CamelIdDialog
        open
        onOpenChange={() => {}}
        candidate={candidate}
        initial={{ camel_id: "x" }}
        error={fixtures.errors.validation}
        onSubmit={() => {}}
      />,
      { preloadedState: uiState("en") },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The request does not match the engine API",
    );
    expect(screen.getByLabelText("Camel ID")).toHaveValue("x");
  });

  it("busy: the start button shows progress and cancel is blocked", () => {
    renderWithStore(
      <CamelIdDialog open onOpenChange={() => {}} candidate={null} busy onSubmit={() => {}} />,
      { preloadedState: uiState("en") },
    );
    expect(screen.getByRole("button", { name: "Start measuring" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
