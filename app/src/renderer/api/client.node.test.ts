import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import stale from "../../../fixtures/error_409_stale_revision.json";
import health from "../../../fixtures/health.json";
import {
  createEngineClient,
  etagOf,
  SESSION_VIEW_OPERATIONS,
  settle,
  type FetchLike,
} from "./client";

const CONN = { baseUrl: "http://127.0.0.1:51234", token: "ab".repeat(32) };

function serve(response: () => Response | Promise<Response>): FetchLike & { last?: Request } {
  const fetchImpl = (async (request: Request) => {
    fetchImpl.last = request;
    return response();
  }) as FetchLike & { last?: Request };
  return fetchImpl;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("engine client", () => {
  it("calls the engine on 127.0.0.1 with the token header and no HTTP caching", async () => {
    const fetchImpl = serve(() => json(health));
    const client = createEngineClient(CONN, fetchImpl);
    const result = await settle(() => client.GET("/health"));
    expect(result).toMatchObject({ data: { status: "ok", pid: health.pid } });
    const request = fetchImpl.last!;
    expect(request.url).toBe("http://127.0.0.1:51234/health");
    expect(request.headers.get("X-Nazeer-Token")).toBe(CONN.token);
    expect(request.cache).toBe("no-store");
    expect(request.headers.get("X-App-Version")).toBeNull();
  });

  it("sends the app, Electron and Chromium versions the engine stamps into its records", async () => {
    const fetchImpl = serve(() => json(health));
    const client = createEngineClient(
      { ...CONN, appVersion: "0.1.0", electron: "44.4.5", chromium: "152.0.7000.0" },
      fetchImpl,
    );
    await settle(() => client.GET("/health"));
    const request = fetchImpl.last!;
    expect(request.headers.get("X-App-Version")).toBe("0.1.0");
    expect(request.headers.get("X-Electron")).toBe("44.4.5");
    expect(request.headers.get("X-Chromium")).toBe("152.0.7000.0");
  });

  it("keeps the engine's error envelope: code, message, details, HTTP status", async () => {
    const client = createEngineClient(
      CONN,
      serve(() => json(stale, 409)),
    );
    const result = await settle(() =>
      client.PUT("/sessions/{session_id}/document", {
        params: { path: { session_id: "20261011_152956_e20a7c" } },
        body: { revision: 0, measurements: [] },
      }),
    );
    expect("error" in result && result.error).toMatchObject({
      status: 409,
      code: "stale_revision",
      message: stale.error.message,
    });
    expect("error" in result && result.error.details["current"]).toBeTruthy();
  });

  it("a body that is not the envelope becomes http_error with the body kept", async () => {
    const client = createEngineClient(
      CONN,
      serve(() => new Response("Bad Gateway", { status: 502 })),
    );
    const result = await settle(() => client.GET("/health"));
    expect("error" in result && result.error).toEqual({
      status: 502,
      code: "http_error",
      message: "HTTP 502",
      details: { body: "Bad Gateway" },
    });
  });

  it("a failed fetch is network_error; a malformed 2xx body is invalid_response", async () => {
    const down = createEngineClient(
      CONN,
      serve(() => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const failed = await settle(() => down.GET("/health"));
    expect("error" in failed && failed.error).toMatchObject({
      status: null,
      code: "network_error",
      message: "Failed to fetch",
    });

    const garbled = createEngineClient(
      CONN,
      serve(() => new Response("{", { status: 200 })),
    );
    const parsed = await settle(() => garbled.GET("/health"));
    expect("error" in parsed && parsed.error.code).toBe("invalid_response");
  });

  it("reads the session ETag from the response", async () => {
    const client = createEngineClient(
      CONN,
      serve(() => json({}, 200, { ETag: '"r3-abc"' })),
    );
    const result = await settle(() =>
      client.GET("/sessions/{session_id}", {
        params: { path: { session_id: "20261011_152956_e20a7c" } },
      }),
    );
    expect("response" in result && etagOf(result.response)).toBe('"r3-abc"');
  });

  it("names exactly the operations whose 2xx response is a SessionView", () => {
    const spec = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../../../engine/openapi.json", import.meta.url)),
        "utf8",
      ),
    ) as { paths: Record<string, Record<string, { operationId: string; responses: object }>> };
    const returningView: string[] = [];
    for (const item of Object.values(spec.paths)) {
      for (const op of Object.values(item)) {
        const ok = Object.entries(op.responses).filter(([code]) => code.startsWith("2"));
        if (JSON.stringify(ok).includes('"#/components/schemas/SessionView"')) {
          returningView.push(op.operationId);
        }
      }
    }
    expect([...SESSION_VIEW_OPERATIONS].sort()).toEqual(returningView.sort());
  });
});
