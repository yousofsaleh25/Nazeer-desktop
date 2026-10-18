/** IPC handlers. Every channel checks its sender; every payload is validated (ipcValidate). */
import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  IPC,
  type ActivationResult,
  type CaptureScan,
  type ComparisonExportRequest,
  type ComparisonExportResult,
  type EngineConnection,
  type EngineStatusEvent,
  type ExportRequest,
  type ExportResult,
  type LicenseStatus,
  type OpenSavedRequest,
  type OpenSavedResult,
  type SaveAsRequest,
  type SaveAsResult,
  type SavedCopy,
  type SavedCopyQuery,
} from "@shared/ipc";
import {
  validateCaptureFolders,
  validateComparisonExportRequest,
  validateExportRequest,
  validateLicenseKeyInput,
  validateOpenSavedRequest,
  validateQuitAck,
  validateSaveAsRequest,
  validateSavedCopyQuery,
} from "@shared/ipcValidate";
import { openBagDialog, pickFolderDialog } from "./dialogs";
import type { RendererQuitBridge } from "./quit";
import { scanCaptureFolders } from "./scan";
import { isTrustedSender, type SecurityContext } from "./security";
import type { SettingsStore } from "./settings";

export interface IpcDeps {
  engine: {
    getConnection(): EngineConnection | null;
    statusEvent(): EngineStatusEvent;
    retry(): void;
  };
  /** the operator window (dialog parent); null while it is being created or after it closed */
  window(): BrowserWindow | null;
  settings: SettingsStore;
  quitBridge: RendererQuitBridge;
  logDir: string;
  license: {
    status(): LicenseStatus;
    activate(key: string): ActivationResult;
  };
  /** after a key was accepted: start the engine if it is not running yet */
  onLicenseActivated(): void;
  /** print and seal a report (print/exportPdf.ts; one at a time) */
  exportPdf(request: ExportRequest): Promise<ExportResult>;
  /** print and seal a comparison (print/exportComparison.ts; one at a time with exportPdf, D12) */
  exportComparison(request: ComparisonExportRequest): Promise<ComparisonExportResult>;
  /** "Save as" for a sealed PDF (report/saveAs.ts, report/savedCopies.ts; D12) */
  report: {
    saveAs(request: SaveAsRequest): Promise<SaveAsResult>;
    savedCopy(query: SavedCopyQuery): Promise<SavedCopy | null>;
    openSaved(request: OpenSavedRequest): Promise<OpenSavedResult>;
  };
}

export function registerIpc(ctx: SecurityContext, deps: IpcDeps): void {
  const handle = <T>(channel: string, run: (event: IpcMainInvokeEvent, payload: unknown) => T) => {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (!isTrustedSender(event, ctx)) throw new Error("untrusted sender");
      return run(event, payload);
    });
  };

  handle(IPC.engineGetConnection, () => deps.engine.getConnection());
  handle(IPC.engineGetStatus, () => deps.engine.statusEvent());
  handle(IPC.engineRetry, () => {
    deps.engine.retry();
  });

  handle(IPC.dialogOpenBag, () => openBagDialog(deps.window()));
  handle(IPC.dialogPickFolder, () => pickFolderDialog(deps.window()));

  handle(IPC.scanCaptureFolders, (): Promise<CaptureScan> =>
    scanCaptureFolders(deps.settings.get().captureFolders),
  );
  handle(IPC.scanSetFolders, (_event, payload) =>
    deps.settings.setCaptureFolders(validateCaptureFolders(payload)),
  );

  handle(IPC.appQuitAck, (_event, payload) => {
    const ack = validateQuitAck(payload);
    deps.quitBridge.acknowledge(ack.requestId, ack.unsaved);
  });
  handle(IPC.appOpenLogFolder, async () => {
    const problem = await shell.openPath(deps.logDir);
    if (problem !== "") throw new Error(problem);
  });

  handle(IPC.licenseGetStatus, () => deps.license.status());
  handle(IPC.licenseActivate, (_event, payload) => {
    const result = deps.license.activate(validateLicenseKeyInput(payload));
    if (result.accepted) deps.onLicenseActivated();
    return result;
  });

  handle(IPC.printExportPdf, (_event, payload) => deps.exportPdf(validateExportRequest(payload)));
  handle(IPC.printExportComparison, (_event, payload) =>
    deps.exportComparison(validateComparisonExportRequest(payload)),
  );

  handle(IPC.reportSaveAs, (_event, payload) => deps.report.saveAs(validateSaveAsRequest(payload)));
  handle(IPC.reportSavedCopy, (_event, payload) =>
    deps.report.savedCopy(validateSavedCopyQuery(payload)),
  );
  handle(IPC.reportOpenSaved, (_event, payload) =>
    deps.report.openSaved(validateOpenSavedRequest(payload)),
  );
}
