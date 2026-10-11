/**
 * Electron main: security baseline, the app:// renderer, the operator window.
 * (Stage 1 scaffold; the engine supervisor arrives in Stage 4, printing in Stage 7.)
 */
import { join } from "node:path";
import { app, session, type BrowserWindow } from "electron";
import { APP_ORIGIN } from "./appPath";
import { registerIpc } from "./ipc";
import { handleAppProtocol, registerAppScheme } from "./protocol";
import {
  hardenSession,
  installGlobalGuards,
  installProductionMenu,
  type SecurityContext,
} from "./security";
import { createMainWindow } from "./windows";

// electron-vite dev sets ELECTRON_RENDERER_URL; built code always loads app://nazeer
const devServerUrl = app.isPackaged ? undefined : process.env["ELECTRON_RENDERER_URL"];
const ctx: SecurityContext = {
  devServerOrigin: devServerUrl ? new URL(devServerUrl).origin : null,
};

registerAppScheme();
app.enableSandbox();

// tests run the built app against a throwaway profile; never honoured by a packaged build
const userDataOverride = app.isPackaged ? undefined : process.env["NAZEER_USER_DATA_DIR"];
if (userDataOverride) app.setPath("userData", userDataOverride);
// keep Chromium's profile files apart from the engine's data-root layout (D9)
app.setPath("sessionData", join(app.getPath("userData"), "chromium"));

let mainWindow: BrowserWindow | null = null;

function rendererUrl(page: string): string {
  return devServerUrl ? new URL(page, `${devServerUrl}/`).toString() : `${APP_ORIGIN}/${page}`;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  installGlobalGuards(ctx);
  app.on("second-instance", () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("window-all-closed", () => app.quit());

  void app.whenReady().then(() => {
    hardenSession(session.defaultSession, ctx);
    handleAppProtocol(session.defaultSession, join(__dirname, "../renderer"));
    installProductionMenu(ctx);
    registerIpc(ctx, { getConnection: () => null });
    mainWindow = createMainWindow(rendererUrl("renderer/index.html"), {
      forwardConsole: ctx.devServerOrigin !== null,
    });
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  });
}
