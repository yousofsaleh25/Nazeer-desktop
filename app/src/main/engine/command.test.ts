import { describe, expect, it } from "vitest";
import { buildEngineCommand, describeCommand, engineAssetsDir } from "./command";

const TOKEN = "ab".repeat(32);
const base = {
  appDir: String.raw`E:\camel_beauty\nazeer-desktop\app`,
  resourcesPath: String.raw`C:\Program Files\Nazeer Desktop\resources`,
  dataRoot: String.raw`E:\camel_beauty\nazeer-desktop\runs\dev_root`,
  token: TOKEN,
  corsOrigins: ["app://nazeer", "http://localhost:5173"],
};

describe("buildEngineCommand", () => {
  it("dev: the engine venv's python -m nazeer_engine in engine\\, with every argument", () => {
    const cmd = buildEngineCommand({ ...base, production: false, env: { PATH: "x" } });
    expect(cmd.command).toBe(
      String.raw`E:\camel_beauty\nazeer-desktop\engine\.venv\Scripts\python.exe`,
    );
    expect(cmd.cwd).toBe(String.raw`E:\camel_beauty\nazeer-desktop\engine`);
    expect(cmd.args).toEqual([
      "-m",
      "nazeer_engine",
      "--data-root",
      base.dataRoot,
      "--port",
      "0",
      `--token=${TOKEN}`,
      "--cors-origin",
      "app://nazeer",
      "--cors-origin",
      "http://localhost:5173",
    ]);
    expect(cmd.env).toMatchObject({ PATH: "x", PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" });
    expect(cmd.stubModel).toBe(false);
  });

  it("dev switches: stub model (with NAZEER_ENGINE_DEV=1), no warm-up, another python", () => {
    const cmd = buildEngineCommand({
      ...base,
      production: false,
      env: {
        NAZEER_STUB_MODEL: "1",
        NAZEER_ENGINE_NO_WARMUP: "1",
        NAZEER_ENGINE_PYTHON: "D:\\py\\python.exe",
      },
    });
    expect(cmd.command).toBe("D:\\py\\python.exe");
    expect(cmd.args).toContain("--stub-model");
    expect(cmd.args).toContain("--no-warmup");
    expect(cmd.env["NAZEER_ENGINE_DEV"]).toBe("1");
    expect(cmd.stubModel).toBe(true);
  });

  it("dev passes the environment through, NAZEER_ENGINE_DEV included", () => {
    const cmd = buildEngineCommand({ ...base, production: false, env: { NAZEER_ENGINE_DEV: "1" } });
    expect(cmd.env["NAZEER_ENGINE_DEV"]).toBe("1");
    expect(cmd.args).not.toContain("--stub-model");
  });

  it("production: the embedded python, isolated, unbuffered, no bytecode writes", () => {
    const cmd = buildEngineCommand({ ...base, production: true, env: { PATH: "x" } });
    expect(cmd.command).toBe(
      String.raw`C:\Program Files\Nazeer Desktop\resources\engine\python\python.exe`,
    );
    expect(cmd.cwd).toBe(String.raw`C:\Program Files\Nazeer Desktop\resources\engine`);
    expect(cmd.args).toEqual([
      "-I",
      "-u",
      "-B",
      "-m",
      "nazeer_engine",
      "--data-root",
      base.dataRoot,
      "--port",
      "0",
      `--token=${TOKEN}`,
      "--cors-origin",
      "app://nazeer",
      "--cors-origin",
      "http://localhost:5173",
    ]);
    expect(cmd.env).toEqual({ PATH: "x" });
  });

  it("production ignores every dev switch and drops what would override the engine's defaults", () => {
    const cmd = buildEngineCommand({
      ...base,
      production: true,
      env: {
        NAZEER_STUB_MODEL: "1",
        NAZEER_ENGINE_DEV: "1",
        NAZEER_ENGINE_NO_WARMUP: "1",
        nazeer_engine_python: "D:\\py\\python.exe",
        PYTHONPATH: "D:\\evil",
        PythonHome: "D:\\py",
        PYTHONUNBUFFERED: "0",
        YOLO_OFFLINE: "0",
        yolo_config_dir: "D:\\y",
        MPLCONFIGDIR: "D:\\mpl",
        OTEL_SDK_DISABLED: "false",
        FASTAPI_OTEL_AUTO_CONFIGURE: "true",
        PATH: "x",
        TEMP: "C:\\t",
        MPLBACKEND: "Agg",
      },
    });
    expect(cmd.command.endsWith(String.raw`\engine\python\python.exe`)).toBe(true);
    expect(cmd.args).not.toContain("--stub-model");
    expect(cmd.args).not.toContain("--no-warmup");
    expect(cmd.stubModel).toBe(false);
    expect(cmd.env).toEqual({ PATH: "x", TEMP: "C:\\t", MPLBACKEND: "Agg" });
  });
});

describe("describeCommand", () => {
  it("masks the token", () => {
    const text = describeCommand(buildEngineCommand({ ...base, production: false, env: {} }));
    expect(text).toContain("--token=***");
    expect(text).not.toContain(TOKEN);
  });
});

describe("the headless export's engine and the print face", () => {
  it("noWarmup skips the model warm-up in production too (once, whatever the env says)", () => {
    for (const production of [false, true]) {
      const cmd = buildEngineCommand({
        ...base,
        production,
        env: { NAZEER_ENGINE_NO_WARMUP: "1" },
        noWarmup: true,
      });
      expect(
        cmd.args.filter((a) => a === "--no-warmup"),
        String(production),
      ).toHaveLength(1);
    }
  });

  it("finds the engine's assets beside the engine it runs", () => {
    expect(engineAssetsDir({ ...base, production: false })).toBe(
      String.raw`E:\camel_beauty\nazeer-desktop\engine\nazeer_engine\assets`,
    );
    expect(engineAssetsDir({ ...base, production: true })).toBe(
      String.raw`C:\Program Files\Nazeer Desktop\resources\engine\nazeer_engine\assets`,
    );
  });
});
