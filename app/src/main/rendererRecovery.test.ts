import { describe, expect, it } from "vitest";
import { RELOAD_LIMIT, RELOAD_WINDOW_MS, RendererRecovery } from "./rendererRecovery";

describe("renderer recovery", () => {
  it("a clean exit is not a loss", () => {
    expect(new RendererRecovery(() => 0).onGone("clean-exit")).toBe("ignore");
  });

  it("reloads a crashed renderer a few times, then asks the operator", () => {
    let now = 0;
    const recovery = new RendererRecovery(() => now);
    for (let i = 0; i < RELOAD_LIMIT; i += 1) {
      now += 1000;
      expect(recovery.onGone("crashed")).toBe("reload");
    }
    expect(recovery.onGone("oom")).toBe("ask");
    // the window slides: losses older than it no longer count
    now += RELOAD_WINDOW_MS;
    expect(recovery.onGone("crashed")).toBe("reload");
  });

  it("never reloads a renderer that cannot start", () => {
    const recovery = new RendererRecovery(() => 0);
    expect(recovery.onGone("launch-failed")).toBe("ask");
    expect(recovery.onGone("integrity-failure")).toBe("ask");
  });

  it("trying again counts afresh", () => {
    const recovery = new RendererRecovery(() => 0);
    for (let i = 0; i < RELOAD_LIMIT; i += 1) recovery.onGone("killed");
    expect(recovery.onGone("killed")).toBe("ask");
    recovery.reset();
    expect(recovery.onGone("killed")).toBe("reload");
  });
});
