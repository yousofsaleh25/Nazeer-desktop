import { describe, expect, it } from "vitest";
import {
  DEV_USER_DATA_NAME,
  devSwitch,
  isDistBuild,
  isProduction,
  licenseRequired,
} from "./runtime";

describe("runtime", () => {
  it("production = a packaged executable or a bundle built for packaging", () => {
    expect(isProduction(false, false)).toBe(false);
    expect(isProduction(true, false)).toBe(true);
    // an installed app renamed to electron.exe is not "packaged" for Electron, but its bundle
    // was built with NAZEER_DIST=1: still production
    expect(isProduction(false, true)).toBe(true);
  });

  it("tests and plain builds are not dist builds (the define is absent)", () => {
    expect(isDistBuild()).toBe(false);
    expect(isProduction(false)).toBe(false);
  });

  it("production requires a licence and ignores every development switch", () => {
    const env = {
      NAZEER_LICENSE_ENFORCE: "0",
      NAZEER_LICENSE_PUBLIC_KEY: String.raw`C:\attacker\key.pem`,
      NAZEER_USER_DATA_DIR: String.raw`C:\x`,
      ELECTRON_RENDERER_URL: "http://localhost:5173",
    };
    for (const name of Object.keys(env)) expect(devSwitch(true, env, name), name).toBeUndefined();
    expect(licenseRequired(true, env)).toBe(true);
    expect(licenseRequired(true, {})).toBe(true);
  });

  it("development requires a licence only when asked to", () => {
    expect(licenseRequired(false, {})).toBe(false);
    expect(licenseRequired(false, { NAZEER_LICENSE_ENFORCE: "1" })).toBe(true);
    const dir = String.raw`D:\t`;
    expect(devSwitch(false, { NAZEER_USER_DATA_DIR: dir }, "NAZEER_USER_DATA_DIR")).toBe(dir);
  });

  it("development builds keep their own profile folder", () => {
    expect(DEV_USER_DATA_NAME).toBe("Nazeer Desktop (dev)");
  });
});
