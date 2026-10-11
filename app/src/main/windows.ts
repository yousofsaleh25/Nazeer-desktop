import { join } from "node:path";
import { app, BrowserWindow } from "electron";

/** The operator window: sandboxed renderer, context isolation, no Node, preload bridge only.
 * `forwardConsole` (dev): renderer warnings/errors, CSP violations included, go to the dev log. */
export function createMainWindow(url: string, { forwardConsole = false } = {}): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: "نظير — Nazeer",
    backgroundColor: "#f5efe6",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.once("ready-to-show", () => win.show());
  if (forwardConsole) {
    win.webContents.on("console-message", (event) => {
      if (event.level === "warning" || event.level === "error") {
        console.log(
          `[renderer ${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`,
        );
      }
    });
    win.webContents.on("did-fail-load", (_event, code, description, failedUrl) => {
      console.log(`[renderer load failed] ${code} ${description} ${failedUrl}`);
    });
  }
  void win.loadURL(url);
  return win;
}
