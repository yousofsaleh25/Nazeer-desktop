/**
 * The print page (ADR-D7), loaded in the hidden window main opens for one export: it asks main for
 * the job, lays the report model out with the approved overlay bytes, adds the engine's face from
 * its bytes, waits for the face and every image, runs its own checks and tells main it is ready
 * (main then calls printToPDF). Language and names come from the report model; nothing is read
 * from storage.
 */
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { PrintJob, PrintPreflight } from "@shared/ipc";
import { ModelError, parsePrintModel, type PrintModel } from "./model";
import { failedPreflight, PRINT_FONT_FAMILY, runPreflight } from "./preflight";
import { PrintPage } from "./PrintPage";
import "./print.css";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function layOut(job: PrintJob, model: PrintModel): Promise<PrintPreflight> {
  const html = document.documentElement;
  html.lang = model.language === "en" ? "en" : "ar";
  html.dir = model.language === "en" ? "ltr" : "rtl";
  document.title = `${model.labels.title.en} - ${model.session.sessionId}`;

  const face = new FontFace(PRINT_FONT_FAMILY, job.font.bytes, {
    weight: "400",
    style: "normal",
    display: "block",
  });
  document.fonts.add(face);
  const loading = face.load();

  const overlayUrl = URL.createObjectURL(new Blob([job.overlay.bytes], { type: "image/png" }));
  const logoUrl =
    job.logo === null ? null : URL.createObjectURL(new Blob([job.logo], { type: "image/png" }));
  const container = document.getElementById("root");
  if (container === null) throw new Error("#root is missing from print.html");
  flushSync(() => {
    createRoot(container).render(
      <PrintPage
        model={model}
        overlayUrl={overlayUrl}
        logoUrl={logoUrl}
        reportModel={job.reportModel}
      />,
    );
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
    overlay: { width: model.overlay.width, height: model.overlay.height },
  });
}

async function start(): Promise<void> {
  const bridge = window.nazeerPrint;
  if (bridge === undefined) {
    document.body.textContent = "This page is printed by Nazeer Desktop.";
    return;
  }
  let result: PrintPreflight;
  try {
    const job = await bridge.getJob();
    result = await layOut(job, parsePrintModel(job.model));
  } catch (error) {
    result =
      error instanceof ModelError
        ? failedPreflight("report_model_unreadable", error.message)
        : failedPreflight(
            "print_page_failed",
            error instanceof Error ? error.message : String(error),
          );
  }
  await bridge.ready(result);
}

void start();
