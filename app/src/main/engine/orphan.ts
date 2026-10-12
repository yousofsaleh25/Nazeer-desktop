/**
 * Exit 6 (`engine_already_running`): another engine holds `<data root>\engine.lock`. The fatal
 * line's details carry the holder's pid and port (port is null while that engine is still
 * loading the model). `/health` answers without a token, so the supervisor can ask that engine
 * who it is: when its pid and data root match the lock, it is an engine serving our data root
 * (typically one left behind by an app that was killed). Pure verdict + a small fetch helper;
 * unit-tested.
 */
import { samePath } from "./dataRoot";

export interface LockHolder {
  pid: number | null;
  port: number | null;
}

export type OrphanVerdict =
  | { kind: "ours"; pid: number; port: number }
  | { kind: "unknown"; reason: string; pid: number | null; port: number | null };

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function lockHolderFrom(details: Record<string, unknown>): LockHolder {
  const port = positiveInt(details["port"]);
  return { pid: positiveInt(details["pid"]), port: port !== null && port <= 65535 ? port : null };
}

/** `health` is the parsed /health body, or null when nothing answered. */
export function judgeLockHolder(
  holder: LockHolder,
  health: unknown,
  dataRoot: string,
): OrphanVerdict {
  const { pid, port } = holder;
  if (pid === null || port === null) {
    return { kind: "unknown", reason: "the lock names no pid or port yet", pid, port };
  }
  if (typeof health !== "object" || health === null) {
    return { kind: "unknown", reason: "no answer from /health on the lock's port", pid, port };
  }
  const body = health as Record<string, unknown>;
  if (body["pid"] !== pid) {
    return { kind: "unknown", reason: "the engine on that port has another pid", pid, port };
  }
  const root = body["data_root"];
  if (typeof root !== "string" || !samePath(root, dataRoot)) {
    return {
      kind: "unknown",
      reason: "the engine on that port serves another data root",
      pid,
      port,
    };
  }
  return { kind: "ours", pid, port };
}

/** GET http://127.0.0.1:<port>/health with a timeout; null on any failure. */
export async function probeHealth(
  port: number,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
