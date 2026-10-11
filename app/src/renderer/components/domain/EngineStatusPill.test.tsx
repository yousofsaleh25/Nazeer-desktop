import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { sampleConnection } from "@/design/samples";
import { renderWithStore, uiState } from "@/test/render";
import { EngineStatusPill } from "./EngineStatusPill";

describe("EngineStatusPill", () => {
  it("names the state and its tone", () => {
    renderWithStore(<EngineStatusPill status="ready" connection={sampleConnection} />, {
      preloadedState: uiState("en"),
    });
    const pill = screen.getByRole("button", { name: "Engine: Engine ready" });
    expect(pill.querySelector("[data-tone]")).toHaveAttribute("data-tone", "success");
  });

  it("the tooltip identifies the engine and warns about the stub model", async () => {
    renderWithStore(
      <EngineStatusPill status="restarting" connection={sampleConnection} restarts={2} />,
      {
        preloadedState: uiState("en"),
      },
    );
    await userEvent.tab();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("engine 0.1.0 · pid 36760");
    expect(tip).toHaveTextContent("Stub model (development)");
    expect(tip).toHaveTextContent("Restarts: 2");
  });

  it("a stopped engine is danger; busy states spin", () => {
    renderWithStore(
      <>
        <EngineStatusPill status="fatal" />
        <EngineStatusPill status="starting" />
      </>,
    );
    const [fatal, starting] = screen.getAllByRole("button");
    expect(fatal!.querySelector("[data-tone]")).toHaveAttribute("data-tone", "danger");
    expect(starting!.querySelector("svg")).toHaveClass("animate-spin");
  });
});
