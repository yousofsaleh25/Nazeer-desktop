/** app://nazeer: the packaged renderer, served from out/renderer with its CSP header. */
import { readFile } from "node:fs/promises";
import { protocol, type Session } from "electron";
import { APP_SCHEME, mimeType, resolveAppPath } from "./appPath";
import { buildCsp, cspPageFor } from "./csp";

/** Must run before `app` is ready. `secure` makes the page a secure context (crypto.subtle);
 * `standard` gives it the real origin app://nazeer that the engine's CORS list allows. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ]);
}

function notFound(): Response {
  return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });
}

/** Serve app://nazeer/<path> from `root` on one session (the default one, every print partition). */
export function handleAppProtocol(ses: Session, root: string): void {
  ses.protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppPath(root, request.url);
    if (file === null) return notFound();
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return notFound();
    }
    const page = cspPageFor(new URL(request.url).pathname);
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": mimeType(file),
        "Content-Security-Policy": buildCsp({ page, devServerOrigin: null }),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      },
    });
  });
}
