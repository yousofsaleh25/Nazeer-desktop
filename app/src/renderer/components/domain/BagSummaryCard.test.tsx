import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleBag } from "@/design/samples";
import { renderWithStore, uiState } from "@/test/render";
import { BagSummaryCard } from "./BagSummaryCard";

describe("BagSummaryCard", () => {
  it("shows the real bag-006 facts from the engine", () => {
    renderWithStore(<BagSummaryCard bag={sampleBag} />, { preloadedState: uiState("en") });
    expect(screen.getAllByText("20260414_175757-006.bag")).toHaveLength(2); // name + path's last segment
    expect(screen.getByTitle(sampleBag.path)).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("Intel RealSense D455")).toBeInTheDocument();
    expect(screen.getByText("1280×720 @ 30 fps · rgb8")).toBeInTheDocument();
    expect(screen.getByText("848×480 @ 30 fps · z16")).toBeInTheDocument();
    expect(screen.getByText("58.4")).toBeInTheDocument();
    expect(screen.getByText("Frames already proposed")).toBeInTheDocument();
  });

  it("no cached chip when nothing is cached", () => {
    renderWithStore(<BagSummaryCard bag={{ ...sampleBag, cached_candidate_sets: [] }} />, {
      preloadedState: uiState("en"),
    });
    expect(screen.queryByText("Frames already proposed")).toBeNull();
  });
});
