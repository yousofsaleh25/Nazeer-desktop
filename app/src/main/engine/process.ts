/**
 * The spawned engine as the supervisor sees it: stdout / stderr lines, one exit notification, a
 * kill. `spawnEngineProcess` adapts `child_process.spawn`; the supervisor tests use a fake.
 *
 * Exit is reported once both pipes are drained ('close'), so a fatal line written just before the
 * engine exits is always read first. A dev engine runs under the venv launcher, whose child
 * inherits the pipes; if 'close' has not arrived 1 s after 'exit', the exit is reported anyway.
 */
import { spawn } from "node:child_process";
import readline from "node:readline";
import type { EngineCommand } from "./command";

export interface EngineProcess {
  /** the spawned process (the venv launcher in dev, not the engine interpreter) */
  readonly pid: number | undefined;
  onStdoutLine(listener: (line: string) => void): void;
  onStderrLine(listener: (line: string) => void): void;
  /** called once, after the process exited and its output was read */
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  /** spawning failed (missing executable, access denied); no exit follows */
  onSpawnError(listener: (error: Error) => void): void;
  kill(): void;
}

export const CLOSE_AFTER_EXIT_MS = 1_000;

export function spawnEngineProcess(cmd: EngineCommand): EngineProcess {
  const child = spawn(cmd.command, cmd.args, {
    cwd: cmd.cwd,
    env: cmd.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });
  const stdoutListeners: ((line: string) => void)[] = [];
  const stderrListeners: ((line: string) => void)[] = [];
  const exitListeners: ((code: number | null, signal: string | null) => void)[] = [];
  const errorListeners: ((error: Error) => void)[] = [];

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  readline
    .createInterface({ input: child.stdout, crlfDelay: Infinity })
    .on("line", (line) => stdoutListeners.forEach((listener) => listener(line)));
  readline
    .createInterface({ input: child.stderr, crlfDelay: Infinity })
    .on("line", (line) => stderrListeners.forEach((listener) => listener(line)));

  let spawned = false;
  let reported = false;
  const report = (code: number | null, signal: string | null): void => {
    if (reported) return;
    reported = true;
    exitListeners.forEach((listener) => listener(code, signal));
  };
  child.once("spawn", () => {
    spawned = true;
  });
  child.on("error", (error) => {
    // after a successful spawn, 'error' only means a kill or a pipe failed: exit still follows
    if (!spawned) errorListeners.forEach((listener) => listener(error));
  });
  child.once("exit", (code, signal) => {
    const timer = setTimeout(() => report(code, signal), CLOSE_AFTER_EXIT_MS);
    child.once("close", () => {
      clearTimeout(timer);
      report(code, signal);
    });
  });

  return {
    get pid() {
      return child.pid;
    },
    onStdoutLine: (listener) => void stdoutListeners.push(listener),
    onStderrLine: (listener) => void stderrListeners.push(listener),
    onExit: (listener) => void exitListeners.push(listener),
    onSpawnError: (listener) => void errorListeners.push(listener),
    kill: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}

/** Kill a process by pid (the engine interpreter behind the launcher); false when it is gone. */
export function killPid(pid: number): boolean {
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

/** Whether a pid is alive (signal 0 probes without killing; EPERM means it exists). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
