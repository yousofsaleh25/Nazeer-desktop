import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExportRequest, ExportResult, NazeerApi } from "@shared/ipc";
import probePass from "../../../fixtures/probe_pass.json";
import reportModelFixture from "../../../fixtures/report_model.json";
import { setEngineConnection } from "@/api/connection";
import type { ReportInputs } from "@/api/types";
import { overlayVerifyRequested } from "@/store/listeners/finalize";
import { forgetVerifiedOverlay } from "@/store/services/overlayBytes";
import { overlayApproved } from "@/store/slices/report";
import { engineState } from "@/test/engine";
import { renderRoutes, uiState } from "@/test/render";
import { OVERLAY_BYTES, SessionEngine, sha256Hex } from "@/test/sessionEngine";
import { until } from "@/test/time";
import { inputsPatch, ReportScreen } from "./ReportScreen";

function setup(prepare?: (engine: SessionEngine) => void) {
  const engine = new SessionEngine();
  engine.status = "finalized";
  prepare?.(engine);
  const view = renderRoutes(
    [{ path: "/sessions/:id/report", element: <ReportScreen /> }],
    `/sessions/${engine.id}/report`,
    { preloadedState: { ...uiState("en"), engine: engineState() } },
  );
  return { engine, ...view, user: userEvent.setup() };
}

/** A finalized session whose overlay was verified (WebCrypto) and approved in this app run. */
async function approvedSetup(
  exportPdf: (request: ExportRequest) => Promise<ExportResult>,
  prepare?: (engine: SessionEngine) => void,
) {
  const stamp = await sha256Hex(OVERLAY_BYTES);
  const spy = vi.fn(exportPdf);
  (window as { nazeer?: Partial<NazeerApi> }).nazeer = { print: { exportPdf: spy } };
  const view = setup((e) => {
    e.overlayVersion = 1;
    e.overlaySha256 = stamp;
    prepare?.(e);
  });
  await screen.findByRole("heading", { name: "Report" });
  view.store.dispatch(overlayVerifyRequested());
  await until(() => view.store.getState().report.overlay?.state === "ok");
  view.store.dispatch(overlayApproved());
  return { ...view, spy, stamp };
}

const PREFLIGHT_OK = {
  ok: true,
  problems: [],
  warnings: [],
  checked: { requiredTexts: 12, textNodes: 400, characters: 9000, images: 2 },
};

afterEach(() => {
  setEngineConnection(null);
  forgetVerifiedOverlay();
  delete (window as { nazeer?: unknown }).nazeer;
});

describe("the report screen", () => {
  it("the report details come from the engine's report model; only changes are sent", async () => {
    const { engine, user } = setup();
    const judge = await screen.findByRole("textbox", { name: "Judge" });
    expect(screen.getByRole("button", { name: "Save the details" })).toBeDisabled();
    await user.clear(judge);
    await user.type(judge, "  الحكم الأول ");
    expect(screen.getByText("Changes not saved yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save the details" }));
    await waitFor(() => expect(engine.reportInputs.names["judge"]).toBe("الحكم الأول"));
    const patch = engine.requests.find((r) => r.method === "PATCH")?.body;
    expect(patch).toEqual({ names: { ...engine.reportInputs.names, judge: "الحكم الأول" } });
    await waitFor(() => expect(screen.queryByText("Changes not saved yet")).toBeNull());
  });

  it("printing waits for the approval of the engine's image", async () => {
    setup();
    expect(
      await screen.findByText("Approve the engine's image before printing"),
    ).toBeInTheDocument();
    // the fixture session was sealed once already: printing again
    expect(screen.getByRole("button", { name: "Print again" })).toBeDisabled();
  });

  it("prints exactly the approved bytes and the report model the session names", async () => {
    const { spy, stamp, user, store } = await approvedSetup(() =>
      Promise.resolve({
        ok: true,
        session: null,
        probe: probePass,
        preflight: PREFLIGHT_OK,
        pdfBytes: 1_600_000,
        timingsMs: { fetch: 120, print: 2100, seal: 1600 },
      }),
    );
    const print = await screen.findByRole("button", { name: "Print again" });
    await waitFor(() => expect(print).toBeEnabled());
    await user.click(print);
    expect(await screen.findByText("The report is sealed")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
    const request = spy.mock.calls[0]?.[0];
    const model = store.getState().session.view?.outputs.report_model;
    expect(request?.sessionId).toBe(store.getState().session.id);
    expect(request?.overlay).toEqual({ version: 1, sha256: stamp, bytes: OVERLAY_BYTES });
    expect(request?.reportModel).toEqual({ version: model?.version, sha256: model?.sha256 });
    expect(store.getState().report.export?.state).toBe("sealed");
  });

  it("after a print, the sealed report's checks are read again (same manifest URL)", async () => {
    let engineRef: SessionEngine | null = null;
    const { user } = await approvedSetup(
      () => {
        // the engine sealed v2: its manifest now carries the probe
        if (engineRef !== null) {
          const old = engineRef.view().outputs.report;
          engineRef.report = old ? { ...old, version: 2, file: "report_v2.pdf" } : null;
          engineRef.manifest = { probes: probePass };
        }
        return Promise.resolve({
          ok: true,
          session: null,
          probe: probePass,
          preflight: PREFLIGHT_OK,
          pdfBytes: 1,
          timingsMs: {},
        });
      },
      (e) => {
        engineRef = e;
        e.manifest = { probes: {} }; // written at finalize, before any print
      },
    );
    expect(await screen.findByText("The check result could not be read")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Print again" }));
    expect(await screen.findByText("The PDF passed every check")).toBeInTheDocument();
    expect(screen.queryByText("The check result could not be read")).toBeNull();
  });

  it("a refused PDF shows the engine's probe and the file it kept", async () => {
    const drift = { ...probePass, verdict: "DRIFT", hard_failures: ["overlay_drift"] };
    const { user } = await approvedSetup(() =>
      Promise.resolve({
        ok: false,
        error: {
          status: 409,
          code: "overlay_drift",
          message: "the PDF image differs from the approved overlay",
          details: { probe: drift, rejected_file: "report_v2.rejected_1760000000000_ab12.pdf" },
        },
        probe: drift,
        preflight: PREFLIGHT_OK,
        timingsMs: {},
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Print again" }));
    // the error's label, and the probe's hard failure
    expect(
      await screen.findAllByText("The PDF image differs from the approved overlay"),
    ).not.toHaveLength(0);
    expect(screen.getByText("Printing failed")).toBeInTheDocument();
    expect(screen.getByText("report_v2.rejected_1760000000000_ab12.pdf")).toBeInTheDocument();
  });

  it("the print page's own findings are listed with their labels", async () => {
    const problem = {
      code: "print_glyph_missing",
      message: "a required name has a character the report's face cannot draw",
      details: { names: [{ text: "جمل 🐪", characters: ["U+1F42A"] }] },
    };
    const { user } = await approvedSetup(() =>
      Promise.resolve({
        ok: false,
        error: { status: null, code: problem.code, message: problem.message, details: {} },
        probe: null,
        preflight: { ...PREFLIGHT_OK, ok: false, problems: [problem] },
        timingsMs: {},
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Print again" }));
    expect(await screen.findByText("What the print page found")).toBeInTheDocument();
    expect(
      screen.getAllByText("A name has a character the report's font cannot draw").length,
    ).toBeGreaterThan(0);
  });

  it("a report model older than the print page asks for a new finalize", async () => {
    await approvedSetup(
      () => Promise.reject(new Error("must not print")),
      (e) => {
        e.reportModel = { ...reportModelFixture, report_model_version: "1.0" };
      },
    );
    expect(
      await screen.findByText("This session's report model is older than the print page"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print again" })).toBeDisabled();
  });

  it("a session not finalized yet has no report form", async () => {
    setup((e) => {
      e.status = "open";
    });
    expect(await screen.findByText("This session is not finalized yet")).toBeInTheDocument();
  });

  it("the sealed PDF is shown only when its bytes match the engine's fingerprint", async () => {
    setup();
    // the simulated engine has no PDF: the download fails, nothing unverified is shown
    expect(await screen.findByText("The report could not be downloaded")).toBeInTheDocument();
    expect(screen.queryByText("Fingerprint verified")).toBeNull();
  });
});

describe("inputsPatch", () => {
  const base: ReportInputs = {
    language: "ar",
    rubric_variant: "mjaheem",
    names: { judge: "a", council: "", event: "" },
    observations: { colour: "" },
  };
  it("names only what changed", () => {
    expect(inputsPatch(base, base)).toEqual({});
    expect(inputsPatch(base, { ...base, language: "both" })).toEqual({ language: "both" });
    expect(inputsPatch(base, { ...base, observations: { colour: "x" } })).toEqual({
      observations: { colour: "x" },
    });
  });
});
