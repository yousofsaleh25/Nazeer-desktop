/** The operator window's bridge: a typed, minimal window.nazeer (no raw ipcRenderer). */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IPC,
  type ActivationResult,
  type BeforeQuitHandler,
  type CaptureScan,
  type ComparisonExportResult,
  type EngineConnection,
  type EngineStatusEvent,
  type ExportResult,
  type LicenseStatus,
  type NazeerApi,
  type OpenSavedResult,
  type SaveAsResult,
  type SavedCopy,
} from "@shared/ipc";

let beforeQuit: BeforeQuitHandler | null = null;

// main asks before the app closes; the page's handler flushes unsaved work (Stage 5 autosave)
ipcRenderer.on(IPC.appBeforeQuit, (_event: IpcRendererEvent, requestId: unknown) => {
  if (typeof requestId !== "number") return;
  void (async () => {
    let unsaved = false;
    try {
      if (beforeQuit !== null) unsaved = (await beforeQuit()).unsaved === true;
    } catch {
      unsaved = true;
    }
    await ipcRenderer.invoke(IPC.appQuitAck, { requestId, unsaved });
  })();
});

const api: NazeerApi = {
  engine: {
    getConnection: () =>
      ipcRenderer.invoke(IPC.engineGetConnection) as Promise<EngineConnection | null>,
    getStatus: () => ipcRenderer.invoke(IPC.engineGetStatus) as Promise<EngineStatusEvent>,
    retry: () => ipcRenderer.invoke(IPC.engineRetry) as Promise<void>,
    onStatus: (listener) => {
      const handler = (_event: IpcRendererEvent, payload: EngineStatusEvent): void =>
        listener(payload);
      ipcRenderer.on(IPC.engineStatus, handler);
      return () => {
        ipcRenderer.removeListener(IPC.engineStatus, handler);
      };
    },
  },
  dialogs: {
    openBag: () => ipcRenderer.invoke(IPC.dialogOpenBag) as Promise<string | null>,
    pickFolder: () => ipcRenderer.invoke(IPC.dialogPickFolder) as Promise<string | null>,
  },
  scan: {
    captureFolders: () => ipcRenderer.invoke(IPC.scanCaptureFolders) as Promise<CaptureScan>,
    setFolders: (folders) => ipcRenderer.invoke(IPC.scanSetFolders, folders) as Promise<string[]>,
  },
  app: {
    onBeforeQuit: (handler) => {
      beforeQuit = handler;
      return () => {
        if (beforeQuit === handler) beforeQuit = null;
      };
    },
    openLogFolder: () => ipcRenderer.invoke(IPC.appOpenLogFolder) as Promise<void>,
  },
  license: {
    getStatus: () => ipcRenderer.invoke(IPC.licenseGetStatus) as Promise<LicenseStatus>,
    activate: (key) => ipcRenderer.invoke(IPC.licenseActivate, key) as Promise<ActivationResult>,
  },
  print: {
    exportPdf: (request) =>
      ipcRenderer.invoke(IPC.printExportPdf, request) as Promise<ExportResult>,
    exportComparison: (request) =>
      ipcRenderer.invoke(IPC.printExportComparison, request) as Promise<ComparisonExportResult>,
  },
  report: {
    saveAs: (request) => ipcRenderer.invoke(IPC.reportSaveAs, request) as Promise<SaveAsResult>,
    savedCopy: (query) =>
      ipcRenderer.invoke(IPC.reportSavedCopy, query) as Promise<SavedCopy | null>,
    openSaved: (request) =>
      ipcRenderer.invoke(IPC.reportOpenSaved, request) as Promise<OpenSavedResult>,
  },
};

contextBridge.exposeInMainWorld("nazeer", api);
