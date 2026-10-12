/**
 * How the supervisor starts the engine (pure; unit-tested).
 *
 *   development   <repo>\engine\.venv\Scripts\python.exe -m nazeer_engine …  (cwd engine\)
 *   production    <resources>\engine\python\python.exe -I -u -B -m nazeer_engine …
 *                 (cwd <resources>\engine: the installer's embedded CPython, D11)
 *
 * Production = a packaged app or a bundle built for packaging (runtime.ts, D11). Arguments:
 * --data-root, --port 0, --token=<hex>, one --cors-origin per allowed renderer origin (it replaces
 * the engine's defaults). Development only: NAZEER_STUB_MODEL=1 adds --stub-model with
 * NAZEER_ENGINE_DEV=1; NAZEER_ENGINE_NO_WARMUP=1 adds --no-warmup; NAZEER_ENGINE_PYTHON replaces
 * the venv interpreter. Development passes the environment through. Production runs the
 * interpreter isolated (-I: no PYTHON* variables, no user site-packages, no current folder on
 * the path), unbuffered (-u, which -I would otherwise drop with PYTHONUNBUFFERED) and without
 * writing bytecode into the install folder (-B; the bundle is precompiled), and drops every
 * variable that would override the engine's own offline defaults.
 */
import path from "node:path";

/** Never inherited by a production engine: NAZEER_*, PYTHON*, YOLO_*, OTEL_*, FASTAPI_OTEL_*,
 * MPLCONFIGDIR (Windows variable names are case-insensitive). */
const PRODUCTION_DROPPED_ENV = /^(NAZEER_|PYTHON|YOLO_|OTEL_|FASTAPI_OTEL_|MPLCONFIGDIR$)/i;

export interface EngineCommandInputs {
  production: boolean;
  /** the app folder (app.getAppPath(); dev: …\app) */
  appDir: string;
  /** process.resourcesPath (packaged) */
  resourcesPath: string;
  dataRoot: string;
  token: string;
  corsOrigins: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  /** skip the model warm-up (the headless `--export` run prints; it never segments a frame) */
  noWarmup?: boolean;
}

export interface EngineCommand {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** dev flags in effect, for the log and the status */
  stubModel: boolean;
}

export function buildEngineCommand(inputs: EngineCommandInputs): EngineCommand {
  const { production, appDir, resourcesPath, dataRoot, token, corsOrigins, env } = inputs;
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (production && PRODUCTION_DROPPED_ENV.test(key)) continue;
    childEnv[key] = value;
  }

  const engineArgs = ["--data-root", dataRoot, "--port", "0", `--token=${token}`];
  for (const origin of corsOrigins) engineArgs.push("--cors-origin", origin);
  if (inputs.noWarmup === true || (!production && env["NAZEER_ENGINE_NO_WARMUP"] === "1")) {
    engineArgs.push("--no-warmup");
  }

  if (production) {
    const engineDir = path.win32.join(resourcesPath, "engine");
    return {
      command: path.win32.join(engineDir, "python", "python.exe"),
      args: ["-I", "-u", "-B", "-m", "nazeer_engine", ...engineArgs],
      cwd: engineDir,
      env: childEnv,
      stubModel: false,
    };
  }

  // stdout carries the one-line JSON contract; keep Python's output unbuffered and UTF-8
  childEnv["PYTHONUNBUFFERED"] = "1";
  childEnv["PYTHONIOENCODING"] = "utf-8";
  let stubModel = false;
  if (env["NAZEER_STUB_MODEL"] === "1") {
    stubModel = true;
    engineArgs.push("--stub-model");
    childEnv["NAZEER_ENGINE_DEV"] = "1";
  }

  const engineDir = path.win32.join(path.win32.resolve(appDir, ".."), "engine");
  const python =
    env["NAZEER_ENGINE_PYTHON"] ?? path.win32.join(engineDir, ".venv", "Scripts", "python.exe");
  return {
    command: python,
    args: ["-m", "nazeer_engine", ...engineArgs],
    cwd: engineDir,
    env: childEnv,
    stubModel,
  };
}

/** The engine's asset folder (the pinned Plex TTF the print page embeds, the logo): beside the
 * engine package the supervisor runs, so the print uses the face the overlay was drawn with. */
export function engineAssetsDir(
  inputs: Pick<EngineCommandInputs, "production" | "appDir" | "resourcesPath">,
): string {
  const engineDir = inputs.production
    ? path.win32.join(inputs.resourcesPath, "engine")
    : path.win32.join(path.win32.resolve(inputs.appDir, ".."), "engine");
  return path.win32.join(engineDir, "nazeer_engine", "assets");
}

/** The command line for the log, with the token masked. */
export function describeCommand(cmd: EngineCommand): string {
  const args = cmd.args.map((a) => (a.startsWith("--token=") ? "--token=***" : a));
  return [cmd.command, ...args].join(" ");
}
