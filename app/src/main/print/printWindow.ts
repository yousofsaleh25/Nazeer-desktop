/**
 * The hidden print window (ADR-D7): sandboxed, context-isolated, no Node, its own in-memory
 * partition (nothing of it outlives the print) with the same permission policy and — in built
 * code — the app:// handler; the print preload; background throttling off, so a hidden page still
 * lays out and runs its timers. It loads print.html, hands the page its job over the print bridge
 * (answered only for this window), waits for the page's checks, prints with printToPDF and closes.
 * Each phase has its own time limit (D12): the page's layout and checks, then printToPDF itself —
 * a print that hangs destroys the window and ends the export with `print_timeout`, so the
 * one-export-at-a-time guard never stays busy until the app restarts.
 */
import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import type { PrintJob, PrintPreflight } from "@shared/ipc";
import { preflightOrRefusal } from "@shared/ipcValidate";
import { PRINT_IPC } from "@shared/printChannels";
import { handleAppProtocol } from "../protocol";
import { hardenSession, type SecurityContext } from "../security";
import type { PrintOutcome, PrintTimeouts } from "./exportPdf";

/** A4 from the page's own `@page` rule (12 mm margins there), backgrounds printed (D7). */
export const PRINT_TO_PDF_OPTIONS = {
  pageSize: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
} as const;

interface PendingJob {
  job: PrintJob;
  given: boolean;
  ready(result: PrintPreflight): void;
}

/** Jobs by the webContents id of the window main opened for them. */
const pending = new Map<number, PendingJob>();

function jobFor(event: IpcMainInvokeEvent): PendingJob {
  const entry = pending.get(event.sender.id);
  const frame = event.senderFrame;
  if (
    entry === undefined ||
    frame === null ||
    frame !== event.sender.mainFrame ||
    !new URL(frame.url).pathname.endsWith("/print/print.html")
  ) {
    throw new Error("untrusted sender");
  }
  return entry;
}

/** The print bridge's two channels; once, at startup. */
export function registerPrintIpc(): void {
  ipcMain.handle(PRINT_IPC.getJob, (event) => {
    const entry = jobFor(event);
    if (entry.given) throw new Error("the print job was already handed out");
    entry.given = true;
    return entry.job;
  });
  ipcMain.handle(PRINT_IPC.ready, (event, payload: unknown) => {
    // a result main refuses ends the job now with that reason (never the 90 s timeout)
    jobFor(event).ready(preflightOrRefusal(payload));
  });
}

export class PrintError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface PrintWindowConfig {
  ctx: SecurityContext;
  /** app://nazeer/print/print.html, or the Vite dev server's /print/print.html */
  pageUrl: string;
  /** out/renderer (served by the app:// handler in built code) */
  rendererRoot: string;
  /** out/preload/print.js */
  preload: string;
  log?: (line: string) => void;
}

/** `work`, or a PrintError `print_timeout` when it takes longer than `ms` (the caller cleans up). */
export async function withinTime<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new PrintError("print_timeout", `${what} took longer than ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

export async function printInHiddenWindow(
  job: PrintJob,
  timeouts: PrintTimeouts,
  config: PrintWindowConfig,
): Promise<PrintOutcome> {
  const partition = `print-${randomUUID()}`; // no "persist:" prefix: kept in memory only
  const ses = session.fromPartition(partition);
  hardenSession(ses, config.ctx);
  if (config.ctx.devServerOrigin === null) handleAppProtocol(ses, config.rendererRoot);
  const win = new BrowserWindow({
    show: false,
    width: 794, // A4 at 96 px per inch
    height: 1123,
    webPreferences: {
      partition,
      preload: config.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: false,
    },
  });
  const contents = win.webContents;
  try {
    const ready = new Promise<PrintPreflight>((resolve, reject) => {
      pending.set(contents.id, { job, given: false, ready: resolve });
      contents.on("render-process-gone", (_event, details) => {
        reject(new PrintError("print_window_failed", `the print page stopped (${details.reason})`));
      });
      contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
        if (isMainFrame) {
          reject(
            new PrintError(
              "print_window_failed",
              `the print page did not load: ${code} ${description} ${url}`,
            ),
          );
        }
      });
    });
    void contents.loadURL(config.pageUrl).catch(() => undefined); // did-fail-load reports it
    const preflight = await withinTime(ready, timeouts.layoutMs, "the print page's layout");
    if (!preflight.ok) return { preflight, pdf: null };
    const printing = contents.printToPDF(PRINT_TO_PDF_OPTIONS).catch((error: unknown) => {
      throw new PrintError("print_failed", error instanceof Error ? error.message : String(error));
    });
    // a print abandoned by the timeout still settles later (the window is destroyed): no warning
    printing.catch(() => undefined);
    const pdf = await withinTime(printing, timeouts.printMs, "printing to PDF");
    config.log?.(
      `print: ${pdf.byteLength} bytes, ${preflight.checked.textNodes} text nodes checked`,
    );
    return { preflight, pdf: new Uint8Array(pdf) };
  } finally {
    pending.delete(contents.id);
    if (!win.isDestroyed()) win.destroy();
    await ses.clearStorageData().catch(() => undefined);
  }
}
