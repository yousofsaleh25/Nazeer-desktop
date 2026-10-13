import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineStatusEvent } from "@shared/ipc";
import ar from "../../renderer/i18n/ar.json";
import en from "../../renderer/i18n/en.json";
import type { EngineCommand } from "./command";
import type { EngineProcess } from "./process";
import { EngineSupervisor, type SupervisorConfig, type SupervisorDeps } from "./supervisor";

const ROOT = String.raw`E:\camel_beauty\nazeer-desktop\runs\dev_root`;

class FakeProcess implements EngineProcess {
  readonly pid: number;
  kills = 0;
  exited = false;
  private readonly out: ((line: string) => void)[] = [];
  private readonly err: ((line: string) => void)[] = [];
  private readonly exits: ((code: number | null, signal: string | null) => void)[] = [];
  private readonly spawnErrors: ((error: Error) => void)[] = [];

  constructor(
    readonly cmd: EngineCommand,
    pid: number,
    /** exit with this code when killed (null: ignore kills) */
    private readonly onKill: number | null = 1,
  ) {
    this.pid = pid;
  }

  get token(): string {
    return this.cmd.args.find((a) => a.startsWith("--token="))!.slice("--token=".length);
  }

  onStdoutLine(listener: (line: string) => void): void {
    this.out.push(listener);
  }
  onStderrLine(listener: (line: string) => void): void {
    this.err.push(listener);
  }
  onExit(listener: (code: number | null, signal: string | null) => void): void {
    this.exits.push(listener);
  }
  onSpawnError(listener: (error: Error) => void): void {
    this.spawnErrors.push(listener);
  }
  kill(): void {
    this.kills += 1;
    if (this.onKill !== null && !this.exited) queueMicrotask(() => this.exit(this.onKill, null));
  }

  stdout(line: string): void {
    this.out.forEach((l) => l(line));
  }
  stderr(line: string): void {
    this.err.forEach((l) => l(line));
  }
  exit(code: number | null, signal: string | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.exits.forEach((l) => l(code, signal));
  }
  failSpawn(error: Error): void {
    this.spawnErrors.forEach((l) => l(error));
  }
  ready(port: number, enginePid: number, extra: Record<string, unknown> = {}): void {
    this.stdout(
      JSON.stringify({
        event: "ready",
        port,
        pid: enginePid,
        engine_version: "0.1.0",
        data_root: ROOT,
        model_file: "best.pt",
        model_sha256: "0e9e",
        stub_model: false,
        warmup_ms: 800,
        token_required: true,
        arabic_stack_ok: true,
        boot: {},
        ...extra,
      }),
    );
  }
  fatal(code: string, details: Record<string, unknown> = {}): void {
    this.stdout(JSON.stringify({ event: "fatal", code, message: `${code} message`, details }));
  }
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function makeMocks(fetchImpl: FetchFn) {
  return {
    fetch: vi.fn(fetchImpl),
    killPid: vi.fn((pid: number) => pid > 0),
    isPidAlive: vi.fn((pid: number) => pid < 0),
  };
}

interface Harness {
  sup: EngineSupervisor;
  procs: FakeProcess[];
  events: EngineStatusEvent[];
  mocks: ReturnType<typeof makeMocks>;
  log: string[];
  last(): EngineStatusEvent;
}

function harness(
  options: {
    packaged?: boolean;
    dataRoot?: string;
    onKill?: number | null;
    fetch?: FetchFn;
    /** the headless export's supervisor (`--export`) */
    exportRun?: boolean;
  } = {},
): Harness {
  const procs: FakeProcess[] = [];
  const events: EngineStatusEvent[] = [];
  const log: string[] = [];
  const mocks = makeMocks(
    options.fetch ?? (() => Promise.resolve(new Response("{}", { status: 200 }))),
  );
  const deps: SupervisorDeps = {
    spawn: (cmd: EngineCommand) => {
      const proc = new FakeProcess(cmd, 1000 + procs.length, options.onKill ?? 1);
      procs.push(proc);
      return proc;
    },
    fetch: mocks.fetch as unknown as typeof fetch,
    killPid: mocks.killPid,
    isPidAlive: mocks.isPidAlive,
    log: { write: (source: string, line: string) => void log.push(`[${source}] ${line}`) },
  };
  const config: SupervisorConfig = {
    dataRoot: options.dataRoot ?? ROOT,
    production: options.packaged ?? false,
    appDir: String.raw`E:\camel_beauty\nazeer-desktop\app`,
    resourcesPath: String.raw`C:\Program Files\Nazeer Desktop\resources`,
    corsOrigins: ["app://nazeer"],
    env: {},
    appInfo: { appVersion: "0.1.0", electron: "44.4.5", chromium: "152.0.0.0" },
    logDir: String.raw`C:\Users\op\AppData\Roaming\nazeer-desktop\logs`,
    ...(options.exportRun === true ? { noWarmup: true, keepOtherEngines: true } : {}),
  };
  const sup = new EngineSupervisor(config, deps);
  sup.onStatus((event) => events.push(event));
  return {
    sup,
    procs,
    events,
    mocks,
    log,
    last: () => events[events.length - 1]!,
  };
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EngineSupervisor: start", () => {
  it("spawns with a fresh token and reports ready with the engine's own pid", async () => {
    const h = harness();
    h.sup.start();
    expect(h.last()).toMatchObject({ status: "starting", connection: null, seq: 1 });
    await tick();
    expect(h.procs).toHaveLength(1);
    const proc = h.procs[0]!;
    expect(proc.token).toMatch(/^[0-9a-f]{64}$/);
    expect(proc.cmd.args).toEqual(expect.arrayContaining(["--data-root", ROOT, "--port", "0"]));
    expect(proc.cmd.args).toEqual(expect.arrayContaining(["--cors-origin", "app://nazeer"]));

    proc.stderr("INFO loading model");
    proc.ready(51234, 36760);
    const ready = h.last();
    expect(ready).toMatchObject({ status: "ready", fatal: null, restarts: 0, unresponsive: false });
    expect(ready.seq).toBeGreaterThan(1);
    expect(ready.connection).toEqual({
      baseUrl: "http://127.0.0.1:51234",
      port: 51234,
      token: proc.token,
      pid: 36760,
      dataRoot: ROOT,
      engineVersion: "0.1.0",
      modelFile: "best.pt",
      modelSha256: "0e9e",
      stubModel: false,
      warmupMs: 800,
      arabicStackOk: true,
      appVersion: "0.1.0",
      electron: "44.4.5",
      chromium: "152.0.0.0",
      logDir: String.raw`C:\Users\op\AppData\Roaming\nazeer-desktop\logs`,
    });
    expect(h.sup.getConnection()).toEqual(ready.connection);
    expect(h.log.join("\n")).toContain("[engine] INFO loading model");
    expect(h.log.join("\n")).not.toContain(proc.token);
  });

  it("noise on stdout is logged, not parsed as an event", async () => {
    const h = harness();
    h.sup.start();
    await tick();
    h.procs[0]!.stdout("some library printed this");
    expect(h.last().status).toBe("starting");
    expect(h.log).toContain("[stdout] some library printed this");
  });

  it.each([2, 3, 5])("exit %i with a fatal line: fatal screen, no retry", async (code) => {
    const h = harness();
    h.sup.start();
    await tick();
    h.procs[0]!.fatal("model_hash_mismatch", { model: "best.pt" });
    h.procs[0]!.exit(code);
    await tick(60_000);
    expect(h.procs).toHaveLength(1);
    expect(h.last()).toMatchObject({
      status: "fatal",
      fatal: {
        code: "model_hash_mismatch",
        message: "model_hash_mismatch message",
        details: { model: "best.pt" },
        exitCode: code,
      },
    });
  });

  it("an unexplained early exit is retried once, then fatal with the stderr tail", async () => {
    const h = harness();
    h.sup.start();
    await tick();
    h.procs[0]!.exit(1);
    await tick(1_499);
    expect(h.procs).toHaveLength(1);
    await tick(1);
    expect(h.procs).toHaveLength(2);
    h.procs[1]!.stderr("Traceback (most recent call last):");
    h.procs[1]!.exit(null, "SIGTERM");
    await tick(60_000);
    expect(h.procs).toHaveLength(2);
    expect(h.last().fatal).toMatchObject({
      code: "engine_exited",
      exitCode: null,
      details: { stderr_tail: ["Traceback (most recent call last):"] },
    });
    expect(h.last().fatal?.message).toContain("signal SIGTERM");
  });

  it("a missing executable is fatal at once", async () => {
    const h = harness();
    h.sup.start();
    await tick();
    h.procs[0]!.failSpawn(Object.assign(new Error("spawn python.exe ENOENT"), { code: "ENOENT" }));
    expect(h.last().fatal).toMatchObject({
      code: "engine_spawn_failed",
      details: { error: "ENOENT" },
    });
  });

  it("no ready line within 180 s: the process is killed and the screen is fatal", async () => {
    const h = harness();
    h.sup.start();
    await tick();
    await tick(179_999);
    expect(h.last().status).toBe("starting");
    await tick(1);
    expect(h.procs[0]!.kills).toBe(1);
    expect(h.last().fatal?.code).toBe("engine_start_timeout");
    await tick(60_000);
    expect(h.procs).toHaveLength(1); // the killed process's exit is not a crash
  });

  it("refuses a forbidden data root without spawning", async () => {
    const h = harness({ dataRoot: String.raw`C:\Users\op\OneDrive\nazeer` });
    h.sup.start();
    await tick();
    expect(h.procs).toHaveLength(0);
    expect(h.last().fatal).toMatchObject({ code: "data_root_invalid", exitCode: null });
  });

  it("an engine that does not require the token is refused and killed", async () => {
    const h = harness();
    h.sup.start();
    await tick();
    h.procs[0]!.ready(51234, 36760, { token_required: false });
    expect(h.last().fatal?.code).toBe("engine_protocol_error");
    expect(h.procs[0]!.kills).toBe(1);
    expect(h.mocks.killPid).not.toHaveBeenCalled(); // never ready: its pid is not trusted
  });

  it("retry() only acts on the fatal screen, and starts a new cycle", async () => {
    const h = harness();
    h.sup.retry();
    expect(h.events).toHaveLength(0);
    h.sup.start();
    await tick();
    h.procs[0]!.fatal("port_in_use");
    h.procs[0]!.exit(5);
    await tick();
    h.sup.retry();
    expect(h.last().status).toBe("starting");
    expect(h.last().fatal).toBeNull();
    await tick();
    expect(h.procs).toHaveLength(2);
  });
});

describe("EngineSupervisor: crashes after ready", () => {
  it("restarts with backoff and a new connection", async () => {
    const h = harness();
    h.sup.start();
    await tick();
    h.procs[0]!.ready(51234, 36760);
    h.procs[0]!.exit(1);
    expect(h.last()).toMatchObject({ status: "restarting", connection: null, restarts: 1 });
    await tick(999);
    expect(h.procs).toHaveLength(1);
    await tick(1);
    expect(h.procs).toHaveLength(2);
    expect(h.procs[1]!.token).not.toBe(h.procs[0]!.token);
    h.procs[1]!.ready(52000, 37000);
    expect(h.last()).toMatchObject({ status: "ready", restarts: 1 });
    expect(h.last().connection).toMatchObject({ port: 52000, pid: 37000 });
  });

  it("gives up after 5 restarts within 5 minutes", async () => {
    const h = harness();
    h.sup.start();
    await tick();
    for (let i = 0; i < 6; i += 1) {
      const proc = h.procs[i]!;
      proc.ready(51000 + i, 36000 + i);
      proc.exit(1);
      await tick(20_000);
    }
    expect(h.procs).toHaveLength(6);
    expect(h.last().status).toBe("fatal");
    expect(h.last().fatal).toMatchObject({
      code: "engine_restart_limit",
      details: { restarts: 5 },
    });
  });

  it("a replacement that dies before ready counts as another crash", async () => {
    const h = harness();
    h.sup.start();
    await tick();
    h.procs[0]!.ready(51234, 36760);
    h.procs[0]!.exit(1);
    await tick(1_000);
    h.procs[1]!.exit(1);
    expect(h.last()).toMatchObject({ status: "restarting", restarts: 2 });
    await tick(2_000);
    expect(h.procs).toHaveLength(3);
  });
});

describe("EngineSupervisor: data root already locked (exit 6)", () => {
  const healthOf =
    (pid: number, dataRoot = ROOT) =>
    (url: string) =>
      Promise.resolve(
        url.endsWith("/health")
          ? new Response(JSON.stringify({ pid, data_root: dataRoot }), { status: 200 })
          : new Response("{}", { status: 200 }),
      );

  it("dev: an engine left on our data root is stopped and the start goes on", async () => {
    const h = harness({ fetch: healthOf(4100) });
    h.mocks.isPidAlive.mockReturnValueOnce(true).mockReturnValue(false);
    h.sup.start();
    await tick();
    h.procs[0]!.fatal("engine_already_running", { pid: 4100, port: 50123 });
    h.procs[0]!.exit(6);
    await tick(500);
    expect(h.mocks.fetch).toHaveBeenCalledWith("http://127.0.0.1:50123/health", expect.anything());
    expect(h.mocks.killPid).toHaveBeenCalledWith(4100);
    expect(h.procs).toHaveLength(2);
    h.procs[1]!.ready(51234, 36760);
    expect(h.last().status).toBe("ready");
  });

  it("the headless export never stops the app's engine: fatal at once, even in dev", async () => {
    const h = harness({ fetch: healthOf(4100), exportRun: true });
    h.sup.start();
    await tick();
    expect(h.procs[0]!.cmd.args).toContain("--no-warmup");
    h.procs[0]!.fatal("engine_already_running", { pid: 4100, port: 50123 });
    h.procs[0]!.exit(6);
    await tick(500);
    expect(h.mocks.killPid).not.toHaveBeenCalled();
    expect(h.procs).toHaveLength(1);
    expect(h.last().fatal).toMatchObject({
      code: "engine_already_running",
      details: { holder: "ours" },
    });
  });

  it("packaged: fatal first; the operator's retry stops it", async () => {
    const h = harness({ packaged: true, fetch: healthOf(4100) });
    h.sup.start();
    await tick();
    h.procs[0]!.fatal("engine_already_running", { pid: 4100, port: 50123 });
    h.procs[0]!.exit(6);
    await tick(500);
    expect(h.mocks.killPid).not.toHaveBeenCalled();
    expect(h.last().fatal).toMatchObject({
      code: "engine_already_running",
      exitCode: 6,
      details: { pid: 4100, port: 50123, holder: "ours" },
    });

    h.sup.retry();
    await tick();
    h.procs[1]!.fatal("engine_already_running", { pid: 4100, port: 50123 });
    h.procs[1]!.exit(6);
    await tick(500);
    expect(h.mocks.killPid).toHaveBeenCalledWith(4100);
    expect(h.procs).toHaveLength(3);
  });

  it("an engine nobody can identify gets one retry, then the fatal screen", async () => {
    const h = harness({
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    h.sup.start();
    await tick();
    h.procs[0]!.fatal("engine_already_running", { pid: 4100, port: 50123 });
    h.procs[0]!.exit(6);
    await tick(1_500);
    expect(h.procs).toHaveLength(2);
    h.procs[1]!.fatal("engine_already_running", { pid: 4100, port: null });
    h.procs[1]!.exit(6);
    await tick(5_000);
    expect(h.procs).toHaveLength(2);
    expect(h.mocks.killPid).not.toHaveBeenCalled();
    expect(h.last().fatal).toMatchObject({
      code: "engine_already_running",
      details: { holder: "unknown" },
    });
  });

  it("a holder serving another data root is never stopped", async () => {
    const h = harness({ fetch: healthOf(4100, "D:\\other") });
    h.sup.start();
    await tick();
    for (const proc of [0, 1]) {
      h.procs[proc]!.fatal("engine_already_running", { pid: 4100, port: 50123 });
      h.procs[proc]!.exit(6);
      await tick(1_500);
    }
    expect(h.mocks.killPid).not.toHaveBeenCalled();
    expect(h.last().status).toBe("fatal");
  });
});

describe("EngineSupervisor: stop and watchdog", () => {
  it("stop: POST /system/shutdown with the token, wait for the exit, no restart", async () => {
    const h = harness();
    h.sup.start();
    await tick();
    const proc = h.procs[0]!;
    proc.ready(51234, 36760);
    const stopped = h.sup.stop();
    expect(h.last()).toMatchObject({ status: "stopping", connection: null });
    await tick();
    const [url, init] = h.mocks.fetch.mock.calls.at(-1)!;
    expect(url).toBe("http://127.0.0.1:51234/system/shutdown");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["X-Nazeer-Token"]).toBe(proc.token);
    proc.exit(0);
    await tick();
    await stopped;
    await tick(60_000);
    expect(h.procs).toHaveLength(1);
    expect(proc.kills).toBe(0);
    expect(h.sup.stop()).toBe(stopped);
  });

  it("stop: an engine that ignores the shutdown is killed after 8 s (launcher and engine pid)", async () => {
    const h = harness({ onKill: null });
    h.sup.start();
    await tick();
    const proc = h.procs[0]!;
    proc.ready(51234, 36760);
    let done = false;
    void h.sup.stop().then(() => {
      done = true;
    });
    await tick(7_999);
    expect(proc.kills).toBe(0);
    await tick(1);
    expect(proc.kills).toBe(1);
    expect(h.mocks.killPid).toHaveBeenCalledWith(36760);
    await tick(5_000);
    expect(done).toBe(true);
  });

  it("stop while starting kills the process at once", async () => {
    const h = harness();
    h.sup.start();
    await tick();
    const stopped = h.sup.stop();
    await tick();
    await stopped;
    expect(h.procs[0]!.kills).toBe(1);
    expect(h.mocks.fetch).not.toHaveBeenCalled();
  });

  it("a ready line that arrives after stop() is ignored: never ready while stopping", async () => {
    const h = harness();
    h.sup.start();
    await tick();
    const stopped = h.sup.stop();
    h.procs[0]!.ready(51234, 4321); // buffered before the kill took effect
    await tick();
    await stopped;
    const statuses = h.events.map((e) => e.status);
    expect(statuses.slice(statuses.indexOf("stopping"))).not.toContain("ready");
    expect(h.sup.getConnection()).toBeNull();
  });

  it("watchdog: two failed /health checks mark the engine unresponsive; an answer clears it", async () => {
    let healthy = false;
    const h = harness({
      fetch: () =>
        Promise.resolve(
          healthy
            ? new Response(JSON.stringify({ pid: 36760 }), { status: 200 })
            : new Response("busy", { status: 503 }),
        ),
    });
    h.sup.start();
    await tick();
    h.procs[0]!.ready(51234, 36760);
    await tick(15_000);
    expect(h.last().unresponsive).toBe(false);
    await tick(15_000);
    expect(h.last()).toMatchObject({ status: "ready", unresponsive: true });
    healthy = true;
    await tick(15_000);
    expect(h.last()).toMatchObject({ status: "ready", unresponsive: false });
    expect(h.procs[0]!.kills).toBe(0);
  });

  it("watchdog: an answer from another pid is not health", async () => {
    const h = harness({
      fetch: () => Promise.resolve(new Response(JSON.stringify({ pid: 1 }), { status: 200 })),
    });
    h.sup.start();
    await tick();
    h.procs[0]!.ready(51234, 36760);
    await tick(30_000);
    expect(h.last().unresponsive).toBe(true);
  });
});

describe("supervisor fatal codes", () => {
  it("every code the supervisor raises has an Arabic and an English label", () => {
    const source = ["./supervisor.ts", "./dataRoot.ts"]
      .map((file) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"))
      .join("\n");
    // `code: "x"`, `code: something ?? "x"` and the DataRootProblem literal type
    const codes = [...source.matchAll(/code:[^,\n]*?"([a-z_]+)"/g)].map((m) => m[1]!);
    expect(new Set(codes)).toEqual(
      new Set([
        "engine_spawn_failed",
        "engine_protocol_error",
        "engine_start_timeout",
        "engine_restart_limit",
        "engine_exited",
        "data_root_invalid",
      ]),
    );
    const labelled = (lang: typeof en) =>
      ({ ...lang.errors, ...lang.appErrors }) as Record<string, string>;
    for (const code of codes) {
      expect(labelled(en)[code], `en ${code}`).toBeTruthy();
      expect(labelled(ar)[code], `ar ${code}`).toBeTruthy();
    }
  });
});
