/**
 * Validators for every payload main receives over IPC (pure; unit-tested). A payload that fails
 * is refused with an Error; nothing is coerced.
 */
import { MAX_SAFE_INT, SESSION_ID_RE, SHA256_HEX_RE } from "./ids";
import {
  MAX_COMPARISON_APPROVALS,
  MAX_OVERLAY_BYTES,
  type ComparisonExportRequest,
  type ExportRequest,
  type OpenSavedRequest,
  type PreflightProblem,
  type PrintPreflight,
  type QuitAck,
  type ReportKind,
  type SaveAsRequest,
  type SavedCopyQuery,
} from "./ipc";

export const MAX_CAPTURE_FOLDERS = 20;
export const MAX_PATH_CHARS = 1024;

/** An absolute Windows path (`C:\…` or `\\server\share…`), no NUL, bounded length. A leading
 * `\` or `/` alone is relative to the current drive on Windows, so it is refused. */
export function isAbsolutePathString(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_CHARS) {
    return false;
  }
  if (value.includes("\0")) return false;
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\/]+\\[^\\/]+/.test(value);
}

/** Capture folders: an array of at most 20 absolute paths; duplicates (case-insensitive) dropped. */
export function validateCaptureFolders(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("capture folders must be an array");
  if (value.length > MAX_CAPTURE_FOLDERS) {
    throw new Error(`at most ${MAX_CAPTURE_FOLDERS} capture folders`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (!isAbsolutePathString(item)) {
      throw new Error("each capture folder must be an absolute path");
    }
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/** A pasted licence key: a string of at most 4096 characters (main normalises and verifies). */
export const MAX_LICENSE_INPUT_CHARS = 4096;

export function validateLicenseKeyInput(value: unknown): string {
  if (typeof value !== "string") throw new Error("the licence key must be a string");
  if (value.length > MAX_LICENSE_INPUT_CHARS) {
    throw new Error(`the licence key is longer than ${MAX_LICENSE_INPUT_CHARS} characters`);
  }
  return value;
}

export function validateQuitAck(value: unknown): QuitAck {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("quit ack must be an object");
  }
  const record = value as Record<string, unknown>;
  const { requestId, unsaved } = record;
  if (Object.keys(record).some((key) => key !== "requestId" && key !== "unsaved")) {
    throw new Error("quit ack has unknown fields");
  }
  if (typeof requestId !== "number" || !Number.isSafeInteger(requestId) || requestId < 1) {
    throw new Error("quit ack requestId must be a positive integer");
  }
  if (typeof unsaved !== "boolean") throw new Error("quit ack unsaved must be a boolean");
  return { requestId, unsaved };
}

function plainObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object`);
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new Error(`${what} must be a plain object`);
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], what: string): void {
  const extra = Object.keys(record).filter((key) => !keys.includes(key));
  if (extra.length > 0) throw new Error(`${what} has unknown fields: ${extra.join(", ")}`);
}

function version(value: unknown, what: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_SAFE_INT
  ) {
    throw new Error(`${what} must be a positive integer`);
  }
  return value;
}

function sha256(value: unknown, what: string): string {
  if (typeof value !== "string" || !SHA256_HEX_RE.test(value)) {
    throw new Error(`${what} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

/** print.exportPdf: a session id, the approved overlay (≤ 32 MiB) and the report model it names. */
export function validateExportRequest(value: unknown): ExportRequest {
  const record = plainObject(value, "export request");
  exactKeys(record, ["sessionId", "overlay", "reportModel"], "export request");
  const { sessionId } = record;
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    throw new Error("export request sessionId is not a session id");
  }
  const overlay = plainObject(record["overlay"], "export request overlay");
  exactKeys(overlay, ["version", "sha256", "bytes"], "export request overlay");
  const bytes = overlay["bytes"];
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error("export request overlay bytes must be a non-empty Uint8Array");
  }
  if (bytes.byteLength > MAX_OVERLAY_BYTES) {
    throw new Error(`export request overlay is larger than ${MAX_OVERLAY_BYTES} bytes`);
  }
  const model = plainObject(record["reportModel"], "export request reportModel");
  exactKeys(model, ["version", "sha256"], "export request reportModel");
  return {
    sessionId,
    overlay: {
      version: version(overlay["version"], "overlay version"),
      sha256: sha256(overlay["sha256"], "overlay sha256"),
      bytes,
    },
    reportModel: {
      version: version(model["version"], "report model version"),
      sha256: sha256(model["sha256"], "report model sha256"),
    },
  };
}

/**
 * print.exportComparison (D12): a comparison id, the model version / SHA-256 the screen shows, and
 * the approvals given in the app (each session at most once). No bytes: main fetches the overlays.
 */
export function validateComparisonExportRequest(value: unknown): ComparisonExportRequest {
  const record = plainObject(value, "comparison export request");
  exactKeys(record, ["comparisonId", "model", "approvals"], "comparison export request");
  const { comparisonId } = record;
  if (typeof comparisonId !== "string" || !SESSION_ID_RE.test(comparisonId)) {
    throw new Error("comparison export request comparisonId is not a comparison id");
  }
  const model = plainObject(record["model"], "comparison export request model");
  exactKeys(model, ["version", "sha256"], "comparison export request model");
  const approvals = record["approvals"];
  if (!Array.isArray(approvals) || approvals.length > MAX_COMPARISON_APPROVALS) {
    throw new Error(
      `comparison export approvals must be an array of at most ${MAX_COMPARISON_APPROVALS}`,
    );
  }
  const seen = new Set<string>();
  return {
    comparisonId,
    model: {
      version: version(model["version"], "comparison model version"),
      sha256: sha256(model["sha256"], "comparison model sha256"),
    },
    approvals: approvals.map((item) => {
      const approval = plainObject(item, "comparison export approval");
      exactKeys(approval, ["sessionId", "overlayVersion", "sha256"], "comparison export approval");
      const { sessionId } = approval;
      if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
        throw new Error("comparison export approval sessionId is not a session id");
      }
      if (seen.has(sessionId)) throw new Error("comparison export approvals name a session twice");
      seen.add(sessionId);
      return {
        sessionId,
        overlayVersion: version(approval["overlayVersion"], "approval overlay version"),
        sha256: sha256(approval["sha256"], "approval sha256"),
      };
    }),
  };
}

/** The longest file name the renderer may suggest for a saved copy (main sanitises it again). */
export const MAX_SUGGESTED_NAME_CHARS = 200;

function reportRef(record: Record<string, unknown>, what: string): SavedCopyQuery {
  const { kind, id } = record;
  if (kind !== "session" && kind !== "comparison") {
    throw new Error(`${what} kind must be "session" or "comparison"`);
  }
  // a comparison id has the session id's form (the engine's new_session_id)
  if (typeof id !== "string" || !SESSION_ID_RE.test(id)) {
    throw new Error(`${what} id is not a ${kind} id`);
  }
  return {
    kind: kind satisfies ReportKind,
    id,
    version: version(record["version"], `${what} version`),
  };
}

/** report.saveAs: which sealed report, and a file name (never a path, never bytes; D12). */
export function validateSaveAsRequest(value: unknown): SaveAsRequest {
  const record = plainObject(value, "save-as request");
  exactKeys(record, ["kind", "id", "version", "suggestedName"], "save-as request");
  const name = record["suggestedName"];
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > MAX_SUGGESTED_NAME_CHARS ||
    name.includes("\0")
  ) {
    throw new Error(
      `save-as suggestedName must be a string of 1 to ${MAX_SUGGESTED_NAME_CHARS} characters`,
    );
  }
  return { ...reportRef(record, "save-as request"), suggestedName: name };
}

/** report.savedCopy: which report version's recorded copy. */
export function validateSavedCopyQuery(value: unknown): SavedCopyQuery {
  const record = plainObject(value, "saved-copy query");
  exactKeys(record, ["kind", "id", "version"], "saved-copy query");
  return reportRef(record, "saved-copy query");
}

/** report.openSaved: open the recorded copy, or show it in its folder. */
export function validateOpenSavedRequest(value: unknown): OpenSavedRequest {
  const record = plainObject(value, "open-saved request");
  exactKeys(record, ["kind", "id", "version", "action"], "open-saved request");
  const action = record["action"];
  if (action !== "open" && action !== "show") {
    throw new Error('open-saved action must be "open" or "show"');
  }
  return { ...reportRef(record, "open-saved request"), action };
}

export const MAX_PREFLIGHT_PROBLEMS = 200;
const MAX_PROBLEM_JSON_CHARS = 64 * 1024;

function problems(value: unknown, what: string): PreflightProblem[] {
  if (!Array.isArray(value)) throw new Error(`${what} must be an array`);
  if (value.length > MAX_PREFLIGHT_PROBLEMS) {
    throw new Error(`${what}: at most ${MAX_PREFLIGHT_PROBLEMS}`);
  }
  return value.map((item) => {
    const problem = plainObject(item, `${what} item`);
    exactKeys(problem, ["code", "message", "details"], `${what} item`);
    const { code, message } = problem;
    if (typeof code !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(code)) {
      throw new Error(`${what} item code must be a snake_case code`);
    }
    if (typeof message !== "string" || message.length > 4000) {
      throw new Error(`${what} item message must be a string of at most 4000 characters`);
    }
    const details = plainObject(problem["details"], `${what} item details`);
    if (JSON.stringify(details).length > MAX_PROBLEM_JSON_CHARS) {
      throw new Error(`${what} item details are too large`);
    }
    return { code, message, details };
  });
}

function count(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${what} must be a non-negative integer`);
  }
  return value;
}

/** The print page's pre-flight result (window.nazeerPrint.ready). */
export function validatePreflight(value: unknown): PrintPreflight {
  const record = plainObject(value, "preflight");
  exactKeys(record, ["ok", "problems", "warnings", "checked"], "preflight");
  if (typeof record["ok"] !== "boolean") throw new Error("preflight ok must be a boolean");
  const checked = plainObject(record["checked"], "preflight checked");
  exactKeys(checked, ["requiredTexts", "textNodes", "characters", "images"], "preflight checked");
  const result: PrintPreflight = {
    ok: record["ok"],
    problems: problems(record["problems"], "preflight problems"),
    warnings: problems(record["warnings"], "preflight warnings"),
    checked: {
      requiredTexts: count(checked["requiredTexts"], "checked requiredTexts"),
      textNodes: count(checked["textNodes"], "checked textNodes"),
      characters: count(checked["characters"], "checked characters"),
      images: count(checked["images"], "checked images"),
    },
  };
  if (result.ok && result.problems.length > 0) throw new Error("preflight ok with problems");
  return result;
}

/**
 * The print page's result as main takes it: the validated result, or — when main refuses it (too
 * many problems, details too large, a malformed object) — a failed result that says why, so the
 * print stops at once with a coded reason instead of waiting for the print timeout.
 */
export function preflightOrRefusal(value: unknown): PrintPreflight {
  try {
    return validatePreflight(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      problems: [
        {
          code: "print_page_failed",
          message: `the print page's result was refused: ${reason}`.slice(0, 4000),
          details: {},
        },
      ],
      warnings: [],
      checked: { requiredTexts: 0, textNodes: 0, characters: 0, images: 0 },
    };
  }
}
