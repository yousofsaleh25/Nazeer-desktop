import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fixtures } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { CandidateTile } from "./CandidateTile";

const candidate = fixtures.candidateSet.candidates[5]!; // c06_001340, SIDE, the session's frame

describe("CandidateTile", () => {
  it("shows the frame, its bucket, time and the engine's depth statistics", () => {
    renderWithStore(
      <CandidateTile candidate={candidate} thumbUrl="thumb.jpg" onPick={() => {}} />,
      {
        preloadedState: uiState("en"),
      },
    );
    const tile = screen.getByRole("article", { name: "Frame c06_001340" });
    expect(screen.getByRole("img")).toHaveAttribute("src", "thumb.jpg");
    expect(screen.getByText("side")).toBeInTheDocument(); // bucket label from the engine
    expect(tile).toHaveTextContent("44.7");
    expect(tile).toHaveTextContent("#1340");
    expect(tile).toHaveTextContent("2.329");
    expect(tile).toHaveTextContent("4.5");
    expect(screen.getByText(/part of the camel is outside the depth field/)).toBeInTheDocument();
  });

  it("never shows the engine's rank or z_var (the grid is unordered)", () => {
    renderWithStore(<CandidateTile candidate={candidate} thumbUrl="t.jpg" onPick={() => {}} />);
    const text = screen.getByRole("article").textContent ?? "";
    expect(text).not.toContain(String(candidate.z_var).slice(0, 6));
    expect(screen.queryByText(/rank/i)).toBeNull();
  });

  it("picking reports the candidate; a broken thumbnail shows a placeholder", async () => {
    const onPick = vi.fn();
    renderWithStore(
      <CandidateTile candidate={candidate} thumbUrl="broken.jpg" onPick={onPick} selected />,
      {
        preloadedState: uiState("en"),
      },
    );
    expect(screen.getByRole("article")).toHaveAttribute("data-selected", "true");
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Use this frame" }));
    expect(onPick).toHaveBeenCalledWith(candidate);
  });
});
