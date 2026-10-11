import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PdfDocumentLike, PdfLoader } from "@/lib/pdf";
import { renderWithStore, uiState } from "@/test/render";
import { PdfViewer } from "./PdfViewer";

function fakePdf(pages: number) {
  const rendered: { page: number; width: number }[] = [];
  const destroyed = vi.fn(() => Promise.resolve());
  const doc: PdfDocumentLike = {
    numPages: pages,
    getPage: (page) =>
      Promise.resolve({
        getViewport: ({ scale }) => ({ width: 595 * scale, height: 842 * scale }),
        render: ({ viewport }) => {
          rendered.push({ page, width: viewport.width });
          return { promise: Promise.resolve(), cancel: () => {} };
        },
        cleanup: () => {},
      }),
  };
  const loader: PdfLoader = vi.fn(() => ({ promise: Promise.resolve(doc), destroy: destroyed }));
  return { loader, rendered, destroyed };
}

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

describe("PdfViewer", () => {
  it("loads the bytes, renders page 1 and pages with the buttons and PageDown", async () => {
    const { loader, rendered } = fakePdf(5);
    renderWithStore(<PdfViewer data={bytes} fileName="report_v1.pdf" verified loader={loader} />, {
      preloadedState: uiState("en"),
    });
    expect(loader).toHaveBeenCalledWith(bytes);
    expect(await screen.findByText("1 / 5")).toBeInTheDocument();
    expect(screen.getByText("Fingerprint verified")).toBeInTheDocument();
    await waitFor(() => expect(rendered.at(-1)?.page).toBe(1));
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    screen.getByRole("region", { name: "report_v1.pdf" }).focus();
    await userEvent.keyboard("{PageDown}");
    expect(screen.getByText("3 / 5")).toBeInTheDocument();
    await waitFor(() => expect(rendered.at(-1)?.page).toBe(3));
  });

  it("the page canvas is left to right even in the Arabic UI (pdf.js draws glyphs as canvas text)", async () => {
    const { loader } = fakePdf(1);
    renderWithStore(<PdfViewer data={bytes} fileName="r.pdf" loader={loader} />);
    await screen.findByText("1 / 1");
    expect(screen.getByRole("img", { name: /1 \/ 1/ })).toHaveAttribute("dir", "ltr");
  });

  it("zoom steps from the shown scale; fit width returns to the default", async () => {
    const { loader, rendered } = fakePdf(1);
    renderWithStore(<PdfViewer data={bytes} fileName="r.pdf" loader={loader} />, {
      preloadedState: uiState("en"),
    });
    await screen.findByText("1 / 1");
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "Fit width" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(rendered.at(-1)?.width).toBeCloseTo(595 * 1.25, 3));
    expect(screen.getByRole("button", { name: "Fit width" })).toBeEnabled();
  });

  it("destroys the document when the bytes change or the viewer unmounts", async () => {
    const { loader, destroyed } = fakePdf(2);
    const { rerender, unmount } = renderWithStore(
      <PdfViewer data={bytes} fileName="a.pdf" loader={loader} />,
    );
    await screen.findByText("1 / 2");
    rerender(<PdfViewer data={new Uint8Array([1])} fileName="b.pdf" loader={loader} />);
    expect(destroyed).toHaveBeenCalledTimes(1);
    unmount();
    expect(destroyed).toHaveBeenCalledTimes(2);
  });

  it("a PDF that cannot be opened says so", async () => {
    const loader: PdfLoader = () => ({
      promise: Promise.reject(new Error("Invalid PDF structure.")),
      destroy: () => Promise.resolve(),
    });
    renderWithStore(<PdfViewer data={bytes} fileName="bad.pdf" loader={loader} />, {
      preloadedState: uiState("en"),
    });
    expect(await screen.findByText("The PDF could not be opened")).toBeInTheDocument();
    expect(screen.getByText("Invalid PDF structure.")).toBeInTheDocument();
  });

  it("no bytes: says there is no report", () => {
    renderWithStore(<PdfViewer data={null} fileName="—" />, { preloadedState: uiState("en") });
    expect(screen.getByText("No report yet")).toBeInTheDocument();
  });
});
