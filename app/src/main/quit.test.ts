import { afterEach, describe, expect, it, vi } from "vitest";
import { QuitCoordinator, RendererQuitBridge, type QuitDeps, type RendererAnswer } from "./quit";

function event() {
  return { preventDefault: vi.fn() };
}

function deps(answer: RendererAnswer, { confirm = true, failStop = false } = {}) {
  const calls: string[] = [];
  const m = {
    askRenderer: vi.fn(() => {
      calls.push("ask");
      return Promise.resolve(answer);
    }),
    confirmQuit: vi.fn((reason: "unsaved" | "no_answer") => {
      calls.push(`confirm:${reason}`);
      return Promise.resolve(confirm);
    }),
    stopEngine: vi.fn(() => {
      calls.push("stop");
      return failStop ? Promise.reject(new Error("boom")) : Promise.resolve();
    }),
    clearCache: vi.fn(() => {
      calls.push("cache");
      return failStop ? Promise.reject(new Error("boom")) : Promise.resolve();
    }),
    quit: vi.fn(() => {
      calls.push("quit");
    }),
    log: vi.fn(),
  };
  const d: QuitDeps = m;
  return { d, m, calls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("QuitCoordinator", () => {
  it("clean renderer: close → ask → quit → will-quit held until the engine stopped", async () => {
    const { d, calls } = deps({ answered: true, unsaved: false });
    const quit = new QuitCoordinator(d);
    const close = event();
    quit.onCloseRequested(close);
    expect(close.preventDefault).toHaveBeenCalled();
    await flush();
    expect(calls).toEqual(["ask", "quit"]);
    expect(quit.current).toBe("confirmed");

    // app.quit() → before-quit and the window's close now pass
    const again = event();
    quit.onCloseRequested(again);
    expect(again.preventDefault).not.toHaveBeenCalled();

    const willQuit = event();
    quit.onWillQuit(willQuit);
    expect(willQuit.preventDefault).toHaveBeenCalled();
    const repeated = event();
    quit.onWillQuit(repeated); // a second will-quit while stopping is held too
    expect(repeated.preventDefault).toHaveBeenCalled();
    await flush();
    expect(calls).toEqual(["ask", "quit", "stop", "cache", "quit"]);
    expect(quit.current).toBe("done");
    const last = event();
    quit.onWillQuit(last);
    expect(last.preventDefault).not.toHaveBeenCalled();
  });

  it("unsaved changes: the operator can cancel, and the app keeps running", async () => {
    const { d, m, calls } = deps({ answered: true, unsaved: true }, { confirm: false });
    const quit = new QuitCoordinator(d);
    quit.onCloseRequested(event());
    await flush();
    expect(calls).toEqual(["ask", "confirm:unsaved"]);
    expect(quit.current).toBe("running");
    expect(m.stopEngine).not.toHaveBeenCalled();
  });

  it("no answer from the window: asks the operator, quits when told to", async () => {
    const { d, calls } = deps({ answered: false, unsaved: true });
    const quit = new QuitCoordinator(d);
    quit.onCloseRequested(event());
    await flush();
    expect(calls).toEqual(["ask", "confirm:no_answer", "quit"]);
  });

  it("a second close while confirming is held, not asked twice", async () => {
    const { d, m } = deps({ answered: true, unsaved: false });
    const quit = new QuitCoordinator(d);
    quit.onCloseRequested(event());
    const second = event();
    quit.onCloseRequested(second);
    expect(second.preventDefault).toHaveBeenCalled();
    await flush();
    expect(m.askRenderer).toHaveBeenCalledTimes(1);
  });

  it("a failing engine stop or cache clear never blocks the exit", async () => {
    const { d, m, calls } = deps({ answered: true, unsaved: false }, { failStop: true });
    const quit = new QuitCoordinator(d);
    quit.onCloseRequested(event());
    await flush();
    quit.onWillQuit(event());
    await flush();
    expect(quit.current).toBe("done");
    expect(calls).toEqual(["ask", "quit", "stop", "cache", "quit"]);
    expect(m.quit).toHaveBeenCalledTimes(2);
  });
});

describe("RendererQuitBridge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the renderer's ack for its request id; ignores others", async () => {
    const sent: number[] = [];
    const bridge = new RendererQuitBridge((id) => {
      sent.push(id);
      return true;
    });
    const answer = bridge.ask(3_000);
    bridge.acknowledge(99, false);
    bridge.acknowledge(sent[0]!, true);
    await expect(answer).resolves.toEqual({ answered: true, unsaved: true });
  });

  it("no window: nothing to flush", async () => {
    const bridge = new RendererQuitBridge(() => false);
    await expect(bridge.ask(3_000)).resolves.toEqual({ answered: true, unsaved: false });
  });

  it("times out as not answered; a late ack is ignored", async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const bridge = new RendererQuitBridge((id) => {
      sent.push(id);
      return true;
    });
    const answer = bridge.ask(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(answer).resolves.toEqual({ answered: false, unsaved: true });
    expect(() => bridge.acknowledge(sent[0]!, false)).not.toThrow();
  });
});
