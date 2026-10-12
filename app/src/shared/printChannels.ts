/**
 * The hidden print window's IPC channels (main ↔ preload/print.ts). Kept apart from `IPC` in
 * ipc.ts: the operator window's preload imports that object at runtime, and two sandboxed preloads
 * sharing a runtime module would make Rollup emit a shared chunk, which a sandboxed preload cannot
 * require (D9).
 */
export const PRINT_IPC = {
  getJob: "nazeer:print-window:get-job",
  ready: "nazeer:print-window:ready",
} as const;
