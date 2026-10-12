import { describe, expect, it, vi } from "vitest";
import { judgeLockHolder, lockHolderFrom, probeHealth } from "./orphan";

const ROOT = String.raw`E:\camel_beauty\nazeer-desktop\runs\dev_root`;

describe("lockHolderFrom", () => {
  it("reads pid and port from the fatal line's details", () => {
    expect(lockHolderFrom({ pid: 4100, port: 50123 })).toEqual({ pid: 4100, port: 50123 });
    expect(lockHolderFrom({ pid: 4100, port: null })).toEqual({ pid: 4100, port: null });
    expect(lockHolderFrom({ pid: "4100", port: 70000 })).toEqual({ pid: null, port: null });
  });
});

describe("judgeLockHolder", () => {
  const holder = { pid: 4100, port: 50123 };

  it("ours: /health answers with the lock's pid and our data root (any spelling)", () => {
    const health = { pid: 4100, data_root: "e:/camel_beauty/nazeer-desktop/runs/dev_root/" };
    expect(judgeLockHolder(holder, health, ROOT)).toEqual({ kind: "ours", pid: 4100, port: 50123 });
  });

  it("unknown: no port yet, no answer, another pid, another data root", () => {
    expect(judgeLockHolder({ pid: 4100, port: null }, null, ROOT).kind).toBe("unknown");
    expect(judgeLockHolder(holder, null, ROOT).kind).toBe("unknown");
    expect(judgeLockHolder(holder, { pid: 999, data_root: ROOT }, ROOT).kind).toBe("unknown");
    const other = judgeLockHolder(holder, { pid: 4100, data_root: "D:\\other" }, ROOT);
    expect(other.kind).toBe("unknown");
    expect(other.kind === "unknown" ? other.reason : "").toContain("data root");
  });
});

describe("probeHealth", () => {
  it("returns the parsed body, or null on an error status or a failed fetch", async () => {
    const ok = vi.fn((url: string, init?: RequestInit) => {
      void init;
      return Promise.resolve(new Response(JSON.stringify({ pid: 1, url }), { status: 200 }));
    });
    expect(await probeHealth(50123, ok as unknown as typeof fetch, 500)).toEqual({
      pid: 1,
      url: "http://127.0.0.1:50123/health",
    });
    expect(ok.mock.calls[0]?.[1]?.cache).toBe("no-store");

    const bad = vi.fn(() => Promise.resolve(new Response("no", { status: 500 })));
    expect(await probeHealth(1, bad as unknown as typeof fetch, 500)).toBeNull();
    const down = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    expect(await probeHealth(1, down as unknown as typeof fetch, 500)).toBeNull();
  });
});
