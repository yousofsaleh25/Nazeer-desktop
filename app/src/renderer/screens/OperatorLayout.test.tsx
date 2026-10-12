import { DirectionProvider } from "@radix-ui/react-direction";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NazeerApi } from "@shared/ipc";
import sessionFixture from "../../../fixtures/session_view.json";
import { setEngineConnection } from "@/api/connection";
import type { SessionView } from "@/api/types";
import { useLabels } from "@/components/domain/labels";
import { LanguageProvider } from "@/design/language";
import { sampleConnection } from "@/design/samples";
import { measurementChanged, sessionLoaded } from "@/store/slices/session";
import { makeStore } from "@/store/store";
import { connectFixtureEngine, engineState } from "@/test/engine";
import { OperatorLayout } from "./OperatorLayout";

function Child() {
  const labels = useLabels();
  return <p>child screen · labels {labels === null ? "missing" : "loaded"}</p>;
}

function renderLayout(engine: ReturnType<typeof engineState>) {
  const store = makeStore({ engine, ui: { lang: "en", bilingual: false, theme: "light" } });
  const router = createMemoryRouter(
    [{ element: <OperatorLayout />, children: [{ path: "/", element: <Child /> }] }],
    { initialEntries: ["/"] },
  );
  render(
    <Provider store={store}>
      <DirectionProvider dir="ltr">
        <LanguageProvider lang="en" bilingual={false}>
          <TooltipProvider delayDuration={0}>
            <RouterProvider router={router} />
          </TooltipProvider>
        </LanguageProvider>
      </DirectionProvider>
    </Provider>,
  );
  return store;
}

afterEach(() => {
  setEngineConnection(null);
  delete (window as { nazeer?: NazeerApi }).nazeer;
});

describe("OperatorLayout", () => {
  it("while the engine starts, the screen waits and is not rendered", () => {
    renderLayout(engineState({ status: "starting", connection: null }));
    expect(screen.getByRole("status", { name: "Engine starting" })).toBeInTheDocument();
    expect(screen.queryByText(/child screen/)).toBeNull();
  });

  it("when the engine cannot run, the fatal panel acts through the bridge", async () => {
    const retry = vi.fn(() => Promise.resolve());
    const openLogFolder = vi.fn(() => Promise.resolve());
    (window as { nazeer?: Partial<NazeerApi> }).nazeer = {
      engine: { retry } as unknown as NazeerApi["engine"],
      app: { openLogFolder } as unknown as NazeerApi["app"],
    };
    renderLayout(
      engineState({
        status: "fatal",
        connection: null,
        fatal: {
          code: "model_hash_mismatch",
          message: "sha mismatch",
          details: {},
          exitCode: 3,
        },
      }),
    );
    expect(screen.getByText("The model file does not match its pinned hash")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(screen.getByRole("button", { name: "Open the log folder" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(openLogFolder).toHaveBeenCalledOnce();
    expect(screen.queryByText(/child screen/)).toBeNull();
  });

  it("when ready, renders the screen with the engine's labels and the banners", async () => {
    const fetched = connectFixtureEngine();
    renderLayout(
      engineState({ connection: { ...sampleConnection, arabicStackOk: false, stubModel: true } }),
    );
    expect(await screen.findByText("child screen · labels loaded")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Arabic text stack is missing");
    expect(screen.getByText(/stub model: the frame search/)).toBeInTheDocument();
    expect(fetched.requests.map((r) => new URL(r.url).pathname)).toEqual(["/meta/labels"]);
  });

  it("labels that fail to load leave raw codes and a retry banner", async () => {
    connectFixtureEngine(sampleConnection, {
      "/meta/labels": {
        status: 500,
        body: { error: { code: "internal_error", message: "x", details: {} } },
      },
    });
    renderLayout(engineState());
    expect(await screen.findByText(/labels could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText("child screen · labels missing")).toBeInTheDocument();
  });

  it("the open session's entry shows its unsaved work, so it stays visible from every screen", async () => {
    connectFixtureEngine();
    const store = renderLayout(engineState());
    const view = { ...(sessionFixture as unknown as SessionView), status: "open" as const };
    act(() => {
      store.dispatch(sessionLoaded({ view, etag: null }));
    });
    const link = await screen.findByRole("link", { name: /Measuring/ });
    expect(within(link).queryByRole("status")).toBeNull(); // saved: nothing to say
    const first = view.measurements[0];
    act(() => {
      store.dispatch(measurementChanged({ id: first?.id ?? 1, changes: { name: "renamed" } }));
    });
    expect(within(link).getByRole("status")).toHaveTextContent("Unsaved changes");
  });

  it("an engine that stops answering /health gets a banner, the screen stays", async () => {
    connectFixtureEngine();
    renderLayout(engineState({ unresponsive: true }));
    await waitFor(() => expect(screen.getByText("Engine not answering")).toBeInTheDocument());
    expect(screen.getByText(/child screen/)).toBeInTheDocument();
  });
});
