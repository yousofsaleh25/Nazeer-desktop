import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SavedFileEntry } from "@/store/slices/savedFiles";
import { renderWithStore, uiState } from "@/test/render";
import { SaveCopyPanel } from "./SaveCopyPanel";

const blank: SavedFileEntry = {
  checked: true,
  copy: null,
  saving: false,
  unrecorded: false,
  error: null,
  errorFrom: null,
};

const savedCopy = {
  path: "D:\\تقارير\\ناقة-7_2026-10-14.pdf",
  savedAt: "2026-10-17T10:00:00.000Z",
  sha256: "a".repeat(64),
  bytes: 10,
  exists: true,
  changed: false,
};

function show(entry: SavedFileEntry, lang: "ar" | "en" = "en") {
  const handlers = { onSave: vi.fn(), onOpen: vi.fn(), onShow: vi.fn() };
  const view = renderWithStore(<SaveCopyPanel entry={entry} {...handlers} />, {
    preloadedState: uiState(lang),
  });
  return { ...view, ...handlers, user: userEvent.setup() };
}

describe("SaveCopyPanel", () => {
  it("says no file was saved yet, and saves on request", async () => {
    const { onSave, user } = show(blank);
    expect(screen.getByTestId("not-saved-to-file")).toHaveTextContent("Not saved to a file yet");
    await user.click(screen.getByRole("button", { name: "Save PDF as…" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("shows nothing about a copy before main answered", () => {
    show({ ...blank, checked: false });
    expect(screen.queryByTestId("not-saved-to-file")).toBeNull();
    expect(screen.queryByTestId("saved-copy")).toBeNull();
  });

  it("shows where the copy is, with Open file and Show in folder", async () => {
    const { onOpen, onShow, user } = show({ ...blank, copy: savedCopy });
    expect(screen.getByTestId("saved-copy")).toHaveTextContent("Saved to:");
    // the path left to right, the Arabic folder in its own isolate
    const path = screen.getByTitle(savedCopy.path);
    expect(path).toHaveAttribute("dir", "ltr");
    await user.click(screen.getByRole("button", { name: "Open file" }));
    await user.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it("warns when the saved copy changed, moved, or could not be recorded", () => {
    const { unmount } = show({ ...blank, copy: { ...savedCopy, changed: true }, unrecorded: true });
    expect(screen.getByText("The saved copy changed after it was saved")).toBeInTheDocument();
    expect(
      screen.getByText("The copy was saved, but its place could not be remembered"),
    ).toBeInTheDocument();
    unmount();
    show({ ...blank, copy: { ...savedCopy, exists: false } });
    expect(screen.getByText("The saved copy is no longer there")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open file" })).toBeNull();
  });

  it("while saving: the button waits and says so", () => {
    show({ ...blank, saving: true });
    expect(screen.getByRole("button", { name: /Save PDF as…/ })).toBeDisabled();
    expect(screen.getByText("Saving the copy…")).toBeInTheDocument();
  });

  it("a failure shows the code's label, under what failed", () => {
    const { unmount } = show({
      ...blank,
      error: { status: null, code: "save_as_copy_mismatch", message: "x", details: {} },
      errorFrom: "save",
    });
    expect(screen.getByText("The PDF copy could not be saved")).toBeInTheDocument();
    expect(
      screen.getByText("The written copy did not match the sealed report and was removed"),
    ).toBeInTheDocument();
    unmount();
    show({
      ...blank,
      copy: savedCopy,
      error: { status: null, code: "save_as_open_failed", message: "x", details: {} },
      errorFrom: "open",
    });
    expect(screen.getByText("The saved copy could not be opened")).toBeInTheDocument();
    expect(screen.getByText("The copy could not be opened")).toBeInTheDocument();
  });

  it("speaks Arabic in the Arabic UI (the operator's wording)", () => {
    show({ ...blank, copy: savedCopy }, "ar");
    expect(screen.getByRole("button", { name: "حفظ نسخة PDF باسم…" })).toBeInTheDocument();
    expect(screen.getByTestId("saved-copy")).toHaveTextContent("حُفظت نسخة في:");
    expect(screen.getByRole("button", { name: "فتح الملف" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إظهار في المجلد" })).toBeInTheDocument();
  });

  it("the hint in Arabic", () => {
    show(blank, "ar");
    expect(screen.getByTestId("not-saved-to-file")).toHaveTextContent(
      "لم تُحفظ نسخة منه في ملف بعد",
    );
  });
});
