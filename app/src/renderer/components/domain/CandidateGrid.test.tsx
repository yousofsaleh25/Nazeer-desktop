import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtures } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { CandidateGrid, inRecordingOrder } from "./CandidateGrid";

const set = fixtures.candidateSet;

describe("CandidateGrid", () => {
  it("tiles in recording order (read index), never in rank order", () => {
    renderWithStore(<CandidateGrid set={set} assetUrl={(p) => `dev${p}`} onPick={() => {}} />, {
      preloadedState: uiState("en"),
    });
    const ids = screen.getAllByRole("article").map((el) => el.getAttribute("aria-label"));
    expect(ids).toEqual(inRecordingOrder(set.candidates).map((c) => `Frame ${c.candidate_id}`));
    expect(ids[0]).toBe("Frame c04_000090"); // rank 4, earliest in the recording
    expect(screen.getAllByRole("img")[0]).toHaveAttribute(
      "src",
      expect.stringMatching(/^dev\/candidates\//),
    );
  });

  it("states the count, the unordered rule with the engine's noise floor, and rejections", () => {
    renderWithStore(<CandidateGrid set={set} assetUrl={(p) => p} onPick={() => {}} />, {
      preloadedState: uiState("en"),
    });
    expect(screen.getByText(/frames proposed/).parentElement).toHaveTextContent(
      "12 / 12 frames proposed",
    );
    expect(screen.getByText(/In recording order, not ranked/).parentElement).toHaveTextContent(
      "(15 %)",
    );
    expect(screen.getByText("camel cut off by the image edge")).toBeInTheDocument();
  });

  it("a partial set says so with the engine's reasons; an empty set says nothing passed", () => {
    renderWithStore(
      <CandidateGrid
        set={{
          ...set,
          partial: true,
          shortfall_reasons: ["only 3 frames passed (m = 12)"],
          candidates: [],
        }}
        assetUrl={(p) => p}
        onPick={() => {}}
      />,
      { preloadedState: uiState("en") },
    );
    expect(screen.getByText("Fewer frames than requested passed the checks")).toBeInTheDocument();
    expect(screen.getByText("only 3 frames passed (m = 12)")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("No frame passed the checks")).toBeInTheDocument();
  });

  it("a walk stopped early is never presented as complete", () => {
    renderWithStore(
      <CandidateGrid
        set={{ ...set, walk: { ...set.walk, stopped_early: true } }}
        assetUrl={(p) => p}
        onPick={() => {}}
      />,
      { preloadedState: uiState("en") },
    );
    expect(screen.getByText("The search was stopped early")).toBeInTheDocument();
  });
});
