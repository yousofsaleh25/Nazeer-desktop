/**
 * The engine sidecar's supervisor (D9 "Engine supervisor", Stage 4).
 *
 * start → spawn (data root checked first; a fresh 32-byte token per spawn) → the ready line gives
 * the port and the engine's own pid (its identity: in dev the spawned process is the venv
 * launcher) → ready, with a soft /health watchdog. Before ready:
 *   exit 2 / 3 / 5 (arguments or data root, model, port)        → fatal screen
 *   exit 6 (data root locked)  → ask /health on the lock's port: an engine with the lock's pid
 *       serving our data root is left over from an app that did not close; dev stops it and
 *       starts again, a packaged app does so only when the operator retries (or when it is an
 *       engine this app started); anything else gets one retry, then the fatal screen
 *   any other exit, no ready line within 180 s                  → one retry / the fatal screen
 * After ready, an exit is a crash: restart with backoff (RestartPolicy), fatal after 5 in 5 min.
 * stop → POST /system/shutdown → wait 8 s → kill (launcher and engine pid).
 *
 * Every transition is logged (logs.ts) and pushed to the renderer as an EngineStatusEvent whose
 * `seq` increases, so the renderer can drop a reply older than an event it already applied.
 */
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  EngineConnection,
  EngineFatal,
  EngineStatusEvent,
  EngineStatusName,
} from "@shared/ipc";
import { buildEngineCommand, describeCommand, type EngineCommand } from "./command";
import { checkDataRoot, samePath } from "./dataRoot";
import { judgeLockHolder, lockHolderFrom, probeHealth } from "./orphan";
import type { EngineProcess } from "./process";
import { parseStdoutLine, type FatalEvent, type ReadyEvent } from "./readyLine";
import { RESTART_WINDOW_MS, RestartPolicy } from "./restartPolicy";

export interface SupervisorTiming {
  startTimeoutMs: number;
  /** pause before the one retry of an unexplained early exit */
  retryDelayMs: number;
  orphanProbeTimeoutMs: number;
  /** how long to wait for a killed process to disappear */
  killWaitMs: number;
  watchdogIntervalMs: number;
  watchdogTimeoutMs: number;
  /** consecutive failed /health checks before the status says "unresponsive" */
  watchdogFailures: number;
  shutdownRequestTimeoutMs: number;
  /** after POST /system/shutdown, how long the engine gets before it is killed */
  stopGraceMs: number;
}

export const DEFAULT_TIMING: SupervisorTiming = {
  startTimeoutMs: 180_000,
  retryDelayMs: 1_500,
  orphanProbeTimeoutMs: 2_000,
  killWaitMs: 5_000,
  watchdogIntervalMs: 15_000,
  watchdogTimeoutMs: 5_000,
  watchdogFailures: 2,
  shutdownRequestTimeoutMs: 2_000,
  stopGraceMs: 8_000,
};

export interface SupervisorConfig {
  dataRoot: string;
  production: boolean;
  appDir: string;
  resourcesPath: string;
  corsOrigins: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  appInfo: { appVersion: string; electron: string; chromium: string };
  logDir: string;
  timing?: Partial<SupervisorTiming>;
  /** the headless `--export` run: no model warm-up */
  noWarmup?: boolean;
  /** the headless `--export` run: an engine already serving this data root belongs to the
   * running app; it is never stopped (the export fails with engine_already_running instead) */
  keepOtherEngines?: boolean;
}

export interface SupervisorLog {
  write(source: "engine" | "supervisor" | "stdout", line: string): void;
}

export interface SupervisorDeps {
  spawn(cmd: EngineCommand): EngineProcess;
  fetch: typeof fetch;
  killPid(pid: number): boolean;
  isPidAlive(pid: number): boolean;
  log: SupervisorLog;
  now?: () => number;
  randomToken?: () => string;
}

const STDERR_TAIL_LINES = 20;
/** Early exits a retry cannot fix: arguments / data root (2), model (3), port (5). */
const NO_RETRY_EXIT_CODES: ReadonlySet<number> = new Set([2, 3, 5]);
const EXIT_LOCKED = 6;

interface Run {
  gen: number;
  proc: EngineProcess;
  token: string;
  ready: ReadyEvent | null;
  readyAt: number | null;
  fatalLine: FatalEvent | null;
  stderrTail: string[];
  exited: Promise<void>;
  startTimer: ReturnType<typeof setTimeout> | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tailDetails(run: Run): Record<string, unknown> {
  return run.stderrTail.length > 0 ? { stderr_tail: [...run.stderrTail] } : {};
}

export class EngineSupervisor {
  private readonly timing: SupervisorTiming;
  private readonly emitter = new EventEmitter();
  private readonly policy = new RestartPolicy();
  private readonly now: () => number;
  private readonly randomToken: () => string;

  private status: EngineStatusName = "starting";
  private connection: EngineConnection | null = null;
  private fatal: EngineFatal | null = null;
  private restarts = 0;
  private unresponsive = false;
  private seq = 0;

  private gen = 0;
  private cycle = 0;
  private run: Run | null = null;
  /** abandoned runs (timeout, protocol error) still on their way out */
  private readonly dying = new Set<Promise<void>>();
  /** engine pids this app started: such an engine holding the lock is always ours to stop */
  private readonly ownPids = new Set<number>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private watchdogMisses = 0;
  private watchdogBusy = false;
  private retriedEarlyExit = false;
  private orphanKilled = false;
  private orphanKillAllowed = false;
  private started = false;
  private stopRequested = false;
  private stopping: Promise<void> | null = null;

  constructor(
    private readonly config: SupervisorConfig,
    private readonly deps: SupervisorDeps,
  ) {
    this.timing = { ...DEFAULT_TIMING, ...config.timing };
    this.now = deps.now ?? Date.now;
    this.randomToken = deps.randomToken ?? (() => randomBytes(32).toString("hex"));
  }

  onStatus(listener: (event: EngineStatusEvent) => void): () => void {
    this.emitter.on("status", listener);
    return () => {
      this.emitter.off("status", listener);
    };
  }

  statusEvent(): EngineStatusEvent {
    return {
      seq: this.seq,
      status: this.status,
      connection: this.connection,
      fatal: this.fatal,
      restarts: this.restarts,
      unresponsive: this.unresponsive,
    };
  }

  getConnection(): EngineConnection | null {
    return this.connection;
  }

  start(): void {
    if (this.started || this.stopRequested) return;
    this.started = true;
    this.beginCycle(false);
  }

  /** The fatal screen's "Try again": a new start cycle; an engine verified to serve our data
   * root that still holds the lock may now be stopped (the operator asked for it). */
  retry(): void {
    if (this.stopRequested || this.status !== "fatal") return;
    this.policy.reset();
    this.beginCycle(true);
  }

  stop(): Promise<void> {
    if (this.stopping !== null) return this.stopping;
    this.stopRequested = true;
    this.clearRetryTimer();
    this.stopWatchdog();
    const run = this.run;
    const connection = this.connection;
    this.connection = null;
    this.setStatus("stopping");
    this.stopping = this.shutDown(run, connection);
    return this.stopping;
  }

  // --- start cycle ---------------------------------------------------------------------------

  private beginCycle(operatorRetry: boolean): void {
    this.cycle += 1;
    this.retriedEarlyExit = false;
    this.orphanKilled = false;
    this.orphanKillAllowed =
      this.config.keepOtherEngines !== true && (operatorRetry || !this.config.production);
    this.fatal = null;
    this.setStatus("starting");
    void this.spawnRun();
  }

  private scheduleSpawn(delayMs: number): void {
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.spawnRun();
    }, delayMs);
  }

  private async spawnRun(): Promise<void> {
    if (this.stopRequested) return;
    // an engine being killed must be gone before its data root is offered to a new one
    await Promise.all([...this.dying]);
    if (this.stopRequested) return;

    const problem = checkDataRoot(this.config.dataRoot, this.config.env);
    if (problem !== null) {
      this.fail({ ...problem, exitCode: null });
      return;
    }
    const token = this.randomToken();
    const cmd = buildEngineCommand({
      production: this.config.production,
      appDir: this.config.appDir,
      resourcesPath: this.config.resourcesPath,
      dataRoot: this.config.dataRoot,
      token,
      corsOrigins: this.config.corsOrigins,
      env: this.config.env,
      noWarmup: this.config.noWarmup === true,
    });
    const gen = ++this.gen;
    this.log(`start #${gen}: ${describeCommand(cmd)} (cwd ${cmd.cwd})`);

    let proc: EngineProcess;
    try {
      proc = this.deps.spawn(cmd);
    } catch (error) {
      this.fail({
        code: "engine_spawn_failed",
        message: messageOf(error),
        details: { command: cmd.command },
        exitCode: null,
      });
      return;
    }
    let markExited: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => {
      markExited = resolve;
    });
    const run: Run = {
      gen,
      proc,
      token,
      ready: null,
      readyAt: null,
      fatalLine: null,
      stderrTail: [],
      exited,
      startTimer: null,
    };
    this.run = run;
    proc.onStdoutLine((line) => this.onStdout(run, line));
    proc.onStderrLine((line) => {
      this.deps.log.write("engine", line);
      run.stderrTail.push(line);
      if (run.stderrTail.length > STDERR_TAIL_LINES) run.stderrTail.shift();
    });
    proc.onSpawnError((error) => {
      markExited();
      if (this.run !== run) return;
      this.run = null;
      this.clearTimer(run);
      this.fail({
        code: "engine_spawn_failed",
        message: error.message,
        details: { command: cmd.command, error: (error as NodeJS.ErrnoException).code ?? null },
        exitCode: null,
      });
    });
    proc.onExit((code, signal) => {
      markExited();
      if (this.run === run) this.onExit(run, code, signal);
    });
    run.startTimer = setTimeout(() => this.onStartTimeout(run), this.timing.startTimeoutMs);
  }

  private onStdout(run: Run, raw: string): void {
    const parsed = parseStdoutLine(raw);
    if (parsed.kind === "other") {
      this.deps.log.write(
        "stdout",
        parsed.problem === undefined ? parsed.line : `${parsed.line} (${parsed.problem})`,
      );
      return;
    }
    if (this.run !== run) return;
    if (this.stopRequested) {
      // a line still buffered when stop() began: the engine is on its way out, never "ready"
      this.log(`ignored a ${parsed.kind} line from #${run.gen} while stopping`);
      return;
    }
    if (parsed.kind === "fatal") {
      run.fatalLine = parsed;
      this.log(`fatal line #${run.gen}: ${parsed.code}: ${parsed.message}`);
      return;
    }
    if (run.ready !== null) {
      this.log(`ignored a second ready line from #${run.gen}`);
      return;
    }
    this.onReady(run, parsed);
  }

  private onReady(run: Run, ready: ReadyEvent): void {
    this.clearTimer(run);
    if (!ready.tokenRequired) {
      this.fail({
        code: "engine_protocol_error",
        message: "the engine reported ready without requiring the token it was given",
        details: { pid: ready.pid, port: ready.port },
        exitCode: null,
      });
      return;
    }
    if (!samePath(ready.dataRoot, this.config.dataRoot)) {
      this.log(`warning: the engine serves ${ready.dataRoot} (asked for ${this.config.dataRoot})`);
    }
    run.ready = ready;
    run.readyAt = this.now();
    this.ownPids.add(ready.pid);
    this.connection = {
      baseUrl: `http://127.0.0.1:${ready.port}`,
      port: ready.port,
      token: run.token,
      pid: ready.pid,
      dataRoot: ready.dataRoot,
      engineVersion: ready.engineVersion,
      modelFile: ready.modelFile,
      modelSha256: ready.modelSha256,
      stubModel: ready.stubModel,
      warmupMs: ready.warmupMs,
      arabicStackOk: ready.arabicStackOk,
      ...this.config.appInfo,
      logDir: this.config.logDir,
    };
    this.unresponsive = false;
    this.watchdogMisses = 0;
    this.log(
      `ready #${run.gen}: port ${ready.port}, engine pid ${ready.pid}, spawned pid ` +
        `${run.proc.pid ?? "?"}, model ${ready.modelFile ?? "?"}${ready.stubModel ? " (stub)" : ""}` +
        `, warm-up ${ready.warmupMs ?? "-"} ms, arabic stack ${ready.arabicStackOk ? "ok" : "MISSING"}`,
    );
    this.startWatchdog(run);
    this.setStatus("ready");
  }

  private onStartTimeout(run: Run): void {
    run.startTimer = null;
    if (this.run !== run || run.ready !== null) return;
    this.log(`#${run.gen}: no ready line within ${this.timing.startTimeoutMs} ms`);
    this.fail({
      code: "engine_start_timeout",
      message: `the engine did not report ready within ${Math.round(this.timing.startTimeoutMs / 1000)} s`,
      details: { timeout_ms: this.timing.startTimeoutMs, ...tailDetails(run) },
      exitCode: null,
    });
  }

  private onExit(run: Run, code: number | null, signal: string | null): void {
    this.run = null;
    this.clearTimer(run);
    this.stopWatchdog();
    const when = run.ready === null ? " before ready" : "";
    this.log(`exit #${run.gen}${when}: code ${code ?? "none"}, signal ${signal ?? "none"}`);
    if (this.stopRequested) return;
    if (run.ready !== null && run.readyAt !== null) {
      this.connection = null;
      this.policy.noteStableRun(this.now() - run.readyAt);
      this.restartAfterCrash({
        code: "engine_restart_limit",
        message: "the engine stopped repeatedly",
        details: { exit_code: code, signal, ...tailDetails(run) },
        exitCode: code,
      });
      return;
    }
    void this.onEarlyExit(run, code, signal);
  }

  private restartAfterCrash(limitFatal: EngineFatal): void {
    const decision = this.policy.onCrash(this.now());
    if (decision.kind === "give_up") {
      this.fail({
        ...limitFatal,
        message: `the engine stopped more than ${decision.restartsInWindow} times within ${RESTART_WINDOW_MS / 60_000} minutes`,
        details: { ...limitFatal.details, restarts: this.restarts },
      });
      return;
    }
    this.restarts += 1;
    this.log(`restart ${decision.attempt} in ${decision.delayMs} ms`);
    this.setStatus("restarting");
    this.scheduleSpawn(decision.delayMs);
  }

  private async onEarlyExit(run: Run, code: number | null, signal: string | null): Promise<void> {
    const line = run.fatalLine;
    const fatal: EngineFatal = {
      code: line?.code ?? "engine_exited",
      message:
        line?.message ??
        `the engine exited before it was ready (exit code ${code ?? "none"}${signal === null ? "" : `, signal ${signal}`})`,
      details: line === null ? tailDetails(run) : { ...line.details },
      exitCode: code,
    };
    if (code !== null && NO_RETRY_EXIT_CODES.has(code)) {
      this.fail(fatal);
      return;
    }
    if (code === EXIT_LOCKED) {
      await this.onLocked(fatal);
      return;
    }
    if (this.status === "restarting") {
      // a replacement that dies before ready is part of the same crash sequence
      this.restartAfterCrash({ ...fatal, code: "engine_restart_limit" });
      return;
    }
    if (!this.retriedEarlyExit) {
      this.retriedEarlyExit = true;
      this.log(`retrying once in ${this.timing.retryDelayMs} ms`);
      this.scheduleSpawn(this.timing.retryDelayMs);
      return;
    }
    this.fail(fatal);
  }

  private async onLocked(fatal: EngineFatal): Promise<void> {
    const cycle = this.cycle;
    const holder = lockHolderFrom(fatal.details);
    const health =
      holder.port === null
        ? null
        : await probeHealth(holder.port, this.deps.fetch, this.timing.orphanProbeTimeoutMs);
    if (this.stopRequested || cycle !== this.cycle) return;
    const verdict = judgeLockHolder(holder, health, this.config.dataRoot);
    this.log(
      `data root locked by engine pid ${holder.pid ?? "?"} on port ${holder.port ?? "?"}: ` +
        (verdict.kind === "ours" ? "it serves our data root" : verdict.reason),
    );
    if (verdict.kind === "ours") {
      const mayStop = this.orphanKillAllowed || this.ownPids.has(verdict.pid);
      if (mayStop && !this.orphanKilled) {
        this.orphanKilled = true;
        this.log(`stopping engine pid ${verdict.pid} left on this data root`);
        this.deps.killPid(verdict.pid);
        const gone = await this.waitPidGone(verdict.pid, this.timing.killWaitMs);
        if (this.stopRequested || cycle !== this.cycle) return;
        if (gone) {
          void this.spawnRun();
          return;
        }
        this.fail({ ...fatal, details: { ...fatal.details, holder: "ours", kill_failed: true } });
        return;
      }
      this.fail({ ...fatal, details: { ...fatal.details, holder: "ours" } });
      return;
    }
    if (!this.retriedEarlyExit) {
      this.retriedEarlyExit = true;
      this.log(`retrying once in ${this.timing.retryDelayMs} ms`);
      this.scheduleSpawn(this.timing.retryDelayMs);
      return;
    }
    this.fail({
      ...fatal,
      details: { ...fatal.details, holder: "unknown", reason: verdict.reason },
    });
  }

  private async waitPidGone(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = this.now() + timeoutMs;
    while (this.deps.isPidAlive(pid)) {
      if (this.now() >= deadline) return false;
      await sleep(100);
    }
    return true;
  }

  // --- failure, watchdog, stop ---------------------------------------------------------------

  private fail(fatal: EngineFatal): void {
    this.clearRetryTimer();
    this.stopWatchdog();
    if (this.run !== null) this.abandon(this.run);
    this.connection = null;
    this.fatal = fatal;
    this.log(`fatal: ${fatal.code}: ${fatal.message}`);
    this.setStatus("fatal");
  }

  /** Kill a run whose events no longer matter; a later spawn waits until it is gone. */
  private abandon(run: Run): void {
    if (this.run === run) this.run = null;
    this.clearTimer(run);
    run.proc.kill();
    if (run.ready !== null) this.deps.killPid(run.ready.pid);
    const gone = Promise.race([run.exited, sleep(this.timing.killWaitMs)]);
    this.dying.add(gone);
    void gone.then(() => this.dying.delete(gone));
  }

  private startWatchdog(run: Run): void {
    this.stopWatchdog();
    this.watchdog = setInterval(() => void this.checkHealth(run), this.timing.watchdogIntervalMs);
  }

  private stopWatchdog(): void {
    if (this.watchdog !== null) clearInterval(this.watchdog);
    this.watchdog = null;
    this.watchdogBusy = false;
  }

  private async checkHealth(run: Run): Promise<void> {
    const ready = run.ready;
    if (this.watchdogBusy || this.run !== run || ready === null || this.status !== "ready") return;
    this.watchdogBusy = true;
    const health = await probeHealth(ready.port, this.deps.fetch, this.timing.watchdogTimeoutMs);
    this.watchdogBusy = false;
    if (this.run !== run || this.status !== "ready") return;
    const ok =
      typeof health === "object" &&
      health !== null &&
      (health as Record<string, unknown>)["pid"] === ready.pid;
    if (ok) {
      this.watchdogMisses = 0;
      if (this.unresponsive) {
        this.unresponsive = false;
        this.log("the engine answers /health again");
        this.emit();
      }
      return;
    }
    this.watchdogMisses += 1;
    if (!this.unresponsive && this.watchdogMisses >= this.timing.watchdogFailures) {
      this.unresponsive = true;
      this.log(`/health failed ${this.watchdogMisses} times in a row (the engine is kept running)`);
      this.emit();
    }
  }

  private async shutDown(run: Run | null, connection: EngineConnection | null): Promise<void> {
    if (run !== null) {
      this.clearTimer(run);
      if (run.ready !== null && connection !== null) {
        try {
          await this.deps.fetch(`${connection.baseUrl}/system/shutdown`, {
            method: "POST",
            headers: { "X-Nazeer-Token": connection.token },
            signal: AbortSignal.timeout(this.timing.shutdownRequestTimeoutMs),
          });
          this.log("shutdown requested");
        } catch (error) {
          this.log(`shutdown request failed: ${messageOf(error)}`);
        }
      } else {
        run.proc.kill(); // still starting: nothing to flush
      }
      const exited = await Promise.race([
        run.exited.then(() => true),
        sleep(this.timing.stopGraceMs).then(() => false),
      ]);
      if (!exited) {
        this.log(`no exit within ${this.timing.stopGraceMs} ms; killing the engine`);
        run.proc.kill();
        if (run.ready !== null) this.deps.killPid(run.ready.pid);
        await Promise.race([run.exited, sleep(this.timing.killWaitMs)]);
      }
      if (this.run === run) this.run = null;
    }
    await Promise.all([...this.dying]);
    this.log("stopped");
  }

  // --- helpers -------------------------------------------------------------------------------

  private setStatus(status: EngineStatusName): void {
    this.status = status;
    this.emit();
  }

  private emit(): void {
    this.seq += 1;
    this.emitter.emit("status", this.statusEvent());
  }

  private clearTimer(run: Run): void {
    if (run.startTimer !== null) clearTimeout(run.startTimer);
    run.startTimer = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private log(line: string): void {
    this.deps.log.write("supervisor", line);
  }
}
