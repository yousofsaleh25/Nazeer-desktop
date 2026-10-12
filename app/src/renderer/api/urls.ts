/**
 * URLs for things the page loads without fetch (`<img>`, EventSource, the PDF bytes for pdf.js):
 * engine-relative paths from the API (`/sessions/<id>/assets/rgb.png`, `outputs.overlay.url`
 * with its `?v=`) made absolute on the current engine, with the token as a query parameter
 * (`URL.searchParams.set`, so an existing query is kept and the token is encoded). A URL that
 * points anywhere but the engine is refused: the token never leaves 127.0.0.1.
 */
import type { ClientConnection } from "./client";

export function engineUrl(conn: ClientConnection, pathOrUrl: string): string {
  const base = new URL(conn.baseUrl);
  const url = new URL(pathOrUrl, base);
  if (url.origin !== base.origin) {
    throw new Error(`not an engine URL: ${pathOrUrl}`);
  }
  url.searchParams.set("token", conn.token);
  return url.toString();
}
