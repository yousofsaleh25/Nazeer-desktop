// "Save as" on the Report screen (D12 F1): after a print is sealed the Save dialog opens by itself
// once the viewer has verified those bytes; the button saves a copy at any time; a cancel leaves
// the hint; a failure shows its label. Main is the bridge mock; the engine is the simulated one.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionReportFileName } from "@shared/fileNames";
import type { ExportResult, NazeerApi, SaveAsRequest, SaveAsResult } from "@shared/ipc";
import probePass from "../../../fixtures/probe_pass.json";
import { setEngineConnection } from "@/api/connection";
import { overlayVerifyRequested } from "@/store/listeners/finalize";
import { forgetVerifiedOverlay } from "@/store/services/overlayBytes";
import { overlayApproved } from "@/store/slices/report";
import { engineState } from "@/test/engine";
import { renderRoutes, uiState } from "@/test/render";
import { OVERLAY_BYTES, SessionEngine, sha256Hex } from "@/test/sessionEngine";
import { until } from "@/test/time";
import { ReportScreen } from "./ReportScreen";

// pdf.js does not run in jsdom: a one-page stand-in (the viewer itself is tested in PdfViewer)
vi.mock("@/lib/pdf", () => ({
  loadPdf: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: () =>
        Promise.resolve({
          getViewport: () => ({ width: 100, height: 140 }),
          render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
          cleanup: () => undefined,
        }),
    }),
    destroy: () => Promise.resolve(),
  }),
}));

const PDF = new TextEncoder().encode("%PDF-1.7 a sealed report");

const PREFLIGHT_OK = {
  ok: true,
  problems: [],
  warnings: [],
  checked: { requiredTexts: 12, textNodes: 400, characters: 9000, images: 2 },
};

function bridge(
  saveAs: (request: SaveAsRequest) => Promise<SaveAsResult>,
  exportPdf: () => Promise<ExportResult> = () => Promise.reject(new Error("no print here")),
) {
  type Report = NazeerApi["report"];
  const save = vi.fn<Report["saveAs"]>(saveAs);
  const savedCopy = vi.fn<Report["savedCopy"]>(() => Promise.resolve(null));
  const openSaved = vi.fn<Report["openSaved"]>(() => Promise.resolve({ ok: true }));
  (window as { nazeer?: Partial<NazeerApi> }).nazeer = {
    print: { exportPdf: vi.fn(exportPdf), exportComparison: vi.fn() },
    report: { saveAs: save, savedCopy, openSaved },
  };
  return { save, savedCopy, openSaved };
}

async function setup(prepare?: (engine: SessionEngine) => void | Promise<void>) {
  const engine = new SessionEngine();
  engine.status = "exported";
  engine.overlayVersion = 1;
  engine.overlaySha256 = await sha256Hex(OVERLAY_BYTES);
  await prepare?.(engine);
  const view = renderRoutes(
    [{ path: "/sessions/:id/report", element: <ReportScreen /> }],
    `/sessions/${engine.id}/report`,
    { preloadedState: { ...uiState("en"), engine: engineState() } },
  );
  await screen.findByRole("heading", { name: "Report" });
  return { engine, ...view, user: userEvent.setup() };
}

/** The view's report replaced by `version`, served with these bytes. */
async function sealed(engine: SessionEngine, version: number): Promise<void> {
  const old = engine.view().outputs.report;
  if (!old) throw new Error("the fixture view names no report");
  engine.report = {
    ...old,
    version,
    file: `report_v${version}.pdf`,
    url: `/sessions/${engine.id}/report?v=${version}`,
    sha256: await sha256Hex(PDF),
    stale: false,
  };
  engine.reportPdf = PDF;
}

const saved = (request: SaveAsRequest): SaveAsResult => ({
  state: "saved",
  path: `D:\\تقارير\\${request.suggestedName}`,
  version: request.version,
  bytes: PDF.byteLength,
  sha256: "a".repeat(64),
  savedAt: "2026-10-17T10:00:00.000Z",
  recorded: true,
});

afterEach(() => {
  setEngineConnection(null);
  forgetVerifiedOverlay();
  delete (window as { nazeer?: unknown }).nazeer;
});

describe("Save as on the Report screen", () => {
  it("after a seal, the Save dialog opens once the viewer verified the new bytes", async () => {
    let engineRef: SessionEngine | null = null;
    const mocks = bridge(
      (request) => Promise.resolve(saved(request)),
      async () => {
        if (engineRef !== null) await sealed(engineRef, 2);
        return {
          ok: true,
          session: null,
          probe: probePass,
          preflight: PREFLIGHT_OK,
          pdfBytes: PDF.byteLength,
          timingsMs: {},
        };
      },
    );
    const { engine, store, user } = await setup((e) => {
      engineRef = e;
    });
    store.dispatch(overlayVerifyRequested());
    await until(() => store.getState().report.overlay?.state === "ok");
    store.dispatch(overlayApproved());
    // nothing opens on a plain visit
    expect(mocks.save).not.toHaveBeenCalled();
    const print = await screen.findByRole("button", { name: "Print again" });
    await waitFor(() => expect(print).toBeEnabled());
    await user.click(print);
    expect(await screen.findByText("The report is sealed")).toBeInTheDocument();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const view = store.getState().session.view;
    expect(mocks.save.mock.calls[0]?.[0]).toEqual({
      kind: "session",
      id: engine.id,
      version: 2,
      suggestedName: sessionReportFileName({
        camelId: view?.camel_id ?? "",
        sessionId: engine.id,
        createdAt: view?.created_at ?? null,
        version: 2,
      }),
    });
    expect(await screen.findByText("Saved to:")).toBeInTheDocument();
    expect(store.getState().savedFiles.offer).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open file" }));
    expect(mocks.openSaved).toHaveBeenCalledWith({
      kind: "session",
      id: engine.id,
      version: 2,
      action: "open",
    });
    await user.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(mocks.openSaved).toHaveBeenLastCalledWith(expect.objectContaining({ action: "show" }));
    // only once, however often the screen renders
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("cancelling keeps the sealed copy and says no file was saved yet", async () => {
    const mocks = bridge(() => Promise.resolve({ state: "cancelled" }));
    const { user } = await setup((e) => sealed(e, 1));
    expect(await screen.findByTestId("not-saved-to-file")).toHaveTextContent(
      "Not saved to a file yet",
    );
    await user.click(screen.getByRole("button", { name: "Save PDF as…" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({ version: 1 });
    expect(await screen.findByTestId("not-saved-to-file")).toHaveTextContent(
      "Not saved to a file yet",
    );
  });

  it("a recorded copy shows where it is; a copy that moved says so", async () => {
    const mocks = bridge(() => Promise.resolve({ state: "cancelled" }));
    mocks.savedCopy.mockResolvedValueOnce({
      path: "E:\\usb\\نسخة.pdf",
      savedAt: "2026-10-16T08:00:00.000Z",
      sha256: "b".repeat(64),
      bytes: 10,
      exists: false,
      changed: false,
    });
    await setup((e) => sealed(e, 1));
    expect(await screen.findByText("The saved copy is no longer there")).toBeInTheDocument();
    expect(screen.getByTestId("not-saved-to-file")).toHaveTextContent("Not saved to a file yet");
  });

  it("a failure shows its label and the context", async () => {
    bridge(() =>
      Promise.resolve({
        state: "failed",
        error: {
          status: null,
          code: "save_as_write_failed",
          message: "the copy could not be written: EPERM",
          details: { path: "D:\\x.pdf", problem: "denied" },
        },
      }),
    );
    const { user } = await setup((e) => sealed(e, 1));
    await user.click(await screen.findByRole("button", { name: "Save PDF as…" }));
    expect(await screen.findByText("The copy could not be written")).toBeInTheDocument();
    expect(screen.getByText("The PDF copy could not be saved")).toBeInTheDocument();
  });
});
