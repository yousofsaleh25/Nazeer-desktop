/**
 * A connected engine for component tests: the real captured payloads (app/fixtures) served by a
 * fake fetch through the real typed client, and the matching `engine` slice state.
 */
import health from "../../../fixtures/health.json";
import labels from "../../../fixtures/labels.json";
import recentBags from "../../../fixtures/recent_bags.json";
import versions from "../../../fixtures/versions.json";
import type { EngineConnection } from "@shared/ipc";
import type { FetchLike } from "@/api/client";
import { setEngineConnection } from "@/api/connection";
import { sampleConnection } from "@/design/samples";
import { ENGINE_INITIAL, type EngineState } from "@/store/slices/engine";

const ROUTES: Record<string, unknown> = {
  "/health": health,
  "/versions": versions,
  "/meta/labels": labels,
  "/bags/recent": recentBags,
};

export interface FixtureFetch extends FetchLike {
  requests: Request[];
}

/** Serves the fixtures by path; `overrides` replace a path's response (status + body). */
export function fixtureFetch(
  overrides: Record<string, { status: number; body: unknown }> = {},
): FixtureFetch {
  const requests: Request[] = [];
  const respond = (pathname: string): Response => {
    const override = overrides[pathname];
    if (override !== undefined) {
      return new Response(JSON.stringify(override.body), {
        status: override.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = ROUTES[pathname];
    if (body === undefined) {
      return new Response(
        JSON.stringify({ error: { code: "not_found", message: "Not Found", details: {} } }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const fetchImpl = ((request: Request) => {
    requests.push(request);
    return Promise.resolve(respond(new URL(request.url).pathname));
  }) as FixtureFetch;
  fetchImpl.requests = requests;
  return fetchImpl;
}

export type Handler = (request: Request, url: URL) => Response | Promise<Response>;

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function errorResponse(status: number, code: string, details: Record<string, unknown> = {}) {
  return jsonResponse(status, { error: { code, message: code, details } });
}

/**
 * An engine scripted per test: `handlers` answer "METHOD /path" (exact path); the fixture
 * routes answer the GETs they know; anything else is the engine's 404.
 */
export function connectScriptedEngine(handlers: Record<string, Handler>): FixtureFetch {
  const fixtures = fixtureFetch();
  const requests: Request[] = [];
  const fetchImpl = (async (request: Request) => {
    requests.push(request);
    const url = new URL(request.url);
    const handler = handlers[`${request.method} ${url.pathname}`];
    if (handler !== undefined) return handler(request, url);
    return fixtures(request);
  }) as FixtureFetch;
  fetchImpl.requests = requests;
  setEngineConnection(sampleConnection, fetchImpl);
  return fetchImpl;
}

/** Make the fixture engine the active one; returns its fetch (to inspect requests). */
export function connectFixtureEngine(
  connection: EngineConnection = sampleConnection,
  overrides?: Record<string, { status: number; body: unknown }>,
): FixtureFetch {
  const fetchImpl = fixtureFetch(overrides);
  setEngineConnection(connection, fetchImpl);
  return fetchImpl;
}

export function engineState(change: Partial<EngineState> = {}): EngineState {
  return { ...ENGINE_INITIAL, seq: 1, status: "ready", connection: sampleConnection, ...change };
}
