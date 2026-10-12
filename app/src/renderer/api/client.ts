/**
 * The typed engine client (openapi-fetch over the generated `@shared/api` paths). One client per
 * engine connection: base URL `http://127.0.0.1:<port>`, the `X-Nazeer-Token` header and the app
 * version headers on every request, `cache: "no-store"` (responses carry session state; nothing
 * may be served stale).
 *
 * `settle()` turns one call into data or a plain ApiErrorShape: the engine's envelope keeps its
 * code / message / details, a failed fetch is `network_error`, a malformed 2xx body is
 * `invalid_response`. `etagOf()` reads the `ETag` (`"r<revision>-<hash>"`) that the six
 * operations returning a SessionView send; the next autosave sends it back as If-Match.
 */
import createClient, { type Client } from "openapi-fetch";
import type { paths } from "@shared/api";
import { appError, errorFromResponse, networkError, type ApiErrorShape } from "./errors";

export type EngineClient = Client<paths>;

export interface ClientConnection {
  baseUrl: string;
  token: string;
  /** the app, Electron and Chromium versions: the engine stamps them into the session, the
   * report model and the manifest on finalize and report-input changes (library-version stamp) */
  appVersion?: string;
  electron?: string;
  chromium?: string;
}

export type FetchLike = (input: Request) => Promise<Response>;

/** X-App-Version / X-Electron / X-Chromium for the versions the connection knows. */
export function appHeaders(conn: ClientConnection): Record<string, string> {
  const headers: Record<string, string> = {};
  if (conn.appVersion) headers["X-App-Version"] = conn.appVersion;
  if (conn.electron) headers["X-Electron"] = conn.electron;
  if (conn.chromium) headers["X-Chromium"] = conn.chromium;
  return headers;
}

export function createEngineClient(conn: ClientConnection, fetchImpl?: FetchLike): EngineClient {
  return createClient<paths>({
    baseUrl: conn.baseUrl,
    headers: { "X-Nazeer-Token": conn.token, ...appHeaders(conn) },
    cache: "no-store",
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
}

export type Settled<T> = { data: T; response: Response } | { error: ApiErrorShape };

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

export async function settle<T>(call: () => Promise<FetchResult<T>>): Promise<Settled<T>> {
  let result: FetchResult<T>;
  try {
    result = await call();
  } catch (error) {
    // openapi-fetch parses a 2xx body with JSON.parse; anything else thrown is the fetch failing
    if (error instanceof SyntaxError) return { error: appError("invalid_response", error.message) };
    return { error: networkError(error) };
  }
  const { response } = result;
  if (!response.ok) return { error: errorFromResponse(response.status, result.error) };
  return { data: result.data as T, response };
}

/** The operations whose response is a SessionView and whose ETag the session keeps (Stage 5). */
export const SESSION_VIEW_OPERATIONS = [
  "create_session",
  "get_session",
  "put_document",
  "finalize_session",
  "reopen_session",
  "patch_report_inputs",
] as const;

export function etagOf(response: Response): string | null {
  return response.headers.get("ETag");
}
