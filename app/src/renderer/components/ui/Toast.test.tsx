import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithStore, uiState } from "@/test/render";
import { Toaster, type ToastItem } from "./Toast";

const toasts: ToastItem[] = [
  { id: "a", tone: "success", title: { ar: "حُفظ", en: "Saved" } },
  {
    id: "b",
    tone: "danger",
    title: { ar: "فشل النسخ الاحتياطي", en: "Backup failed" },
    description: { ar: "القرص ممتلئ", en: "Disk full" },
  },
];

describe("Toaster", () => {
  it("lists the notices with their text", () => {
    renderWithStore(<Toaster toasts={toasts} onDismiss={() => {}} />, {
      preloadedState: uiState("en"),
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Disk full")).toBeInTheDocument();
  });

  it("the close button dismisses a notice by id", async () => {
    const onDismiss = vi.fn();
    renderWithStore(<Toaster toasts={[toasts[0]!]} onDismiss={onDismiss} />, {
      preloadedState: uiState("en"),
    });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledWith("a");
  });
});
