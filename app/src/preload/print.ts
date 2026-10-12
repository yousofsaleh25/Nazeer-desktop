/**
 * The hidden print window's bridge (`window.nazeerPrint`, ADR-D7): the page asks main for its job
 * (the report model, the approved overlay bytes, the face, the logo, the required strings) and
 * says when it is laid out and checked. Main answers only the window it opened for the job.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { NazeerPrintApi, PrintJob, PrintPreflight } from "@shared/ipc";
import { PRINT_IPC } from "@shared/printChannels";

const api: NazeerPrintApi = {
  getJob: () => ipcRenderer.invoke(PRINT_IPC.getJob) as Promise<PrintJob>,
  ready: (result: PrintPreflight) => ipcRenderer.invoke(PRINT_IPC.ready, result) as Promise<void>,
};

contextBridge.exposeInMainWorld("nazeerPrint", api);
