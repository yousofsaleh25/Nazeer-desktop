/**
 * Closing the app (D9 "Quit"): the renderer flushes unsaved work first (it answers within 3 s);
 * when it reports unsaved changes or does not answer, the operator decides; then the engine is
 * stopped (POST /system/shutdown, kill after 8 s) and the HTTP cache (token-bearing asset URLs)
 * is cleared before the process exits.
 *
 *   window "close" / app "before-quit"   running → confirming (prevented) → confirmed → app.quit()
 *   app "will-quit"                      confirmed → stopping (prevented) → done → app.quit()
 *
 * Pure state machine with injected effects; unit-tested.
 */

export type QuitPhase = "running" | "confirming" | "confirmed" | "stopping" | "done";

export interface PreventableEvent {
  preventDefault(): void;
}

export interface RendererAnswer {
  /** false when the renderer did not answer in time (crashed, hung, no bridge) */
  answered: boolean;
  unsaved: boolean;
}

export interface QuitDeps {
  /** ask the operator window to flush; resolves within the timeout */
  askRenderer(timeoutMs: number): Promise<RendererAnswer>;
  /** "Quit anyway?" — true to quit */
  confirmQuit(reason: "unsaved" | "no_answer"): Promise<boolean>;
  stopEngine(): Promise<void>;
  clearCache(): Promise<void>;
  quit(): void;
  log(line: string): void;
}

export const QUIT_ACK_TIMEOUT_MS = 3_000;

export class QuitCoordinator {
  private phase: QuitPhase = "running";

  constructor(
    private readonly deps: QuitDeps,
    private readonly ackTimeoutMs = QUIT_ACK_TIMEOUT_MS,
  ) {}

  get current(): QuitPhase {
    return this.phase;
  }

  /** The operator window's "close" and the app's "before-quit". */
  onCloseRequested(event: PreventableEvent): void {
    if (this.phase === "running") {
      event.preventDefault();
      void this.confirm();
    } else if (this.phase === "confirming") {
      event.preventDefault();
    }
  }

  /** The app's "will-quit": hold the exit until the engine is stopped. */
  onWillQuit(event: PreventableEvent): void {
    if (this.phase === "confirmed") {
      event.preventDefault();
      this.phase = "stopping";
      void this.shutDown();
    } else if (this.phase === "stopping") {
      event.preventDefault();
    }
  }

  private async confirm(): Promise<void> {
    this.phase = "confirming";
    let answer: RendererAnswer;
    try {
      answer = await this.deps.askRenderer(this.ackTimeoutMs);
    } catch (error) {
      this.deps.log(`quit: asking the window failed: ${String(error)}`);
      answer = { answered: false, unsaved: true };
    }
    if (!answer.answered || answer.unsaved) {
      const reason = answer.answered ? "unsaved" : "no_answer";
      this.deps.log(`quit: ${reason}; asking the operator`);
      let quit = false;
      try {
        quit = await this.deps.confirmQuit(reason);
      } catch (error) {
        this.deps.log(`quit: the dialog failed: ${String(error)}`);
      }
      if (!quit) {
        this.phase = "running";
        this.deps.log("quit: cancelled by the operator");
        return;
      }
    }
    this.phase = "confirmed";
    this.deps.quit();
  }

  private async shutDown(): Promise<void> {
    try {
      await this.deps.stopEngine();
    } catch (error) {
      this.deps.log(`quit: stopping the engine failed: ${String(error)}`);
    }
    try {
      await this.deps.clearCache();
    } catch (error) {
      this.deps.log(`quit: clearing the HTTP cache failed: ${String(error)}`);
    }
    this.phase = "done";
    this.deps.quit();
  }
}

/**
 * Main's half of the quit handshake: send `before-quit` with a request id, resolve when the
 * renderer's ack with that id arrives (validated in ipc.ts), or after the timeout.
 */
export class RendererQuitBridge {
  private nextId = 1;
  private readonly pending = new Map<number, (unsaved: boolean) => void>();

  /** `send` returns false when there is no live operator window (nothing to flush). */
  constructor(private readonly send: (requestId: number) => boolean) {}

  ask(timeoutMs: number): Promise<RendererAnswer> {
    const requestId = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ answered: false, unsaved: true });
      }, timeoutMs);
      this.pending.set(requestId, (unsaved) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({ answered: true, unsaved });
      });
      if (!this.send(requestId)) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({ answered: true, unsaved: false });
      }
    });
  }

  /** The renderer's ack; an unknown or late id is ignored. */
  acknowledge(requestId: number, unsaved: boolean): void {
    this.pending.get(requestId)?.(unsaved);
  }
}
