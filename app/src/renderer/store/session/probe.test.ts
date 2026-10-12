import { describe, expect, it } from "vitest";
import {
  emptyChannel,
  probeFailed,
  probeReply,
  probeRequest,
  probeReset,
  type ProbeChannel,
} from "./probe";

type Ch = ProbeChannel<string, string>;
const fresh = (): Ch => emptyChannel<string, string>();

describe("probe channels", () => {
  it("send at once when free, with growing seqs", () => {
    let ch = probeRequest(fresh(), "a");
    expect(ch.inFlight).toEqual({ seq: 1, generation: 0, request: "a" });
    ch = probeReply(ch, 1, "A");
    ch = probeRequest(ch, "b");
    expect(ch.inFlight?.seq).toBe(2);
  });

  it("keep one request in flight; the newest pointer state waits and goes out on the reply", () => {
    let ch = probeRequest(fresh(), "a");
    ch = probeRequest(ch, "b");
    ch = probeRequest(ch, "c");
    expect(ch.inFlight?.request).toBe("a");
    expect(ch.pending).toBe("c");
    ch = probeReply(ch, 1, "A");
    expect(ch.result).toBe("A");
    expect(ch.inFlight).toEqual({ seq: 2, generation: 0, request: "c" });
    expect(ch.pending).toBeNull();
  });

  it("ignore a reply that does not answer the request in flight", () => {
    const ch = probeRequest(fresh(), "a");
    expect(probeReply(ch, 7, "stale")).toBe(ch);
    expect(probeFailed(ch, 7)).toBe(ch);
  });

  it("after a reset the late reply frees the slot but is not shown", () => {
    let ch = probeRequest(fresh(), "a");
    ch = probeReset(ch);
    expect(ch.result).toBeNull();
    ch = probeReply(ch, 1, "late");
    expect(ch.inFlight).toBeNull();
    expect(ch.result).toBeNull();
    expect(ch.generation).toBe(1);
  });

  it("a failure or timeout frees the slot and sends what is pending; the last result stays", () => {
    let ch = probeReply(probeRequest(fresh(), "a"), 1, "A");
    ch = probeRequest(ch, "b");
    ch = probeRequest(ch, "c");
    ch = probeFailed(ch, 2);
    expect(ch.result).toBe("A");
    expect(ch.inFlight).toEqual({ seq: 3, generation: 0, request: "c" });
  });
});
