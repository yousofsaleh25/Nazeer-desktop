import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import candidateSet from "../../../fixtures/candidate_set.json";
import type { NazeerApi } from "@shared/ipc";
import { setEngineConnection } from "@/api/connection";
import { connectScriptedEngine, engineState, jsonResponse } from "@/test/engine";
import { renderRoutes, uiState } from "@/test/render";
import { Home } from "./Home";

const BAG = candidateSet.bag.path;
const bagInfo = {
  ...candidateSet.bag,
  sample_every_effective: 5,
  cached_candidate_sets: [] as string[],
};

function setup(cached: string[] = []) {
  const engine = connectScriptedEngine({
    "POST /bags/inspect": () => jsonResponse(200, { ...bagInfo, cached_candidate_sets: cached }),
    "POST /candidates/jobs": () =>
      jsonResponse(200, {
        cached: true,
        job: null,
        result: {
          fingerprint: candidateSet.fingerprint,
          params_hash: candidateSet.params_hash,
          n_candidates: 12,
          partial: false,
        },
        candidates_url: "/candidates/x/y",
      }),
  });
  const view = renderRoutes([{ path: "/", element: <Home /> }], "/", {
    preloadedState: { ...uiState("en"), engine: engineState() },
  });
  return { engine, ...view, user: userEvent.setup() };
}

afterEach(() => {
  setEngineConnection(null);
  delete (window as { nazeer?: NazeerApi }).nazeer;
});

/** The recent list's line for the bag, and its Open button. */
async function openRecent(user: ReturnType<typeof userEvent.setup>) {
  const name = (await screen.findAllByText("20260414_175757-006.bag"))[0]!;
  await user.click(within(name.closest("li")!).getByRole("button", { name: "Open" }));
}

async function bodyOf(request: Request | undefined): Promise<unknown> {
  return request === undefined ? undefined : (JSON.parse(await request.clone().text()) as unknown);
}

describe("Home: open a recording", () => {
  it("a recent recording is inspected by the engine; the frame search starts from its summary", async () => {
    const { engine, router, user } = setup();
    await openRecent(user);
    expect(await screen.findByText("Intel RealSense D455")).toBeInTheDocument();
    const inspect = engine.requests.find((r) => new URL(r.url).pathname === "/bags/inspect");
    expect(await bodyOf(inspect)).toEqual({ path: BAG });
    await user.click(screen.getByRole("button", { name: "Find the best frames" }));
    expect(router.state.location.pathname).toBe("/candidates");
    await waitFor(() =>
      expect(engine.requests.some((r) => new URL(r.url).pathname === "/candidates/jobs")).toBe(
        true,
      ),
    );
    const job = engine.requests.find((r) => new URL(r.url).pathname === "/candidates/jobs");
    expect(await bodyOf(job)).toEqual({ bag_path: BAG, force: false });
  });

  it("the system file dialog hands the path to the engine (main process; nothing read here)", async () => {
    const openBag = vi.fn(() => Promise.resolve(BAG));
    (window as { nazeer?: Partial<NazeerApi> }).nazeer = {
      dialogs: { openBag, pickFolder: vi.fn(() => Promise.resolve(null)) },
      scan: { captureFolders: vi.fn(), setFolders: vi.fn() },
    };
    const { engine, user } = setup();
    await user.click(await screen.findByRole("button", { name: "Choose a .bag file…" }));
    expect(openBag).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(engine.requests.some((r) => new URL(r.url).pathname === "/bags/inspect")).toBe(true),
    );
  });

  it("a recording with frames already proposed offers them, and a full new search", async () => {
    const { engine, user } = setup([candidateSet.params_hash]);
    await openRecent(user);
    expect(await screen.findByRole("button", { name: "Show the proposed frames" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Search the whole recording again" }));
    await waitFor(async () => {
      const job = engine.requests.find((r) => new URL(r.url).pathname === "/candidates/jobs");
      expect(await bodyOf(job)).toEqual({ bag_path: BAG, force: true });
    });
  });

  it("a bag the engine cannot read shows its reason", async () => {
    const { user } = setup();
    await screen.findAllByText("20260414_175757-006.bag");
    connectScriptedEngine({
      "POST /bags/inspect": () =>
        jsonResponse(404, { error: { code: "bag_not_found", message: "no file", details: {} } }),
    });
    await openRecent(user);
    expect(await screen.findByText("Bag file not found")).toBeInTheDocument();
    expect(screen.getByText("Opening the recording failed")).toBeInTheDocument();
  });
});
