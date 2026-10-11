import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithStore, uiState } from "@/test/render";
import { Alert } from "./Alert";

describe("Alert", () => {
  it("danger is announced at once (role alert); the others politely (role status)", () => {
    renderWithStore(
      <>
        <Alert tone="danger" title={{ ar: "خطأ", en: "Error" }}>
          details
        </Alert>
        <Alert
          tone="info"
          title={{ ar: "معلومة", en: "Note" }}
          actions={<button type="button">Retry</button>}
        />
      </>,
      { preloadedState: uiState("en") },
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Errordetails");
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-tone", "info");
    expect(status).toHaveTextContent("Note");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
