import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import health from "../../../fixtures/health.json";
import versions from "../../../fixtures/versions.json";
import { setEngineConnection } from "@/api/connection";
import { sampleConnection } from "@/design/samples";
import { connectFixtureEngine, engineState } from "@/test/engine";
import { renderWithStore } from "@/test/render";
import { About } from "./About";

afterEach(() => {
  setEngineConnection(null);
});

function renderAbout(lang: "ar" | "en" = "en") {
  return renderWithStore(<About />, {
    preloadedState: { engine: engineState(), ui: { lang, bilingual: false, theme: "light" } },
  });
}

describe("About", () => {
  it("names the engine, model, Arabic stack and versions the app is talking to", async () => {
    connectFixtureEngine();
    renderAbout();
    expect(screen.getByRole("heading", { level: 1, name: "About Nazeer" })).toBeInTheDocument();
    // from /health
    expect(await screen.findByText(health.run_id)).toBeInTheDocument();
    expect(screen.getByText(health.arabic_stack.font_sha256)).toBeInTheDocument();
    // from the supervisor's connection
    const engine = screen.getByRole("heading", { level: 2, name: "Engine" }).closest("section")!;
    expect(within(engine).getByText(String(sampleConnection.pid))).toBeInTheDocument();
    expect(within(engine).getByText(String(sampleConnection.port))).toBeInTheDocument();
    expect(within(engine).getByTitle(sampleConnection.dataRoot)).toBeInTheDocument();
    // from /versions
    expect(await screen.findByText("pyrealsense2")).toBeInTheDocument();
    expect(screen.getByText(versions.pyrealsense2)).toBeInTheDocument();
    // the stub model is said in words, not only in a colour
    expect(screen.getAllByText("Stub model").length).toBeGreaterThan(0);
  });

  it("a failed /health shows the error and the connection facts still", async () => {
    connectFixtureEngine(sampleConnection, {
      "/health": {
        status: 503,
        body: { error: { code: "engine_not_ready", message: "warming up", details: {} } },
      },
    });
    renderAbout();
    expect(await screen.findByText("warming up")).toBeInTheDocument();
    const engine = screen.getByRole("heading", { level: 2, name: "Engine" }).closest("section")!;
    expect(within(engine).getByText(sampleConnection.engineVersion)).toBeInTheDocument();
  });

  it("reads right to left in Arabic", async () => {
    connectFixtureEngine();
    renderAbout("ar");
    expect(screen.getByRole("heading", { level: 1, name: "حول نظير" })).toBeInTheDocument();
    expect(await screen.findByText(health.run_id)).toBeInTheDocument();
  });
});
