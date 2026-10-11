import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { networkError } from "@/api/errors";
import { fixtures } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { ErrorPanel, errorJson } from "./ErrorPanel";

describe("ErrorPanel", () => {
  it("labels a known engine code and still shows the engine's message, code and status", () => {
    renderWithStore(<ErrorPanel error={fixtures.errors.notFound} />, {
      preloadedState: uiState("en"),
    });
    const panel = screen.getByRole("alert");
    expect(panel).toHaveAttribute("data-code", "session_not_found");
    expect(panel).toHaveTextContent("Session not found");
    expect(panel).toHaveTextContent("session not found"); // the engine's own message
    expect(panel).toHaveTextContent("session_not_found");
    expect(panel).toHaveTextContent("404");
    expect(screen.getByText("session not found").closest("bdi")).toHaveAttribute("dir", "ltr");
  });

  it("an unknown code shows the raw code, never a blank", () => {
    renderWithStore(
      <ErrorPanel
        error={{ status: 418, code: "brand_new_code", message: "teapot", details: {} }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("brand_new_code");
    expect(screen.getByText("teapot")).toBeInTheDocument();
  });

  it("labels the app's own codes in Arabic by default", () => {
    renderWithStore(<ErrorPanel error={networkError(new TypeError("Failed to fetch"))} />);
    expect(screen.getByRole("alert")).toHaveTextContent("تعذّر الوصول إلى المحرك");
  });

  it("details: the stale save's full current view is summarised on screen, copied in full", async () => {
    const user = userEvent.setup();
    const error = fixtures.errors.staleRevision;
    renderWithStore(<ErrorPanel error={error} />, { preloadedState: uiState("en") });
    const pre = document.querySelector("pre")!;
    expect(pre.textContent).toContain('"session_id": "20261011_152956_e20a7c"');
    expect(pre.textContent?.length ?? 0).toBeLessThan(1000);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(errorJson(error));
    expect(errorJson(error).length).toBeGreaterThan(50_000);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("offers a retry when the caller can retry", async () => {
    const onRetry = vi.fn();
    renderWithStore(<ErrorPanel error={fixtures.errors.unauthorized} onRetry={onRetry} />, {
      preloadedState: uiState("en"),
    });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
