import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleConnection } from "@/design/samples";
import { renderWithStore, uiState } from "@/test/render";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("brand, the three sections (current one marked), engine status and preferences", () => {
    renderWithStore(
      <AppShell
        engine={{ status: "ready", connection: sampleConnection, restarts: 0 }}
        banner={<p>banner</p>}
      >
        <p>screen</p>
      </AppShell>,
      { route: "/history", preloadedState: uiState("en") },
    );
    expect(screen.getByText("Nazeer")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main sections" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Open a bag" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Engine: Engine ready" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByText("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("screen");
  });
});
