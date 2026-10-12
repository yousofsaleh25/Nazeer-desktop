/**
 * Hover (depth) and drag (preview) requests, one channel each (pure state transitions; the
 * session slice holds the channels, a listener sends). One request in flight per channel; the
 * newest pointer state waits in `pending` (replaced by anything newer) and goes out when the reply
 * lands. A reply counts only if it answers the request in flight and the channel's generation has
 * not moved on: pointer-leave, a tool change, Esc and commit bump the generation and clear the
 * result. An error or a timeout frees the slot the same way.
 */

export interface ProbeChannel<Req, Res> {
  generation: number;
  /** the last seq sent; seqs only grow */
  lastSeq: number;
  inFlight: { seq: number; generation: number; request: Req } | null;
  pending: Req | null;
  result: Res | null;
  resultSeq: number | null;
}

export function emptyChannel<Req, Res>(): ProbeChannel<Req, Res> {
  return {
    generation: 0,
    lastSeq: 0,
    inFlight: null,
    pending: null,
    result: null,
    resultSeq: null,
  };
}

function send<Req, Res>(ch: ProbeChannel<Req, Res>, request: Req): ProbeChannel<Req, Res> {
  const seq = ch.lastSeq + 1;
  return {
    ...ch,
    lastSeq: seq,
    inFlight: { seq, generation: ch.generation, request },
    pending: null,
  };
}

/** A new pointer state: sent now if the slot is free, otherwise kept as the newest pending one. */
export function probeRequest<Req, Res>(
  ch: ProbeChannel<Req, Res>,
  request: Req,
): ProbeChannel<Req, Res> {
  return ch.inFlight === null ? send(ch, request) : { ...ch, pending: request };
}

/** The reply to `seq`: applied when it answers the request in flight of the current generation. */
export function probeReply<Req, Res>(
  ch: ProbeChannel<Req, Res>,
  seq: number,
  result: Res,
): ProbeChannel<Req, Res> {
  if (ch.inFlight === null || ch.inFlight.seq !== seq) return ch;
  const current = ch.inFlight.generation === ch.generation;
  const next = {
    ...ch,
    inFlight: null,
    result: current ? result : ch.result,
    resultSeq: current ? seq : ch.resultSeq,
  };
  return next.pending === null ? next : send(next, next.pending);
}

/** The request `seq` failed or timed out: the slot is free again (the result stays as it was). */
export function probeFailed<Req, Res>(
  ch: ProbeChannel<Req, Res>,
  seq: number,
): ProbeChannel<Req, Res> {
  if (ch.inFlight === null || ch.inFlight.seq !== seq) return ch;
  const next = { ...ch, inFlight: null };
  return next.pending === null ? next : send(next, next.pending);
}

/** Pointer-leave, tool change, Esc, commit: a new generation, nothing pending, no result. */
export function probeReset<Req, Res>(ch: ProbeChannel<Req, Res>): ProbeChannel<Req, Res> {
  return { ...ch, generation: ch.generation + 1, pending: null, result: null, resultSeq: null };
}
