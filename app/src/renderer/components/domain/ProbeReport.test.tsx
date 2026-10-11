import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtures } from "@/design/fixtures";
import { sampleProbeDrift } from "@/design/samples";
import { renderWithStore, uiState } from "@/test/render";
import { ProbeReport } from "./ProbeReport";

describe("ProbeReport", () => {
  it("PASS: every probe passed, with the evidence", () => {
    const { container } = renderWithStore(<ProbeReport probe={fixtures.probePass} />, {
      preloadedState: uiState("en"),
    });
    expect(container.firstElementChild).toHaveAttribute("data-verdict", "PASS");
    expect(screen.getByText("The PDF passed every check")).toBeInTheDocument();
    expect(
      [...container.querySelectorAll("section[data-ok]")].map((s) => s.getAttribute("data-ok")),
    ).toEqual(["true", "true", "true", "true"]);
    expect(screen.getByText("Found").parentElement).toHaveTextContent("Found: 13 / 13");
    expect(screen.getByText("/AAAAAA+IBMPlexSansArabic")).toBeInTheDocument();
    expect(screen.getByText("overlay_v1.png")).toBeInTheDocument();
  });

  it("DRIFT: the failures, the synthesized-face hint, the missing name run and the kept file", () => {
    renderWithStore(
      <ProbeReport
        probe={sampleProbeDrift()}
        rejectedFile="report_v2.rejected_20261012T101500Z.pdf"
      />,
      {
        preloadedState: uiState("en"),
      },
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The PDF was refused");
    expect(alert).toHaveTextContent("Names were not found in the PDF text");
    expect(alert).toHaveTextContent("A synthesized bold or italic face is in the PDF");
    expect(alert).toHaveTextContent("report_v2.rejected_20261012T101500Z.pdf");
    expect(screen.getByText("ثنائية")).toHaveClass("text-danger-text"); // the missing run
    expect(screen.getByText("A synthesized (Type3) face is present")).toBeInTheDocument();
  });

  it("an unreadable result is not shown as a pass", () => {
    renderWithStore(<ProbeReport probe={null} />, { preloadedState: uiState("en") });
    expect(screen.getByText("The check result could not be read")).toBeInTheDocument();
  });
});
