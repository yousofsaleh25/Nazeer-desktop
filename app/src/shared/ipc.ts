/**
 * The window.nazeer bridge: channel names and payload types shared by main, the preloads and the
 * renderer. Grows stage by stage (Stage 1: engine connection + status; Stage 4: dialogs, scan,
 * app lifecycle; Stage 7: print). Main validates every payload it receives.
 */

export const IPC = {
  engineGetConnection: "nazeer:engine:get-connection",
  engineStatus: "nazeer:engine:status",
} as const;

export type EngineStatusName = "starting" | "ready" | "restarting" | "fatal" | "stopping";

/** What the renderer needs to talk to the engine sidecar (null until the engine is ready). */
export interface EngineConnection {
  baseUrl: string;
  port: number;
  token: string;
  pid: number;
  dataRoot: string;
  engineVersion: string;
  stubModel: boolean;
  arabicStackOk: boolean;
  appVersion: string;
  electron: string;
  chromium: string;
}

/** A sidecar failure the operator must see (exit codes 2/3/5/6, start timeout, missing exe). */
export interface EngineFatal {
  code: string;
  message: string;
  details: Record<string, unknown>;
  exitCode: number | null;
}

export interface EngineStatusEvent {
  status: EngineStatusName;
  connection: EngineConnection | null;
  fatal: EngineFatal | null;
  restarts: number;
}

/** One .bag file the bounded capture-folder scan found (main process; path and stat only). */
export interface ScannedBag {
  path: string;
  name: string;
  sizeBytes: number;
  /** ISO 8601 */
  modifiedAt: string;
  /** the configured capture folder it was found under */
  folder: string;
}

/** The result of scanning the configured capture folders (Stage 4 implements the scan). */
export interface CaptureScan {
  folders: string[];
  bags: ScannedBag[];
  /** a depth, entry, count or time limit cut the scan short */
  truncated: boolean;
  elapsedMs: number;
  errors: { folder: string; message: string }[];
}

export interface NazeerApi {
  engine: {
    getConnection(): Promise<EngineConnection | null>;
    /** Subscribe to supervisor status changes; returns the unsubscribe function. */
    onStatus(listener: (event: EngineStatusEvent) => void): () => void;
  };
}
