/**
 * Electron main: security baseline, the app:// renderer, the operator window, the licence gate,
 * the engine supervisor, printing (a hidden print window per report, ADR-D7) and the quit
 * sequence. `--export <session_dir>` runs the headless re-export instead (print/cli.ts): no
 * window, no single-instance lock, a throwaway Chromium profile and its own engine.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app, session, shell, type BrowserWindow } from "electron";
import { IPC, type ComparisonExportRequest, type ExportRequest } from "@shared/ipc";
import { APP_ORIGIN } from "./appPath";
import {
  confirmQuitDialog,
  confirmReplaceDialog,
  dataRootDialog,
  rendererLostDialog,
  saveCopyDialog,
  writeFailedDialog,
} from "./dialogs";
import { engineAssetsDir } from "./engine/command";
import { chooseDataRoot } from "./engine/dataRoot";
import { RotatingLog } from "./engine/logs";
import { isPidAlive, killPid, spawnEngineProcess } from "./engine/process";
import { EngineSupervisor } from "./engine/supervisor";
import { registerIpc } from "./ipc";
import { LICENSE_PUBLIC_KEY_PEM } from "./license/publicKey";
import { LicenseService } from "./license/service";
import { LicenseStore } from "./license/store";
import { readEngineAsset } from "./print/assets";
import {
  EXPORT_TEMP_PREFIX,
  parseExportArgs,
  removeStaleExportFolders,
  runHeadlessExport,
} from "./print/cli";
import { exportComparison } from "./print/exportComparison";
import { exportPdf, oneAtATime, type ExportDeps } from "./print/exportPdf";
import { printInHiddenWindow, registerPrintIpc } from "./print/printWindow";
import { handleAppProtocol, registerAppScheme } from "./protocol";
import { NODE_SAVE_AS_FS } from "./report/atomicWrite";
import { openSavedCopy, savedCopyStatus, type SavedCopyDeps } from "./report/savedCopies";
import { oneSaveAtATime, saveReportAs, testSaveDialogs, type SaveAsDialogs } from "./report/saveAs";
import { QuitCoordinator, RendererQuitBridge } from "./quit";
import { DEV_USER_DATA_NAME, devSwitch, isProduction, licenseRequired } from "./runtime";
import {
  hardenSession,
  installGlobalGuards,
  installProductionMenu,
  type SecurityContext,
} from "./security";
import { SettingsStore } from "./settings";
import { createMainWindow } from "./windows";

// production = packaged or built for packaging: every development switch below is ignored (D11)
const production = isProduction(app.isPackaged);
const devEnv = (name: string): string | undefined => devSwitch(production, process.env, name);

// electron-vite dev sets ELECTRON_RENDERER_URL; built code always loads app://nazeer
const devServerUrl = devEnv("ELECTRON_RENDERER_URL");
const ctx: SecurityContext = {
  devServerOrigin: devServerUrl ? new URL(devServerUrl).origin : null,
};
const exportArgs = parseExportArgs(process.argv);

registerAppScheme();
app.enableSandbox();

// development builds never touch the packaged app's profile; tests use a throwaway one
if (!production) {
  app.setPath(
    "userData",
    devEnv("NAZEER_USER_DATA_DIR") ?? join(app.getPath("appData"), DEV_USER_DATA_NAME),
  );
}
// keep Chromium's profile files apart from the engine's data-root layout (D9); a headless export
// runs beside the app, so it gets a throwaway profile of its own (earlier exports' are removed)
if (exportArgs !== null) removeStaleExportFolders(tmpdir());
app.setPath(
  "sessionData",
  exportArgs === null
    ? join(app.getPath("userData"), "chromium")
    : mkdtempSync(join(tmpdir(), EXPORT_TEMP_PREFIX)),
);

let mainWindow: BrowserWindow | null = null;

function rendererUrl(page: string): string {
  return devServerUrl ? new URL(page, `${devServerUrl}/`).toString() : `${APP_ORIGIN}/${page}`;
}

function liveWindow(): BrowserWindow | null {
  return mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** The licence public key: the baked one; development may point to a test key file. */
function licensePublicKeyPem(logLine: (line: string) => void): string | null {
  const file = devEnv("NAZEER_LICENSE_PUBLIC_KEY");
  if (file === undefined) return LICENSE_PUBLIC_KEY_PEM;
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    logLine(`licence: cannot read NAZEER_LICENSE_PUBLIC_KEY ${file} (${String(error)})`);
    return null;
  }
}

const appDir = app.getAppPath();
const appInfo = {
  appVersion: app.getVersion(),
  electron: process.versions.electron,
  chromium: process.versions.chrome,
};
const assetsDir = engineAssetsDir({ production, appDir, resourcesPath: process.resourcesPath });

/** The export's dependencies on this process: the engine, the files, the print window. */
function exportDeps(connection: ExportDeps["connection"], log: (line: string) => void): ExportDeps {
  return {
    connection,
    fetch: globalThis.fetch,
    readAsset: (name) => readEngineAsset(assetsDir, name),
    print: (job, timeouts) =>
      printInHiddenWindow(job, timeouts, {
        ctx,
        pageUrl: rendererUrl("print/print.html"),
        rendererRoot: join(__dirname, "../renderer"),
        preload: join(__dirname, "../preload/print.js"),
        log,
      }),
    appInfo,
    log,
  };
}

function licenseService(logLine: (line: string) => void): LicenseService {
  return new LicenseService({
    required: licenseRequired(production, process.env),
    publicKeyPem: licensePublicKeyPem(logLine),
    store: new LicenseStore(app.getPath("userData"), logLine),
    log: logLine,
  });
}

if (exportArgs !== null) {
  // ----- the headless re-export --------------------------------------------------------------
  installGlobalGuards(ctx);
  const logLine = (line: string): void => {
    process.stderr.write(`[export] ${line}\n`);
  };
  // the hidden print window closing must not end the run
  app.on("window-all-closed", () => undefined);
  void app.whenReady().then(async () => {
    registerPrintIpc();
    let supervisor: EngineSupervisor | null = null;
    // runHeadlessExport answers with an exit code; anything it still throws ends the run as 1,
    // never as a process that waits forever (the hidden print window keeps the app alive)
    let code = 1;
    try {
      code = await runHeadlessExport(exportArgs, {
        licenseActive: () => licenseService(logLine).status().state === "active",
        startEngine: (dataRoot) => {
          const engine = new EngineSupervisor(
            {
              dataRoot,
              production,
              appDir,
              resourcesPath: process.resourcesPath,
              corsOrigins: [APP_ORIGIN],
              env: process.env,
              appInfo,
              logDir: mkdtempSync(join(tmpdir(), `${EXPORT_TEMP_PREFIX}logs-`)),
              noWarmup: true,
              keepOtherEngines: true,
            },
            {
              spawn: spawnEngineProcess,
              fetch: globalThis.fetch,
              killPid,
              isPidAlive,
              log: { write: (source, line) => logLine(`${source}: ${line}`) },
            },
          );
          supervisor = engine;
          return new Promise((done) => {
            engine.onStatus((event) => {
              if (event.status === "ready" && event.connection !== null) {
                done({ connection: event.connection });
              } else if (event.status === "fatal" && event.fatal !== null) {
                done({ fatal: { code: event.fatal.code, message: event.fatal.message } });
              }
            });
            engine.start();
          });
        },
        stopEngine: async () => {
          await supervisor?.stop();
        },
        fetch: globalThis.fetch,
        exportPdf: (request) =>
          exportPdf(
            request,
            exportDeps(() => supervisor?.getConnection() ?? null, logLine),
          ),
        writeOut: (file, text) => writeFile(file, text, "utf8"),
        stdout: (text) => {
          process.stdout.write(text);
        },
      });
    } catch (error) {
      logLine(`export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    app.exit(code);
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // ----- the operator app ----------------------------------------------------------------------
  installGlobalGuards(ctx);

  const logDir = join(app.getPath("userData"), "logs");
  const log = new RotatingLog(logDir);
  const logLine = (line: string): void => log.write("supervisor", line);
  const dataRoot = chooseDataRoot({
    production,
    argv: process.argv,
    env: process.env,
    userData: app.getPath("userData"),
    repoDir: resolve(appDir, ".."),
  });
  logLine(
    `app ${app.getVersion()} starting (${production ? "production" : "development"}); ` +
      `data root ${dataRoot.path} (${dataRoot.source})`,
  );

  const license = licenseService(logLine);

  const supervisor = new EngineSupervisor(
    {
      dataRoot: dataRoot.path,
      production,
      appDir,
      resourcesPath: process.resourcesPath,
      corsOrigins: ctx.devServerOrigin === null ? [APP_ORIGIN] : [APP_ORIGIN, ctx.devServerOrigin],
      env: process.env,
      appInfo,
      logDir,
    },
    { spawn: spawnEngineProcess, fetch: globalThis.fetch, killPid, isPidAlive, log },
  );
  supervisor.onStatus((event) => liveWindow()?.webContents.send(IPC.engineStatus, event));
  // the engine runs only for a licensed app: no engine, no token, until a key is active
  const startEngineIfLicensed = (): void => {
    const status = license.status();
    if (status.state === "active") supervisor.start();
    else logLine(`engine waits for a licence (${status.configError ?? status.reason ?? "no key"})`);
  };

  const settings = new SettingsStore(app.getPath("userData"), logLine);
  const quitBridge = new RendererQuitBridge((requestId) => {
    const win = liveWindow();
    if (win === null || win.webContents.isCrashed()) return false;
    win.webContents.send(IPC.appBeforeQuit, requestId);
    return true;
  });
  const quit = new QuitCoordinator({
    askRenderer: (timeoutMs) => quitBridge.ask(timeoutMs),
    confirmQuit: (reason) => confirmQuitDialog(liveWindow(), reason),
    stopEngine: () => supervisor.stop(),
    clearCache: () => session.defaultSession.clearCache(),
    quit: () => app.quit(),
    log: logLine,
  });
  // one print at a time, a report's or a comparison's (D12)
  const exportGate = { busy: false };
  const exportReport = oneAtATime(
    (request: ExportRequest) =>
      exportPdf(
        request,
        exportDeps(() => supervisor.getConnection(), logLine),
      ),
    exportGate,
  );
  const exportComparisonReport = oneAtATime(
    (request: ComparisonExportRequest) =>
      exportComparison(
        request,
        exportDeps(() => supervisor.getConnection(), logLine),
      ),
    exportGate,
  );

  // "Save as" for a sealed PDF (D12): the operator window's Save dialog, or in development the
  // test switch NAZEER_E2E_SAVE_DIALOG (cancel | file:<path> | folder:<folder>; ignored in
  // production builds); everything after the dialog runs the same either way
  const saveSwitch = devEnv("NAZEER_E2E_SAVE_DIALOG");
  if (saveSwitch !== undefined)
    logLine(`save-as: the test switch answers the Save dialog (${saveSwitch})`);
  const saveDialogs: SaveAsDialogs =
    saveSwitch !== undefined
      ? testSaveDialogs(saveSwitch, logLine)
      : {
          choosePath: (defaultPath) => saveCopyDialog(liveWindow(), defaultPath),
          confirmReplace: (file) => confirmReplaceDialog(liveWindow(), file),
          insideDataRoot: (file) => dataRootDialog(liveWindow(), file),
          writeFailed: (problem, file, detail) =>
            writeFailedDialog(liveWindow(), problem, file, detail),
        };
  const saveAs = oneSaveAtATime((request) =>
    saveReportAs(request, {
      connection: () => supervisor.getConnection(),
      fetch: globalThis.fetch,
      dataRoot: dataRoot.path,
      documentsDir: app.getPath("documents"),
      lastSaveFolder: () => settings.get().lastSaveFolder,
      record: (copy) => settings.recordSavedCopy(copy),
      dialogs: saveDialogs,
      fs: NODE_SAVE_AS_FS,
      log: logLine,
    }),
  );
  const savedCopyDeps: SavedCopyDeps = {
    record: (query) => settings.savedCopy(query.kind, query.id, query.version),
    stat: async (file) => {
      const info = await stat(file);
      return { size: info.size, mtimeMs: info.mtimeMs };
    },
    openPath: (file) => shell.openPath(file),
    showItemInFolder: (file) => shell.showItemInFolder(file),
    log: logLine,
  };

  app.on("second-instance", () => {
    const win = liveWindow();
    if (win === null) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  });
  app.on("before-quit", (event) => quit.onCloseRequested(event));
  app.on("will-quit", (event) => quit.onWillQuit(event));
  // the operator window is the app: closing it quits, even while a hidden print window is open
  app.on("window-all-closed", () => app.quit());

  void app.whenReady().then(() => {
    hardenSession(session.defaultSession, ctx);
    handleAppProtocol(session.defaultSession, join(__dirname, "../renderer"));
    installProductionMenu(ctx);
    registerPrintIpc();
    registerIpc(ctx, {
      engine: supervisor,
      window: liveWindow,
      settings,
      quitBridge,
      logDir,
      license,
      onLicenseActivated: startEngineIfLicensed,
      exportPdf: exportReport,
      exportComparison: exportComparisonReport,
      report: {
        saveAs,
        savedCopy: (query) => savedCopyStatus(query, savedCopyDeps),
        openSaved: (request) => openSavedCopy(request, savedCopyDeps),
      },
    });
    startEngineIfLicensed();
    const win = createMainWindow(rendererUrl("renderer/index.html"), {
      forwardConsole: ctx.devServerOrigin !== null,
      devTools: !production,
      log: logLine,
      onRendererLost: async (reason) => {
        const again = await rendererLostDialog(liveWindow(), logDir, reason);
        if (!again) app.quit();
        return again;
      },
    });
    mainWindow = win;
    win.on("close", (event) => quit.onCloseRequested(event));
    win.on("closed", () => {
      mainWindow = null;
    });
  });
}
