import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleJobs } from "@/design/samples";
import { renderWithStore, uiState } from "@/test/render";
import { JobProgress } from "./JobProgress";

describe("JobProgress", () => {
  it("a running walk: state, stage, progress, counters and live rejections by reason", () => {
    renderWithStore(
      <JobProgress job={sampleJobs.running} onStop={() => {}} onCancel={() => {}} />,
      {
        preloadedState: uiState("en"),
      },
    );
    expect(screen.getByText("running")).toBeInTheDocument(); // engine label (job_states)
    expect(screen.getByText("reading frames")).toBeInTheDocument(); // app label (jobStages)
    expect(screen.getByRole("progressbar", { name: "Progress" })).toHaveAttribute(
      "aria-valuenow",
      "62",
    );
    expect(screen.getByText("1,086")).toBeInTheDocument();
    expect(screen.getByText("camel cut off by the image edge")).toBeInTheDocument();
    // a reason with zero frames is not listed
    expect(screen.queryByText("too little valid depth")).toBeNull();
    expect(screen.getByText("Time left")).toBeInTheDocument();
  });

  it("Stop keeps the frames so far, Cancel discards; both only while active", async () => {
    const onStop = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = renderWithStore(
      <JobProgress job={sampleJobs.running} onStop={onStop} onCancel={onCancel} />,
      { preloadedState: uiState("en") },
    );
    await userEvent.click(screen.getByRole("button", { name: "Stop and keep" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    rerender(<JobProgress job={sampleJobs.done} onStop={onStop} onCancel={onCancel} />);
    expect(screen.queryByRole("button", { name: "Stop and keep" })).toBeNull();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("engine warnings are shown as sent (English, left to right)", () => {
    renderWithStore(<JobProgress job={sampleJobs.slowMedia} />);
    const warning = screen.getByText(/slow_media/);
    expect(warning).toHaveAttribute("dir", "ltr");
    expect(warning).toHaveAttribute("lang", "en");
  });

  it("a failed walk shows the engine's error", () => {
    renderWithStore(<JobProgress job={sampleJobs.failed} />, { preloadedState: uiState("en") });
    expect(screen.getByRole("alert")).toHaveTextContent("Reading the bag stalled");
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("says when updates come by polling after the event stream failed", () => {
    renderWithStore(<JobProgress job={sampleJobs.running} transport="poll" />, {
      preloadedState: uiState("en"),
    });
    expect(screen.getByText("Polling")).toBeInTheDocument();
  });
});
