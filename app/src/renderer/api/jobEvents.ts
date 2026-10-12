/**
 * The candidate job's event stream (`GET /candidates/jobs/{id}/events`): `progress` events, then
 * one terminal event named after the job's state (`done`, `cancelled`, `failed`); each carries the
 * job snapshot as JSON. The EventSource lives outside Redux (not serialisable); tests replace the
 * factory. Any stream error is reported once and the stream closed (the caller then polls).
 */
import type { JobSnapshot } from "./types";

export interface JobStreamHandlers {
  snapshot(snapshot: JobSnapshot): void;
  terminal(snapshot: JobSnapshot): void;
  error(): void;
}

export interface JobStream {
  close(): void;
}

export type OpenJobStream = (url: string, on: JobStreamHandlers) => JobStream;

export const TERMINAL_EVENTS = ["done", "cancelled", "failed"] as const;

const openEventSource: OpenJobStream = (url, on) => {
  const source = new EventSource(url);
  let closed = false;
  const close = () => {
    closed = true;
    source.close();
  };
  const parse = (event: Event): JobSnapshot | null => {
    try {
      return JSON.parse((event as MessageEvent<string>).data) as JobSnapshot;
    } catch {
      return null;
    }
  };
  source.addEventListener("progress", (event) => {
    const snapshot = parse(event);
    if (snapshot !== null && !closed) on.snapshot(snapshot);
  });
  for (const name of TERMINAL_EVENTS) {
    source.addEventListener(name, (event) => {
      const snapshot = parse(event);
      if (closed) return;
      close();
      if (snapshot !== null) on.terminal(snapshot);
      else on.error();
    });
  }
  source.onerror = () => {
    if (closed) return;
    close();
    on.error();
  };
  return { close };
};

let factory: OpenJobStream = openEventSource;

export function openJobStream(url: string, on: JobStreamHandlers): JobStream {
  return factory(url, on);
}

/** Tests: replace the EventSource; returns a restore function. */
export function setJobStreamFactory(next: OpenJobStream): () => void {
  const previous = factory;
  factory = next;
  return () => {
    factory = previous;
  };
}
