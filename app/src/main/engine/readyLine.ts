/**
 * The sidecar's stdout contract (engine `__main__.py`): exactly one ASCII JSON line,
 * `{"event": "ready", port, pid, …}` once the app is serving, or `{"event": "fatal", code,
 * message, details}` before it exits. Anything else on stdout is noise the supervisor logs.
 * Pure; unit-tested.
 */

export interface ReadyEvent {
  kind: "ready";
  port: number;
  pid: number;
  engineVersion: string;
  dataRoot: string;
  modelFile: string | null;
  modelSha256: string | null;
  stubModel: boolean;
  warmupMs: number | null;
  tokenRequired: boolean;
  arabicStackOk: boolean;
}

export interface FatalEvent {
  kind: "fatal";
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface OtherLine {
  kind: "other";
  line: string;
  /** why a JSON event was not accepted (missing field, wrong type); absent for plain text */
  problem?: string;
}

export type StdoutLine = ReadyEvent | FatalEvent | OtherLine;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseStdoutLine(raw: string): StdoutLine {
  const line = raw.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: "other", line };
  }
  if (!isRecord(parsed)) return { kind: "other", line };
  const event = parsed["event"];
  if (event === "fatal") {
    const code = parsed["code"];
    if (typeof code !== "string" || code.length === 0) {
      return { kind: "other", line, problem: "fatal event without a code" };
    }
    const message = parsed["message"];
    const details = parsed["details"];
    return {
      kind: "fatal",
      code,
      message: typeof message === "string" ? message : "",
      details: isRecord(details) ? details : {},
    };
  }
  if (event !== "ready") return { kind: "other", line };

  const port = parsed["port"];
  const pid = parsed["pid"];
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { kind: "other", line, problem: "ready event without a valid port" };
  }
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 1) {
    return { kind: "other", line, problem: "ready event without a valid pid" };
  }
  const engineVersion = parsed["engine_version"];
  const dataRoot = parsed["data_root"];
  if (typeof engineVersion !== "string" || typeof dataRoot !== "string") {
    return { kind: "other", line, problem: "ready event without engine_version / data_root" };
  }
  const flags = ["stub_model", "token_required", "arabic_stack_ok"] as const;
  for (const flag of flags) {
    if (typeof parsed[flag] !== "boolean") {
      return { kind: "other", line, problem: `ready event without a boolean ${flag}` };
    }
  }
  const warmup = parsed["warmup_ms"];
  return {
    kind: "ready",
    port,
    pid,
    engineVersion,
    dataRoot,
    modelFile: optionalString(parsed["model_file"]),
    modelSha256: optionalString(parsed["model_sha256"]),
    stubModel: parsed["stub_model"] === true,
    warmupMs: typeof warmup === "number" && Number.isFinite(warmup) ? warmup : null,
    tokenRequired: parsed["token_required"] === true,
    arabicStackOk: parsed["arabic_stack_ok"] === true,
  };
}
