import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithStore, uiState } from "@/test/render";
import { UnsavedBadge, type SaveState } from "./UnsavedBadge";

describe("UnsavedBadge", () => {
  it("clean shows the stored revision", () => {
    renderWithStore(<UnsavedBadge state="clean" revision={9} />, { preloadedState: uiState("en") });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Savedr9");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("every state has a label and a tone; unsaved work is never neutral", () => {
    const states: SaveState[] = [
      "dirty",
      "saving",
      "error",
      "offline",
      "blocked",
      "conflict",
      "finalizing",
    ];
    renderWithStore(
      <>
        {states.map((state) => (
          <UnsavedBadge key={state} state={state} />
        ))}
      </>,
      { preloadedState: uiState("en") },
    );
    const tones = Object.fromEntries(
      screen
        .getAllByRole("status")
        .map((el): [string, string] => [
          el.getAttribute("data-state") ?? "",
          el.querySelector("[data-tone]")?.getAttribute("data-tone") ?? "",
        ]),
    );
    expect(tones).toEqual({
      dirty: "warning",
      saving: "info",
      error: "danger",
      offline: "danger",
      blocked: "neutral",
      conflict: "danger",
      finalizing: "info",
    });
    expect(screen.getByText("Changed elsewhere: choose a version")).toBeInTheDocument();
  });
});
