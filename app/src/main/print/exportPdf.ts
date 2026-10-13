/**
 * Print and seal one report: main's half of ADR-D7 / C3.7 (pure orchestration; the window, the
 * files and the engine are injected, so every refusal is unit-tested).
 *
 *  1. the session, fresh from the engine: finalized or exported, outputs not stale, and the
 *     overlay and report model the renderer names are the session's current ones;
 *  2. the approved bytes the renderer sends hash to the approved SHA-256 (main re-hashes);
 *  3. the report model bytes hash to the engine's stamp and are the version the page lays out;
 *  4. the face is the engine's pinned Plex TTF (the face the overlay was drawn with, and the one
 *     the page's cmap was built from); the logo when there is one;
 *  5. the hidden print window lays the page out, runs its checks and prints (printWindow.ts);
 *  6. the PDF goes to `POST /sessions/{id}/report` with the overlay and report model hashes and
 *     the app versions; the engine probes, attaches the evidence and seals it — or refuses it.
 *
 * Expected failures resolve with `ok: false` and a code the renderer labels; nothing throws.
 */
import { createHash } from "node:crypto";
import {
  PRINT_REPORT_MODEL_VERSION,
  type EngineConnection,
  type ExportError,
  type ExportRequest,
  type ExportResult,
  type PrintJob,
  type PrintPreflight,
} from "@shared/ipc";
import cmap from "../../print/plex-cmap.json";

export const ENGINE_CALL_TIMEOUT_MS = 30_000;
export const UPLOAD_TIMEOUT_MS = 180_000;
export const PRINT_TIMEOUT_MS = 90_000;

/** What the print window returns: the page's checks, and the PDF when they passed. */
export interface PrintOutcome {
  preflight: PrintPreflight;
  pdf: Uint8Array | null;
}

export interface ExportDeps {
  connection(): EngineConnection | null;
  fetch: typeof fetch;
  /** the engine's asset files (null when absent) */
  readAsset(name: "font" | "logo"): Promise<Uint8Array | null>;
  /** lay the page out in a hidden window, check it and print it */
  print(job: PrintJob, timeoutMs: number): Promise<PrintOutcome>;
  appInfo: { appVersion: string; electron: string; chromium: string };
  now?: () => number;
  log?: (line: string) => void;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function appError(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ExportError {
  return { status: null, code, message, details };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The engine's error envelope as an ExportError (`http_error` when the body is not one). */
export function engineError(status: number, body: unknown): ExportError {
  const inner = isRecord(body) && isRecord(body["error"]) ? body["error"] : null;
  if (inner !== null && typeof inner["code"] === "string" && inner["code"] !== "") {
    return {
      status,
      code: inner["code"],
      message: typeof inner["message"] === "string" ? inner["message"] : "",
      details: isRecord(inner["details"]) ? inner["details"] : {},
    };
  }
  return { status, code: "http_error", message: `HTTP ${status}`, details: {} };
}

type Fetched = { ok: true; status: number; bytes: Uint8Array } | { ok: false; error: ExportError };

/**
 * An engine path (or a URL an engine answer named) on the engine's own origin; null for anything
 * that resolves elsewhere, so the token never leaves the engine (as the renderer's engineUrl).
 */
export function engineCallUrl(path: string, conn: Pick<EngineConnection, "baseUrl">): URL | null {
  try {
    const url = new URL(path, conn.baseUrl);
    return url.origin === new URL(conn.baseUrl).origin ? url : null;
  } catch {
    return null;
  }
}

async function call(
  deps: ExportDeps,
  conn: EngineConnection,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Fetched> {
  const { timeoutMs = ENGINE_CALL_TIMEOUT_MS, headers, ...rest } = init;
  // the token goes to the engine only: a URL in an answer that names another origin is refused
  const url = engineCallUrl(path, conn);
  if (url === null) {
    return {
      ok: false,
      error: appError("invalid_response", `a URL outside the engine was named: ${path}`),
    };
  }
  let response: Response;
  try {
    response = await deps.fetch(url, {
      ...rest,
      headers: { ...(headers as Record<string, string> | undefined), "X-Nazeer-Token": conn.token },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    return {
      ok: false,
      error: appError("network_error", error instanceof Error ? error.message : String(error)),
    };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    // the engine answered (its status is known) but the body was cut off, e.g. by the timeout:
    // what it did is unknown, so the status stays and the app reads the session again
    return {
      ok: false,
      error: {
        status: response.status,
        code: "network_error",
        message: `the engine's answer was cut off: ${
          error instanceof Error ? error.message : String(error)
        }`,
        details: {},
      },
    };
  }
  if (response.ok) return { ok: true, status: response.status, bytes };
  return { ok: false, error: engineError(response.status, json(bytes) ?? null) };
}

/** An engine asset's bytes; null when it does not exist; an error when it cannot be read. */
async function readAsset(
  deps: ExportDeps,
  name: "font" | "logo",
): Promise<Uint8Array | null | { error: string }> {
  try {
    return await deps.readAsset(name);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

interface SessionFacts {
  overlay: { version: number; sha256: string; width: number | null; height: number | null };
  reportModel: { version: number; sha256: string; url: string };
  requiredTexts: string[];
}

/** The session view's facts the export needs, or why it cannot be printed now. */
export function checkSession(
  view: unknown,
  request: ExportRequest,
): { facts: SessionFacts } | { error: ExportError } {
  if (!isRecord(view) || !isRecord(view["outputs"])) {
    return { error: appError("invalid_response", "the engine's session view is not readable") };
  }
  const status = view["status"];
  const stale = view["outputs_stale"] === true;
  const outputs = view["outputs"];
  const overlay = outputs["overlay"];
  const model = outputs["report_model"];
  if ((status !== "finalized" && status !== "exported") || stale) {
    return {
      error: appError("status_not_finalized", "finalize the session before printing", {
        status,
        outputs_stale: stale,
      }),
    };
  }
  if (!isRecord(overlay) || !isRecord(model)) {
    return {
      error: appError("status_not_finalized", "the session has no overlay or report model"),
    };
  }
  if (
    overlay["version"] !== request.overlay.version ||
    overlay["sha256"] !== request.overlay.sha256
  ) {
    return {
      error: appError(
        "approval_outdated",
        "the approved image is not the session's current image",
        {
          approved: { version: request.overlay.version, sha256: request.overlay.sha256 },
          current: { version: overlay["version"], sha256: overlay["sha256"] },
        },
      ),
    };
  }
  if (
    model["version"] !== request.reportModel.version ||
    model["sha256"] !== request.reportModel.sha256 ||
    typeof model["url"] !== "string"
  ) {
    return {
      error: appError("report_model_mismatch", "the report details changed: print again", {
        requested: request.reportModel,
        current: { version: model["version"], sha256: model["sha256"] },
      }),
    };
  }
  const texts = view["required_report_texts"];
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== "string")) {
    return {
      error: appError("invalid_response", "required_report_texts is not a list of strings"),
    };
  }
  const size = (value: unknown) => (typeof value === "number" ? value : null);
  return {
    facts: {
      overlay: {
        version: request.overlay.version,
        sha256: request.overlay.sha256,
        width: size(overlay["width"]),
        height: size(overlay["height"]),
      },
      reportModel: { ...request.reportModel, url: model["url"] },
      requiredTexts: texts as string[],
    },
  };
}

/** The pinned face the page's cmap was built from (src/print/plex-cmap.json). */
export const PRINT_FONT_SHA256: string = cmap.sha256;

/** One export at a time: a second request while one runs is refused (`export_busy`). */
export function oneAtATime(
  run: (request: ExportRequest) => Promise<ExportResult>,
): (request: ExportRequest) => Promise<ExportResult> {
  let busy = false;
  return async (request) => {
    if (busy) {
      return {
        ok: false,
        error: appError("export_busy", "another report is being printed"),
        probe: null,
        preflight: null,
        timingsMs: {},
      };
    }
    busy = true;
    try {
      return await run(request);
    } finally {
      busy = false;
    }
  };
}

export async function exportPdf(request: ExportRequest, deps: ExportDeps): Promise<ExportResult> {
  const now = deps.now ?? (() => performance.now());
  const timingsMs: Record<string, number> = {};
  let last = now();
  const lap = (step: string) => {
    const t = now();
    timingsMs[step] = Math.round(t - last);
    last = t;
  };
  const fail = (
    error: ExportError,
    extra: { probe?: unknown; preflight?: PrintPreflight | null } = {},
  ): ExportResult => {
    deps.log?.(`export ${request.sessionId}: ${error.code} ${error.message}`);
    return {
      ok: false,
      error,
      probe: extra.probe ?? null,
      preflight: extra.preflight ?? null,
      timingsMs,
    };
  };

  const conn = deps.connection();
  if (conn === null) return fail(appError("engine_not_ready", "the engine is not connected"));
  const id = encodeURIComponent(request.sessionId);

  // 1. the session as the engine has it now
  const viewCall = await call(deps, conn, `/sessions/${id}`);
  if (!viewCall.ok) return fail(viewCall.error);
  const checked = checkSession(json(viewCall.bytes), request);
  if ("error" in checked) return fail(checked.error);
  const { facts } = checked;

  // 2. the approved bytes
  const overlaySha = sha256Hex(request.overlay.bytes);
  if (overlaySha !== request.overlay.sha256) {
    return fail(
      appError("overlay_bytes_mismatch", "the bytes sent for printing are not the approved image", {
        approved: request.overlay.sha256,
        computed: overlaySha,
      }),
    );
  }

  // 3. the report model the page lays out
  const modelCall = await call(deps, conn, facts.reportModel.url);
  if (!modelCall.ok) return fail(modelCall.error);
  const modelSha = sha256Hex(modelCall.bytes);
  if (modelSha !== facts.reportModel.sha256) {
    return fail(
      appError(
        "report_model_hash_mismatch",
        "the report model bytes do not match the engine's stamp",
        {
          engine: facts.reportModel.sha256,
          computed: modelSha,
        },
      ),
    );
  }
  const model = json(modelCall.bytes);
  const schema = isRecord(model) ? model["report_model_version"] : undefined;
  if (schema !== PRINT_REPORT_MODEL_VERSION) {
    return fail(
      appError(
        "report_model_outdated",
        `the session's report model is version ${String(schema)}; this app prints version ` +
          `${PRINT_REPORT_MODEL_VERSION}: reopen the session and finalize it again`,
        { version: schema ?? null, expected: PRINT_REPORT_MODEL_VERSION },
      ),
    );
  }
  lap("fetch");

  // 4. the face (the engine's pinned TTF) and the logo
  const font = await readAsset(deps, "font");
  if (font === null) {
    return fail(
      appError("print_font_missing", "the engine's IBM Plex Sans Arabic file is missing"),
    );
  }
  if ("error" in font) {
    return fail(
      appError(
        "print_font_unreadable",
        `the engine's IBM Plex Sans Arabic file cannot be read: ${font.error}`,
      ),
    );
  }
  const fontSha = sha256Hex(font);
  if (fontSha !== PRINT_FONT_SHA256) {
    return fail(
      appError(
        "print_font_mismatch",
        "the engine's face is not the one the print page was built for",
        {
          expected: PRINT_FONT_SHA256,
          found: fontSha,
        },
      ),
    );
  }
  // the logo is decoration: an unreadable one is logged and the page prints without it
  const logoRead = await readAsset(deps, "logo");
  const logo = logoRead !== null && "error" in logoRead ? null : logoRead;
  if (logoRead !== null && "error" in logoRead) {
    deps.log?.(`export ${request.sessionId}: the logo cannot be read (${logoRead.error})`);
  }

  // 5. lay out, check, print
  const job: PrintJob = {
    model,
    reportModel: { version: facts.reportModel.version, sha256: facts.reportModel.sha256 },
    overlay: {
      version: facts.overlay.version,
      sha256: facts.overlay.sha256,
      bytes: new Uint8Array(request.overlay.bytes),
    },
    font: { sha256: fontSha, bytes: new Uint8Array(font) },
    logo: logo === null ? null : new Uint8Array(logo),
    requiredTexts: facts.requiredTexts,
  };
  let printed: PrintOutcome;
  try {
    printed = await deps.print(job, PRINT_TIMEOUT_MS);
  } catch (error) {
    const err = error as { code?: unknown; message?: unknown };
    return fail(
      appError(
        typeof err.code === "string" ? err.code : "print_failed",
        typeof err.message === "string" ? err.message : String(error),
      ),
    );
  }
  lap("print");
  const { preflight, pdf } = printed;
  if (!preflight.ok || pdf === null) {
    const first = preflight.problems[0];
    return fail(
      appError(first?.code ?? "print_failed", first?.message ?? "the print page was not printed", {
        problems: preflight.problems,
      }),
      { preflight },
    );
  }

  // 6. the engine probes, attaches the evidence and seals it
  const upload = await call(deps, conn, `/sessions/${id}/report`, {
    method: "POST",
    body: pdf,
    timeoutMs: UPLOAD_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/pdf",
      "X-Overlay-Sha256": facts.overlay.sha256,
      "X-Overlay-Version": String(facts.overlay.version),
      "X-Report-Model-Sha256": facts.reportModel.sha256,
      "X-App-Version": deps.appInfo.appVersion,
      "X-Electron": deps.appInfo.electron,
      "X-Chromium": deps.appInfo.chromium,
    },
  });
  lap("seal");
  if (!upload.ok) {
    const probe = upload.error.details["probe"];
    return fail(upload.error, { probe: probe ?? null, preflight });
  }
  const answer = json(upload.bytes);
  if (!isRecord(answer) || !isRecord(answer["session"]) || !isRecord(answer["probe"])) {
    return fail(appError("invalid_response", "the engine's answer to the upload is not readable"), {
      preflight,
    });
  }
  deps.log?.(
    `export ${request.sessionId}: sealed (${pdf.byteLength} bytes printed, ` +
      `${JSON.stringify(timingsMs)})`,
  );
  return {
    ok: true,
    session: answer["session"],
    probe: answer["probe"],
    preflight,
    pdfBytes: pdf.byteLength,
    timingsMs,
  };
}
