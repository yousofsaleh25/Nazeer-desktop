/**
 * The print page (ADR-D7), loaded in the hidden window main opens for one export: it asks main for
 * the job, lays the model out with the approved overlay bytes — a session's report model, or a
 * comparison model with each camel's overlay (D12) —, adds the engine's face from its bytes, waits
 * for the face and every image, runs its own checks and tells main it is ready (main then calls
 * printToPDF). Language and names come from the model; nothing is read from storage.
 */
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ComparisonPrintJob, PrintJob, PrintPreflight, ReportPrintJob } from "@shared/ipc";
import { parseComparisonModel } from "./comparisonModel";
import { ComparisonPage } from "./ComparisonPage";
import { ModelError, parsePrintModel, type Language } from "./model";
import {
  failedPreflight,
  PRINT_FONT_FAMILY,
  runPreflight,
  type ExpectedOverlay,
} from "./preflight";
import { PrintPage } from "./PrintPage";
import "./print.css";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const pngUrl = (bytes: Uint8Array<ArrayBuffer>) =>
  URL.createObjectURL(new Blob([bytes], { type: "image/png" }));

interface Laid {
  language: Language;
  title: string;
  page: ReactNode;
  overlays: ExpectedOverlay[];
  overflow: boolean;
}

function reportPage(job: ReportPrintJob, logoUrl: string | null): Laid {
  const model = parsePrintModel(job.model);
  return {
    language: model.language,
    title: `${model.labels.title.en} - ${model.session.sessionId}`,
    page: (
      <PrintPage
        model={model}
        overlayUrl={pngUrl(job.overlay.bytes)}
        logoUrl={logoUrl}
        reportModel={job.reportModel}
      />
    ),
    overlays: [{ member: null, width: model.overlay.width, height: model.overlay.height }],
    overflow: false,
  };
}

function comparisonPage(job: ComparisonPrintJob, logoUrl: string | null): Laid {
  const model = parseComparisonModel(job.model);
  // the overlays main fetched and re-hashed are the ones the model names, in its order
  const named = model.members.map((m) => `${m.sessionId}:${m.overlay.sha256}`).join(",");
  const given = job.overlays.map((o) => `${o.sessionId}:${o.sha256}`).join(",");
  if (named !== given) {
    throw new ModelError("the overlays given for printing are not the ones the model names");
  }
  const overlayUrls = Object.fromEntries(job.overlays.map((o) => [o.sessionId, pngUrl(o.bytes)]));
  return {
    language: model.language,
    title: `${model.labels.title.en} - ${model.comparisonId}`,
    page: (
      <ComparisonPage
        model={model}
        overlayUrls={overlayUrls}
        logoUrl={logoUrl}
        comparisonModel={job.comparisonModel}
      />
    ),
    overlays: model.members.map((m) => ({
      member: m.sessionId,
      width: m.overlay.width,
      height: m.overlay.height,
    })),
    overflow: true,
  };
}

async function layOut(job: PrintJob): Promise<PrintPreflight> {
  const logoUrl = job.logo === null ? null : pngUrl(job.logo);
  const laid = job.kind === "comparison" ? comparisonPage(job, logoUrl) : reportPage(job, logoUrl);
  const html = document.documentElement;
  html.lang = laid.language === "en" ? "en" : "ar";
  html.dir = laid.language === "en" ? "ltr" : "rtl";
  document.title = laid.title;

  const face = new FontFace(PRINT_FONT_FAMILY, job.font.bytes, {
    weight: "400",
    style: "normal",
    display: "block",
  });
  document.fonts.add(face);
  const loading = face.load();

  const container = document.getElementById("root");
  if (container === null) throw new Error("#root is missing from print.html");
  flushSync(() => {
    createRoot(container).render(laid.page);
  });

  await loading;
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => img.decode()));
  // two frames: the layout with the loaded face is done before the checks read it
  await nextFrame();
  await nextFrame();
  return runPreflight({
    root: document.body,
    face,
    fontsCheck: (font) => document.fonts.check(font),
    requiredTexts: job.requiredTexts,
    overlays: laid.overlays,
    overflow: laid.overflow,
  });
}

async function start(): Promise<void> {
  const bridge = window.nazeerPrint;
  if (bridge === undefined) {
    document.body.textContent = "This page is printed by Nazeer Desktop.";
    return;
  }
  let result: PrintPreflight;
  let kind: PrintJob["kind"] = "report";
  try {
    const job = await bridge.getJob();
    kind = job.kind;
    result = await layOut(job);
  } catch (error) {
    result =
      error instanceof ModelError
        ? failedPreflight(
            kind === "comparison" ? "comparison_model_unreadable" : "report_model_unreadable",
            error.message,
          )
        : failedPreflight(
            "print_page_failed",
            error instanceof Error ? error.message : String(error),
          );
  }
  await bridge.ready(result);
}

void start();
