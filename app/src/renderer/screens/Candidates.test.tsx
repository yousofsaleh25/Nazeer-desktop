import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import candidateSet from "../../../fixtures/candidate_set.json";
import sessionFixture from "../../../fixtures/session_view.json";
import { setEngineConnection } from "@/api/connection";
import type { CandidateSet as CandidateSetData } from "@/api/types";
import { sampleJobs } from "@/design/samples";
import { candidateSetReady, CANDIDATES_INITIAL } from "@/store/slices/candidates";
import { connectScriptedEngine, engineState, jsonResponse } from "@/test/engine";
import { renderRoutes, uiState } from "@/test/render";
import { Candidates } from "./Candidates";
import { CandidateSet } from "./CandidateSet";

const set = candidateSet as unknown as CandidateSetData;
const running = sampleJobs.running;

afterEach(() => {
  setEngineConnection(null);
});

describe("the frame search", () => {
  it("follows the job, stops it on request, and opens the frames when they are ready", async () => {
    const engine = connectScriptedEngine({
      [`POST /candidates/jobs/${running.job_id}/stop`]: () =>
        jsonResponse(200, { ...running, state: "cancelling" }),
    });
    const { store, router } = renderRoutes(
      [{ path: "/candidates", element: <Candidates /> }],
      "/candidates",
      {
        preloadedState: {
          ...uiState("en"),
          engine: engineState(),
          candidates: {
            ...CANDIDATES_INITIAL,
            bagPath: set.bag["path"] as string,
            job: { id: running.job_id, snapshot: running, transport: "sse" },
          },
        },
      },
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Frame search");
    expect(screen.getByText("Finding the best frames")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop and keep" }));
    await waitFor(() =>
      expect(engine.requests.map((r) => new URL(r.url).pathname)).toContain(
        `/candidates/jobs/${running.job_id}/stop`,
      ),
    );
    act(() => {
      store.dispatch(
        candidateSetReady({
          fingerprint: set.fingerprint,
          paramsHash: set.params_hash,
          partial: false,
          nCandidates: 12,
          cached: false,
        }),
      );
    });
    expect(router.state.location.pathname).toBe(
      `/candidates/${set.fingerprint}/${set.params_hash}`,
    );
  });

  it("without a bag there is nothing to search: the way to open one", () => {
    renderRoutes([{ path: "/candidates", element: <Candidates /> }], "/candidates", {
      preloadedState: { ...uiState("en"), engine: engineState() },
    });
    expect(screen.getByText("No frame search yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open a bag" })).toHaveAttribute("href", "/");
  });
});

describe("the proposed frames", () => {
  it("picking a frame starts a session with the candidate's reference", async () => {
    const engine = connectScriptedEngine({
      [`GET /candidates/${set.fingerprint}/${set.params_hash}`]: () => jsonResponse(200, set),
      "POST /sessions": () => jsonResponse(201, sessionFixture, { ETag: '"r0-a"' }),
    });
    const { router } = renderRoutes(
      [{ path: "/candidates/:fp/:ph", element: <CandidateSet /> }],
      `/candidates/${set.fingerprint}/${set.params_hash}`,
      { preloadedState: { ...uiState("en"), engine: engineState() } },
    );
    const user = userEvent.setup();
    const tiles = await screen.findAllByRole("article");
    expect(tiles).toHaveLength(set.candidates.length);
    await user.click(within(tiles[0]!).getByRole("button", { name: "Use this frame" }));
    const dialog = await screen.findByRole("dialog", { name: "Start a measuring session" });
    await user.type(within(dialog).getByRole("textbox", { name: /Camel ID/ }), "جمل-7");
    await user.click(within(dialog).getByRole("button", { name: "Start measuring" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/sessions/${sessionFixture.session_id}`),
    );
    const created = engine.requests.find((r) => r.method === "POST");
    const first = [...set.candidates].sort((a, b) => a.read_index - b.read_index)[0]!;
    expect(JSON.parse(await created!.clone().text())).toEqual({
      candidate: first.ref,
      camel_id: "جمل-7",
      operator: "",
      notes: "",
    });
  });
});
