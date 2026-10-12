/**
 * Production or development (D11). `app.isPackaged` alone only compares the executable's name
 * with `electron.exe`, so an installed app renamed to `electron.exe` would count as development:
 * licensing off and every development switch honoured. Builds made for packaging therefore
 * define `__NAZEER_DIST__` (`npm run dist` sets NAZEER_DIST=1; electron.vite.config.ts), and
 * production = that flag or a packaged executable. Production requires a licence and ignores
 * every development switch (NAZEER_* variables, --data-root, ELECTRON_RENDERER_URL).
 */

// replaced at build time by electron-vite's `define` (absent in tests and plain dev builds)
declare const __NAZEER_DIST__: boolean | undefined;

/** True in a bundle built for packaging (`npm run dist`). */
export function isDistBuild(): boolean {
  return typeof __NAZEER_DIST__ !== "undefined" && __NAZEER_DIST__ === true;
}

export function isProduction(packaged: boolean, dist: boolean = isDistBuild()): boolean {
  return dist || packaged;
}

type Env = Readonly<Record<string, string | undefined>>;

/** A development switch from the environment; always undefined in production. */
export function devSwitch(production: boolean, env: Env, name: string): string | undefined {
  return production ? undefined : env[name];
}

/** Production always requires a licence; development only with NAZEER_LICENSE_ENFORCE=1. */
export function licenseRequired(production: boolean, env: Env): boolean {
  return production || devSwitch(production, env, "NAZEER_LICENSE_ENFORCE") === "1";
}

/** The profile folder development builds use, so they never touch the packaged app's. */
export const DEV_USER_DATA_NAME = "Nazeer Desktop (dev)";
