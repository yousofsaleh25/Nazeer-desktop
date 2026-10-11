/**
 * One error shape for everything the renderer shows: the engine's error envelope
 * (`{"error": {code, message, details}}` on every 4xx/5xx, and a failed job's `error`), a network
 * failure, or a check the app makes itself (the overlay hash). Plain objects, so they can sit in
 * Redux state. ErrorPanel labels `code` (i18n `errors.*` for engine codes, `appErrors.*` for the
 * app's own) and always shows the engine's message and details too.
 */
import type { ErrorDetail } from "./types";

export interface ApiErrorShape {
  /** HTTP status; null for network failures and the app's own checks */
  status: number | null;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/** Codes the app raises itself (never sent by the engine; labelled in i18n `appErrors`). */
export type AppErrorCode = "network_error" | "invalid_response" | "overlay_hash_mismatch";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The engine's envelope; a body that is not one becomes the engine's generic `http_error`. */
export function errorFromResponse(status: number, body: unknown): ApiErrorShape {
  const inner = isRecord(body) && isRecord(body["error"]) ? body["error"] : null;
  const code = inner?.["code"];
  if (inner !== null && typeof code === "string" && code.length > 0) {
    const message = inner["message"];
    const details = inner["details"];
    return {
      status,
      code,
      message: typeof message === "string" ? message : "",
      details: isRecord(details) ? details : {},
    };
  }
  return {
    status,
    code: "http_error",
    message: `HTTP ${status}`,
    details: body === undefined || body === null ? {} : { body },
  };
}

/** A failed job's `error` (the envelope's inner object). */
export function errorFromDetail(detail: ErrorDetail): ApiErrorShape {
  return {
    status: null,
    code: detail.code,
    message: detail.message,
    details: isRecord(detail.details) ? detail.details : {},
  };
}

export function networkError(error: unknown): ApiErrorShape {
  return {
    status: null,
    code: "network_error",
    message: error instanceof Error ? error.message : String(error),
    details: {},
  };
}

export function appError(
  code: AppErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): ApiErrorShape {
  return { status: null, code, message, details };
}
