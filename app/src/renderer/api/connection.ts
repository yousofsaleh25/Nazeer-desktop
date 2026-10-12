/**
 * The current engine connection and its client, outside Redux (a client is not serialisable).
 * The engine bridge (store/engineBridge.ts) replaces it whenever the supervisor reports a new
 * connection (a restart means a new port, token and pid); RTK Query endpoints read it per call.
 */
import type { EngineConnection } from "@shared/ipc";
import { createEngineClient, type EngineClient, type FetchLike } from "./client";
import type { ApiErrorShape } from "./errors";

export interface ActiveEngine {
  connection: EngineConnection;
  client: EngineClient;
  /** the same fetch the client uses, for engine bytes read outside the typed client (assets) */
  fetch: FetchLike;
}

let active: ActiveEngine | null = null;

export function setEngineConnection(
  connection: EngineConnection | null,
  fetchImpl?: FetchLike,
): void {
  active =
    connection === null
      ? null
      : {
          connection,
          client: createEngineClient(connection, fetchImpl),
          fetch: fetchImpl ?? ((request) => fetch(request)),
        };
}

export function activeEngine(): ActiveEngine | null {
  return active;
}

/** The error a call gets while no engine is connected (starting, restarting, stopped). */
export const ENGINE_NOT_CONNECTED: ApiErrorShape = {
  status: null,
  code: "engine_not_ready",
  message: "the engine is not connected",
  details: {},
};
