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

/**
 * Codes the app raises itself (never sent by the engine; labelled in i18n `appErrors`): the
 * renderer's checks, the supervisor's fatal codes for failures the engine cannot report
 * (spawn failure, start timeout, early exit without a fatal line, crash loop, a bad ready line,
 * no bridge), and the print and export checks of main and the print page (Stage 7).
 */
export type AppErrorCode =
  | "network_error"
  | "invalid_response"
  | "overlay_hash_mismatch"
  | "engine_spawn_failed"
  | "engine_start_timeout"
  | "engine_exited"
  | "engine_restart_limit"
  | "engine_protocol_error"
  | "bridge_missing"
  | "screen_failed"
  | (typeof PRINT_ERROR_CODES)[number];

/** The export's own codes (main/print/exportPdf.ts, printWindow.ts, print/preflight.ts). */
export const PRINT_ERROR_CODES = [
  "approval_required",
  "approval_outdated",
  "export_busy",
  "overlay_bytes_mismatch",
  "report_model_hash_mismatch",
  "report_model_outdated",
  "report_model_unreadable",
  "print_font_missing",
  "print_font_unreadable",
  "print_font_mismatch",
  "print_window_failed",
  "print_timeout",
  "print_failed",
  "print_page_failed",
  "print_font_not_loaded",
  "print_face_mismatch",
  "print_synthesized_face",
  "print_required_text_missing",
  "print_glyph_missing",
  "print_glyph_fallback",
  "print_image_not_decoded",
  "print_overlay_missing",
  "print_overlay_altered",
] as const;

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

/**
 * An RTK Query error as an ApiErrorShape: endpoints return ApiErrorShape; a `queryFn` that threw
 * (an app bug, never the engine) arrives as RTK's SerializedError and is shown as
 * `invalid_response` with its message rather than dropped.
 */
export function toApiError(error: unknown): ApiErrorShape {
  if (
    isRecord(error) &&
    typeof error["code"] === "string" &&
    typeof error["message"] === "string" &&
    isRecord(error["details"]) &&
    (error["status"] === null || typeof error["status"] === "number")
  ) {
    return error as unknown as ApiErrorShape;
  }
  const message = isRecord(error) && typeof error["message"] === "string" ? error["message"] : "";
  return appError("invalid_response", message || String(error));
}

export function appError(
  code: AppErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): ApiErrorShape {
  return { status: null, code, message, details };
}
