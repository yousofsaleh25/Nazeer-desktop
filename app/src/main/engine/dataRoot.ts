/**
 * Which data root the engine gets (C3.1) and the engine's own rules, checked before spawning so a
 * bad root is a clear fatal screen rather than an engine exit 2. Pure; unit-tested.
 *
 *   production   app.getPath("userData")   (packaged, or built for packaging: runtime.ts, D11)
 *   development  --data-root <dir> | NAZEER_DATA_ROOT | <repo>\runs\dev_root
 *
 * Mirrors engine `settings.validate_data_root` (absolute; no Desktop / Documents / OneDrive path
 * segment; not under %OneDrive% / %OneDriveConsumer% / %OneDriveCommercial%). Writability is left
 * to the engine (it creates the folder and reports `data_root_invalid`).
 */
import path from "node:path";

export const FORBIDDEN_SEGMENTS = ["desktop", "documents", "onedrive"] as const;
export const ONEDRIVE_ENV_VARS = ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] as const;

export interface DataRootChoice {
  path: string;
  source: "userData" | "argument" | "env" | "default";
}

export interface DataRootInputs {
  production: boolean;
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  userData: string;
  /** the repository root (dev only: the parent of app/) */
  repoDir: string;
}

function argumentValue(argv: readonly string[], name: string): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === name) return argv[i + 1] ?? null;
    if (arg?.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return null;
}

export function chooseDataRoot({
  production,
  argv,
  env,
  userData,
  repoDir,
}: DataRootInputs): DataRootChoice {
  if (production) return { path: userData, source: "userData" };
  const fromArg = argumentValue(argv, "--data-root");
  if (fromArg) return { path: fromArg, source: "argument" };
  const fromEnv = env["NAZEER_DATA_ROOT"];
  if (fromEnv) return { path: fromEnv, source: "env" };
  return { path: path.win32.join(repoDir, "runs", "dev_root"), source: "default" };
}

export interface DataRootProblem {
  code: "data_root_invalid";
  message: string;
  details: Record<string, unknown>;
}

function isAbsolute(p: string): boolean {
  return path.win32.isAbsolute(p) && /^([A-Za-z]:[\\/]|\\\\)/.test(p);
}

function under(child: string, parent: string): boolean {
  const relative = path.win32.relative(parent.toLowerCase(), child.toLowerCase());
  return relative === "" || (!relative.startsWith("..") && !path.win32.isAbsolute(relative));
}

/** null when the engine would accept the root; otherwise the engine's code with the reason. */
export function checkDataRoot(
  raw: string,
  env: Readonly<Record<string, string | undefined>>,
): DataRootProblem | null {
  if (!isAbsolute(raw)) {
    return {
      code: "data_root_invalid",
      message: `data root must be absolute: ${raw}`,
      details: { path: raw },
    };
  }
  const resolved = path.win32.resolve(raw);
  const segments = resolved.split(/[\\/]+/).filter((s) => s.length > 0);
  const bad = segments.find((s) =>
    (FORBIDDEN_SEGMENTS as readonly string[]).includes(s.toLowerCase()),
  );
  if (bad !== undefined) {
    return {
      code: "data_root_invalid",
      message: `data root under a forbidden folder (${bad}): ${resolved}`,
      details: { path: resolved, segment: bad },
    };
  }
  for (const name of ONEDRIVE_ENV_VARS) {
    const value = env[name];
    if (value && isAbsolute(value) && under(resolved, path.win32.resolve(value))) {
      return {
        code: "data_root_invalid",
        message: `data root lies under %${name}%: ${resolved}`,
        details: { path: resolved, env: name },
      };
    }
  }
  return null;
}

/** Two spellings of one Windows folder (case, separators, trailing slash). */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    path.win32
      .resolve(p)
      .replace(/[\\/]+$/, "")
      .toLowerCase();
  return norm(a) === norm(b);
}
