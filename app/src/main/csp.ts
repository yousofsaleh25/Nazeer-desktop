/**
 * Content-Security-Policy builders (pure; unit-tested). The policy travels as a response header:
 * the app:// handler sets it in production, a webRequest hook limited to the Vite server sets it
 * in dev. The engine is reached on 127.0.0.1 at a port chosen at start, hence `127.0.0.1:*`.
 */

export type CspPage = "app" | "print";

export interface CspOptions {
  page: CspPage;
  /** The Vite dev-server origin when the page is served by it (dev); null in production. */
  devServerOrigin: string | null;
}

const ENGINE = "http://127.0.0.1:*";

export function buildCsp({ page, devServerOrigin }: CspOptions): string {
  // dev only: React Fast Refresh injects an inline module preamble; Vite's HMR uses a websocket
  const devScript = devServerOrigin === null ? [] : ["'unsafe-inline'"];
  const hmr = devServerOrigin === null ? [] : [devServerOrigin.replace(/^http/, "ws")];
  const directives: [string, string[]][] =
    page === "app"
      ? [
          ["default-src", ["'self'"]],
          ["script-src", ["'self'", ...devScript]],
          ["style-src", ["'self'", "'unsafe-inline'"]],
          ["img-src", ["'self'", "data:", "blob:", ENGINE]],
          ["font-src", ["'self'", "data:"]],
          ["connect-src", ["'self'", ENGINE, ...hmr]],
          ["worker-src", ["'self'", "blob:"]],
          ["frame-src", ["'none'"]],
          ["object-src", ["'none'"]],
          ["base-uri", ["'none'"]],
          ["form-action", ["'none'"]],
          ["frame-ancestors", ["'none'"]],
        ]
      : [
          // the print page gets everything it typesets over IPC: no network, images from blobs
          ["default-src", ["'none'"]],
          ["script-src", ["'self'", ...devScript]],
          ["style-src", ["'self'", "'unsafe-inline'"]],
          ["img-src", ["blob:", "data:"]],
          ["font-src", ["'self'", "data:", "blob:"]],
          ["connect-src", devServerOrigin === null ? ["'none'"] : ["'self'", ...hmr]],
          ["object-src", ["'none'"]],
          ["base-uri", ["'none'"]],
          ["form-action", ["'none'"]],
          ["frame-ancestors", ["'none'"]],
        ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** Which policy a page path gets (`/print/…` is the print page). */
export function cspPageFor(pathname: string): CspPage {
  return pathname.startsWith("/print/") ? "print" : "app";
}
