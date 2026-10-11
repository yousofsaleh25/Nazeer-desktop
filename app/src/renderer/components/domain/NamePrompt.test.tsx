import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithStore, uiState } from "@/test/render";
import { NamePrompt } from "./NamePrompt";

const kindLabel = { ar: "مسافة ثلاثية الأبعاد", en: "3D distance" };

describe("NamePrompt", () => {
  it("saves a trimmed name with Enter; an empty name cannot be saved", async () => {
    const onSubmit = vi.fn();
    renderWithStore(<NamePrompt kindLabel={kindLabel} onSubmit={onSubmit} onCancel={() => {}} />, {
      preloadedState: uiState("en"),
    });
    const input = screen.getByLabelText(/Measurement name/);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("dir", "auto");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(input, "  ارتفاع الغارب  {Enter}");
    expect(onSubmit).toHaveBeenCalledWith("ارتفاع الغارب");
  });

  it("Esc cancels", async () => {
    const onCancel = vi.fn();
    renderWithStore(<NamePrompt kindLabel={kindLabel} onSubmit={() => {}} onCancel={onCancel} />);
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("rename mode starts from the current name", () => {
    renderWithStore(
      <NamePrompt
        kindLabel={kindLabel}
        defaultName="Withers"
        mode="rename"
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
      { preloadedState: uiState("en") },
    );
    expect(screen.getByLabelText(/Measurement name/)).toHaveValue("Withers");
    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
  });
});
