/**
 * Sends what the hover (depth) and drag (preview) channels queue (session/probe.ts): whenever a
 * channel's request in flight changes, it goes to the engine with its seq; the answer, an error or
 * a 5 s timeout frees the slot (and sends whatever is pending). Answers that arrive after another
 * session was opened are dropped. The pointer-side throttle (one request per animation frame) is
 * the canvas's.
 */
import { settle, type EngineClient, type Settled } from "@/api/client";
import { activeEngine, ENGINE_NOT_CONNECTED } from "@/api/connection";
import type { DepthOut, PreviewOut } from "@/api/types";
import type { AppStartListening } from "../listener";
import type { ProbeChannel } from "../session/probe";
import {
  depthFailed,
  depthReplied,
  previewFailed,
  previewReplied,
  type SessionState,
} from "../slices/session";

export const PROBE_TIMEOUT_MS = 5000;

function newFlight<Req, Res>(current: ProbeChannel<Req, Res>, previous: ProbeChannel<Req, Res>) {
  return current.inFlight !== null && current.inFlight.seq !== previous.inFlight?.seq;
}

/** One engine call with a timeout (an aborted fetch settles as `network_error`). */
async function timed<T>(
  call: (client: EngineClient, signal: AbortSignal) => Promise<Settled<T>>,
): Promise<Settled<T>> {
  const engine = activeEngine();
  if (engine === null) return { error: ENGINE_NOT_CONNECTED };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await call(engine.client, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function startProbes(startListening: AppStartListening): void {
  startListening({
    predicate: (_action, current, previous) =>
      newFlight(current.session.depth, previous.session.depth),
    effect: async (_action, api) => {
      const { id, depth }: SessionState = api.getState().session;
      const flight = depth.inFlight;
      if (id === null || flight === null) return;
      const result = await timed((client, signal) =>
        settle(() =>
          client.POST("/sessions/{session_id}/depth", {
            params: { path: { session_id: id } },
            body: { ...flight.request, seq: flight.seq },
            signal,
          }),
        ),
      );
      if (api.getState().session.id !== id) return;
      if ("error" in result) api.dispatch(depthFailed(flight.seq));
      // the typed client's data (tuples widened) is the engine's DepthOut
      else api.dispatch(depthReplied({ ...(result.data as unknown as DepthOut), seq: flight.seq }));
    },
  });

  startListening({
    predicate: (_action, current, previous) =>
      newFlight(current.session.preview, previous.session.preview),
    effect: async (_action, api) => {
      const { id, preview }: SessionState = api.getState().session;
      const flight = preview.inFlight;
      if (id === null || flight === null) return;
      const result = await timed((client, signal) =>
        settle(() =>
          client.POST("/sessions/{session_id}/preview", {
            params: { path: { session_id: id } },
            body: { measurement: flight.request.measurement, seq: flight.seq },
            signal,
          }),
        ),
      );
      if (api.getState().session.id !== id) return;
      if ("error" in result) api.dispatch(previewFailed(flight.seq));
      else
        api.dispatch(
          previewReplied({ ...(result.data as unknown as PreviewOut), seq: flight.seq }),
        );
    },
  });
}
