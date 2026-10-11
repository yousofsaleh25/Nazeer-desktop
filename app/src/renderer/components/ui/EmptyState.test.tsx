import { screen } from "@testing-library/react";
import { Ruler } from "lucide-react";
import { describe, expect, it } from "vitest";
import { renderWithStore, uiState } from "@/test/render";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("says what is empty and offers the next action", () => {
    renderWithStore(
      <EmptyState
        icon={Ruler}
        title={{ ar: "لا توجد قياسات بعد", en: "No measurements yet" }}
        description={{ ar: "اختر نوعًا", en: "Choose a kind" }}
        action={<button type="button">Start</button>}
      />,
      { preloadedState: uiState("en") },
    );
    expect(screen.getByText("No measurements yet")).toBeInTheDocument();
    expect(screen.getByText("Choose a kind")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });
});
