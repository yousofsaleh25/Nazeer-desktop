/**
 * Electron-side security baseline (D9): navigation / window.open / webview guards, a deny-all
 * permission policy with three exceptions for the app's own origins, the dev CSP header hook,
 * the production menu and the IPC sender check.
 */
import { app, Menu, type IpcMainInvokeEvent, type Session } from "electron";
import { APP_ORIGIN } from "./appPath";
import { buildCsp, cspPageFor } from "./csp";

export interface SecurityContext {
  /** The Vite dev-server origin in `electron-vite dev`; null for built code (app://nazeer). */
  devServerOrigin: string | null;
}

/** Chromium 152 Local Network Access (app:// → 127.0.0.1) and ErrorPanel's copy button. */
const ALLOWED_PERMISSIONS = new Set([
  "local-network-access",
  "loopback-network",
  "clipboard-sanitized-write",
]);

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    // URL.origin is "null" for non-special schemes; build it for app://nazeer
    return parsed.protocol === "app:" ? `app://${parsed.host}` : parsed.origin;
  } catch {
    return null;
  }
}

export function isAppOrigin(origin: string | null, ctx: SecurityContext): boolean {
  return origin !== null && (origin === APP_ORIGIN || origin === ctx.devServerOrigin);
}

export function isAppUrl(url: string, ctx: SecurityContext): boolean {
  return isAppOrigin(originOf(url), ctx);
}

/** Every webContents: no popups, no navigation away from the app, no webviews. */
export function installGlobalGuards(ctx: SecurityContext): void {
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (!isAppUrl(url, ctx)) event.preventDefault();
    });
    contents.on("will-redirect", (event, url) => {
      if (!isAppUrl(url, ctx)) event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    if (ctx.devServerOrigin === null) {
      // built app: reloading would drop unsaved state; DevTools would expose the engine token
      contents.on("before-input-event", (event, input) => {
        const key = input.key.toLowerCase();
        const reload = key === "f5" || (input.control && key === "r");
        const devtools = key === "f12" || (input.control && input.shift && key === "i");
        if (input.type === "keyDown" && (reload || devtools)) event.preventDefault();
      });
    }
  });
}

/** Permissions and the dev CSP for one session (the default one and every print partition). */
export function hardenSession(ses: Session, ctx: SecurityContext): void {
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl, ctx));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isAppOrigin(requestingOrigin, ctx);
  });
  const devOrigin = ctx.devServerOrigin;
  if (devOrigin !== null) {
    // only the Vite server's responses: engine responses must reach the page untouched
    ses.webRequest.onHeadersReceived({ urls: [`${devOrigin}/*`] }, (details, callback) => {
      const page = cspPageFor(new URL(details.url).pathname);
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [buildCsp({ page, devServerOrigin: devOrigin })],
        },
      });
    });
  }
}

/** Built app: Edit menu only (no reload, no DevTools). Dev keeps Electron's default menu. */
export function installProductionMenu(ctx: SecurityContext): void {
  if (ctx.devServerOrigin === null) {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "editMenu" }]));
  }
}

/** IPC is answered only for the main frame of an app page. */
export function isTrustedSender(event: IpcMainInvokeEvent, ctx: SecurityContext): boolean {
  const frame = event.senderFrame;
  return frame !== null && frame === event.sender.mainFrame && isAppUrl(frame.url, ctx);
}
