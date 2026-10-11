import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithStore, uiState } from "@/test/render";
import { Button } from "./Button";
import { ConfirmDialog, Dialog } from "./Dialog";

describe("Dialog", () => {
  it("is a labelled, described modal with a close button; Esc closes it", async () => {
    const onOpenChange = vi.fn();
    renderWithStore(
      <Dialog
        open
        onOpenChange={onOpenChange}
        title={{ ar: "بدء جلسة", en: "Start a session" }}
        description={{ ar: "وصف", en: "Description" }}
        footer={<Button>OK</Button>}
      >
        body
      </Dialog>,
      { preloadedState: uiState("en") },
    );
    const dialog = screen.getByRole("dialog", { name: "Start a session" });
    expect(dialog).toHaveAccessibleDescription("Description");
    expect(dialog).toHaveTextContent("body");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing when closed", () => {
    renderWithStore(<Dialog open={false} onOpenChange={() => {}} title={{ ar: "س", en: "x" }} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ConfirmDialog", () => {
  it("asks before an irreversible action; Cancel is the safe default", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    renderWithStore(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title={{ ar: "حذف الجلسة؟", en: "Delete the session?" }}
        description={{ ar: "تُنقل إلى سلة المحذوفات.", en: "It moves to the trash." }}
        confirmLabel={{ ar: "حذف", en: "Delete" }}
        tone="danger"
        onConfirm={onConfirm}
      />,
      { preloadedState: uiState("en") },
    );
    const dialog = screen.getByRole("alertdialog", { name: "Delete the session?" });
    expect(dialog).toHaveAccessibleDescription("It moves to the trash.");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
