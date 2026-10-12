/**
 * A SessionView from the engine (create, get, autosave, finalize, reopen, report inputs, a 409's
 * `current`), checked for the fields the session store relies on. openapi-fetch's response types
 * widen tuples (`points` becomes `number[][]`), so the typed client's data is narrowed here once
 * instead of being cast at every call; a body without these fields is `invalid_response`.
 */
import { appError, isRecord, type ApiErrorShape } from "./errors";
import type { SessionView } from "./types";

export function parseSessionView(raw: unknown): SessionView {
  if (
    !isRecord(raw) ||
    typeof raw["session_id"] !== "string" ||
    typeof raw["revision"] !== "number" ||
    typeof raw["status"] !== "string" ||
    typeof raw["next_measurement_id"] !== "number" ||
    !Array.isArray(raw["measurements"])
  ) {
    throw new TypeError("not a session view (session_id, revision, status, measurements)");
  }
  for (const row of raw["measurements"]) {
    if (!isRecord(row) || typeof row["id"] !== "number" || typeof row["order"] !== "number") {
      throw new TypeError("not a session view: a measurement row has no id or order");
    }
    if (!isRecord(row["input"])) {
      throw new TypeError("not a session view: a measurement row has no input");
    }
  }
  return raw as unknown as SessionView;
}

/** The view, or the `invalid_response` error describing why it is not one. */
export function sessionViewOrError(raw: unknown): { view: SessionView } | { error: ApiErrorShape } {
  try {
    return { view: parseSessionView(raw) };
  } catch (error) {
    return { error: appError("invalid_response", String(error)) };
  }
}
