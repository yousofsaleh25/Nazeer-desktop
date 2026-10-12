import { join } from "node:path";
import { BrowserWindow } from "electron";
// the Nazeer logo (build/icon.ico, from scripts/make_icon.py): the packaged executable carries it
// too, but a development run is electron.exe, whose window would show Electron's logo
import windowIcon from "../../build/icon.ico?asset";

export interface MainWindowOptions {
  /** dev: renderer warnings/errors, CSP violations included, go to the dev log */
  forwardConsole?: boolean;
  /** the supervisor log (renderer crashes are recorded there) */
  log?: (line: string) => void;
  /** development builds only (production = packaged or built for packaging, runtime.ts) */
  devTools?: boolean;
}

/** The operator window: sandboxed renderer, context isolation, no Node, preload bridge only.
 * A renderer that crashed or was killed is logged and reloaded (its unsaved state is gone either
 * way; the engine kept every autosaved revision). */
export function createMainWindow(
  url: string,
  { forwardConsole = false, log, devTools = false }: MainWindowOptions = {},
): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: "نظير — Nazeer",
    icon: windowIcon,
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
      devTools,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.on("render-process-gone", (_event, details) => {
    log?.(`renderer gone: ${details.reason} (exit code ${details.exitCode})`);
    if (details.reason !== "clean-exit" && !win.isDestroyed()) win.webContents.reload();
  });
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
