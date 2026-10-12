import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleConnection } from "@/design/samples";
import { renderWithStore, uiState } from "@/test/render";
import { EngineFatalPanel, EngineWaiting, engineBanners, fatalAsError } from "./EngineGate";

describe("EngineWaiting", () => {
  it("names the state and what is happening", () => {
    renderWithStore(<EngineWaiting status="restarting" restarts={2} />, {
      preloadedState: uiState("en"),
    });
    expect(screen.getByRole("status", { name: "Engine restarting" })).toBeInTheDocument();
    expect(screen.getByText(/being restarted/)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("EngineFatalPanel", () => {
  const orphan = {
    code: "engine_already_running",
    message: "another engine is serving this data root",
    details: { pid: 4100, port: 50123, holder: "ours" },
    exitCode: 6,
  };

  it("labels the code, keeps the engine message, explains a left-over engine", async () => {
    const onRetry = vi.fn();
    const onOpenLogs = vi.fn();
    const onQuit = vi.fn();
    renderWithStore(
      <EngineFatalPanel fatal={orphan} onRetry={onRetry} onOpenLogs={onOpenLogs} onQuit={onQuit} />,
      { preloadedState: uiState("en") },
    );
    expect(screen.getByRole("heading", { name: "The engine is not running" })).toBeInTheDocument();
    expect(screen.getByText("Another engine is using this data folder")).toBeInTheDocument();
    expect(screen.getByText(orphan.message)).toBeInTheDocument();
    expect(screen.getByText(/Try again stops it/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(screen.getByRole("button", { name: "Open the log folder" }));
    await user.click(screen.getByRole("button", { name: "Quit" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onOpenLogs).toHaveBeenCalledOnce();
    expect(onQuit).toHaveBeenCalledOnce();
  });

  it("no orphan hint for other codes; no actions without a bridge", () => {
    renderWithStore(
      <EngineFatalPanel
        fatal={{ code: "bridge_missing", message: "x", details: {}, exitCode: null }}
      />,
      { preloadedState: uiState("ar") },
    );
    expect(screen.getByText("هذه الصفحة لا تعمل داخل تطبيق نظير")).toBeInTheDocument();
    expect(screen.queryByText(/«إعادة المحاولة» توقفه/)).toBeNull();
    expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).toBeNull();
  });

  it("puts the exit code into the details", () => {
    expect(fatalAsError(orphan)).toEqual({
      status: null,
      code: "engine_already_running",
      message: orphan.message,
      details: { ...orphan.details, exit_code: 6 },
    });
  });
});

describe("engineBanners", () => {
  it("is empty for a healthy real-model engine", () => {
    expect(
      engineBanners({
        connection: { ...sampleConnection, stubModel: false },
        unresponsive: false,
      }),
    ).toBeNull();
  });

  it("warns about a missing Arabic stack, a stub model, a silent engine and missing labels", async () => {
    const onRetryLabels = vi.fn();
    renderWithStore(
      <div>
        {engineBanners({
          connection: { ...sampleConnection, arabicStackOk: false, stubModel: true },
          unresponsive: true,
          labelsFailed: true,
          onRetryLabels,
        })}
      </div>,
      { preloadedState: uiState("en") },
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Arabic text stack is missing");
    expect(screen.getByText(/stub model/)).toBeInTheDocument();
    expect(screen.getByText("Engine not answering")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryLabels).toHaveBeenCalledOnce();
  });
});
