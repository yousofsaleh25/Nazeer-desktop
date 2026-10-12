/**
 * The headless re-export (`--export <session_dir> [--out <file>]`, ADR-D7 decision 6): print a
 * sealed session's report again without the operator window — after a print-page or app update,
 * or to regenerate a file. It runs its own engine on the session's data root (no model warm-up;
 * it fails with engine_already_running while the app serves that data root, and never stops that
 * engine), and prints only what an operator approved before: the session must be finalized or
 * exported, its outputs current, and its last sealed report made from the current overlay version
 * (`outputs.report.overlay_version == outputs.overlay.version`). The overlay bytes then come from
 * the engine, hash-checked against its stamp, and go through the same export as the app's.
 * The result is one JSON object on stdout and in `--out`; exit 0 only when the engine sealed it.
 */
import { createHash } from "node:crypto";
import { readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, win32 } from "node:path";
import { SESSION_ID_RE } from "@shared/ids";
import type { EngineConnection, ExportRequest, ExportResult } from "@shared/ipc";

export interface ExportArgs {
  sessionDir: string;
  out: string | null;
}

/** The prefix of an export's throwaway Chromium profile and log folders in the temp folder. */
export const EXPORT_TEMP_PREFIX = "nazeer-export-";

/**
 * Remove the throwaway folders earlier exports left in `tmp` (a running export holds its own,
 * so they outlive it); only folders older than `maxAgeMs`, so a concurrent export keeps its own.
 * Best effort: a folder still in use stays. Returns the names removed.
 */
export function removeStaleExportFolders(
  tmp: string,
  now: number = Date.now(),
  maxAgeMs = 3_600_000,
): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(tmp).filter((name) => name.startsWith(EXPORT_TEMP_PREFIX));
  } catch {
    return removed;
  }
  for (const name of names) {
    const folder = join(tmp, name);
    try {
      const info = statSync(folder);
      if (!info.isDirectory() || now - info.mtimeMs < maxAgeMs) continue;
      rmSync(folder, { recursive: true, force: true });
      removed.push(name);
    } catch {
      // in use, or gone already: the next export tries again
    }
  }
  return removed;
}

/** `--export <session_dir> [--out <file>]` from argv; null when not an export run. */
export function parseExportArgs(argv: readonly string[]): ExportArgs | { error: string } | null {
  const at = argv.indexOf("--export");
  if (at < 0) return null;
  const sessionDir = argv[at + 1];
  if (sessionDir === undefined || sessionDir.startsWith("--")) {
    return { error: "usage: --export <session folder> [--out <result.json>]" };
  }
  const outAt = argv.indexOf("--out");
  let out: string | null = null;
  if (outAt >= 0) {
    const value = argv[outAt + 1];
    if (value === undefined || value.startsWith("--")) return { error: "--out needs a file name" };
    out = resolve(value);
  }
  return { sessionDir: resolve(sessionDir), out };
}

/** `<root>\sessions\<id>` → the data root and the session id; an error for anything else. */
export function sessionLocation(
  sessionDir: string,
): { dataRoot: string; sessionId: string } | { error: string } {
  const dir = win32.normalize(sessionDir).replace(/[\\/]+$/, "");
  const sessionId = basename(dir);
  if (!SESSION_ID_RE.test(sessionId)) {
    return { error: `${sessionDir}: the folder name is not a session id (YYYYmmdd_HHMMSS_xxxxxx)` };
  }
  const sessions = dirname(dir);
  if (basename(sessions).toLowerCase() !== "sessions") {
    return { error: `${sessionDir}: a session folder lives in <data root>\\sessions\\` };
  }
  return { dataRoot: dirname(sessions), sessionId };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What the export needs from the session, or why a headless export may not print it. */
export function headlessRequest(
  view: unknown,
  overlayBytes: Uint8Array,
): { request: ExportRequest } | { error: { code: string; message: string } } {
  if (!isRecord(view) || !isRecord(view["outputs"])) {
    return { error: { code: "invalid_response", message: "the session view is not readable" } };
  }
  const { outputs } = view;
  const overlay = outputs["overlay"];
  const model = outputs["report_model"];
  const report = outputs["report"];
  if (
    (view["status"] !== "finalized" && view["status"] !== "exported") ||
    view["outputs_stale"] === true ||
    !isRecord(overlay) ||
    !isRecord(model)
  ) {
    return {
      error: {
        code: "status_not_finalized",
        message: "the session is not finalized (or it changed since)",
      },
    };
  }
  if (!isRecord(report) || report["overlay_version"] !== overlay["version"]) {
    return {
      error: {
        code: "export_needs_approval",
        message:
          "no report was sealed from this overlay version: approve the image and print it once " +
          "in the app; a headless export only prints again what was approved",
      },
    };
  }
  const sha = createHash("sha256").update(overlayBytes).digest("hex");
  if (sha !== overlay["sha256"]) {
    return {
      error: {
        code: "overlay_hash_mismatch",
        message: "the overlay bytes do not match the engine's stamp",
      },
    };
  }
  return {
    request: {
      sessionId: String(view["session_id"]),
      overlay: { version: Number(overlay["version"]), sha256: sha, bytes: overlayBytes },
      reportModel: { version: Number(model["version"]), sha256: String(model["sha256"]) },
    },
  };
}

export interface HeadlessDeps {
  /** start the engine on the data root; resolves with its connection or a fatal */
  startEngine(
    dataRoot: string,
  ): Promise<{ connection: EngineConnection } | { fatal: { code: string; message: string } }>;
  stopEngine(): Promise<void>;
  fetch: typeof fetch;
  exportPdf(request: ExportRequest): Promise<ExportResult>;
  /** production: the licence must be active (re-verified) */
  licenseActive(): boolean;
  writeOut(file: string, text: string): Promise<void>;
  stdout(text: string): void;
}

export interface HeadlessResult {
  ok: boolean;
  session_id: string | null;
  verdict: string | null;
  error: { code: string; message: string; details?: Record<string, unknown> } | null;
  report: unknown;
  probe: unknown;
  preflight: unknown;
  timings_ms: Record<string, number>;
}

/** Runs the export and reports it; resolves with the process exit code (0 = sealed). */
export async function runHeadlessExport(
  args: ExportArgs | { error: string },
  deps: HeadlessDeps,
): Promise<number> {
  const result: HeadlessResult = {
    ok: false,
    session_id: null,
    verdict: null,
    error: null,
    report: null,
    probe: null,
    preflight: null,
    timings_ms: {},
  };
  const finish = async (code: number): Promise<number> => {
    const text = `${JSON.stringify(result, null, 2)}\n`;
    deps.stdout(text);
    if (!("error" in args) && args.out !== null) await deps.writeOut(args.out, text);
    return code;
  };
  if ("error" in args) {
    result.error = { code: "usage", message: args.error };
    return finish(2);
  }
  const where = sessionLocation(args.sessionDir);
  if ("error" in where) {
    result.error = { code: "usage", message: where.error };
    return finish(2);
  }
  result.session_id = where.sessionId;
  if (!deps.licenseActive()) {
    result.error = { code: "license_inactive", message: "this computer has no active licence" };
    return finish(3);
  }

  const started = await deps.startEngine(where.dataRoot);
  if ("fatal" in started) {
    const busy = started.fatal.code === "engine_already_running";
    result.error = {
      code: started.fatal.code,
      message: busy
        ? "the app is using this data folder: close Nazeer Desktop, then export again"
        : started.fatal.message,
    };
    return finish(4);
  }
  try {
    const conn = started.connection;
    const get = async (path: string) => {
      const response = await deps.fetch(new URL(path, conn.baseUrl), {
        headers: { "X-Nazeer-Token": conn.token },
        cache: "no-store",
      });
      return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
    };
    const viewCall = await get(`/sessions/${where.sessionId}`);
    const view: unknown = JSON.parse(new TextDecoder().decode(viewCall.bytes));
    if (viewCall.status !== 200) {
      const inner = isRecord(view) && isRecord(view["error"]) ? view["error"] : {};
      result.error = {
        code: typeof inner["code"] === "string" ? inner["code"] : "http_error",
        message:
          typeof inner["message"] === "string" ? inner["message"] : `HTTP ${viewCall.status}`,
      };
      return await finish(1);
    }
    const overlay = isRecord(view) && isRecord(view["outputs"]) ? view["outputs"]["overlay"] : null;
    const overlayBytes =
      isRecord(overlay) && typeof overlay["url"] === "string"
        ? (await get(overlay["url"])).bytes
        : new Uint8Array();
    const planned = headlessRequest(view, overlayBytes);
    if ("error" in planned) {
      result.error = planned.error;
      return await finish(1);
    }
    const exported = await deps.exportPdf(planned.request);
    result.timings_ms = exported.timingsMs;
    result.preflight = exported.preflight;
    result.probe = exported.probe;
    const probe = exported.probe;
    result.verdict =
      isRecord(probe) && typeof probe["verdict"] === "string" ? probe["verdict"] : null;
    if (!exported.ok) {
      result.error = exported.error;
      return await finish(1);
    }
    const session = exported.session;
    result.ok = true;
    result.report =
      isRecord(session) && isRecord(session["outputs"]) ? session["outputs"]["report"] : null;
    return await finish(result.verdict === "PASS" ? 0 : 1);
  } catch (error) {
    result.error = {
      code: "export_failed",
      message: error instanceof Error ? error.message : String(error),
    };
    return await finish(1);
  } finally {
    await deps.stopEngine();
  }
}
