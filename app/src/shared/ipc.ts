/**
 * The window.nazeer bridge: channel names and payload types shared by main, the preloads and the
 * renderer. Grows stage by stage (Stage 1: engine connection + status; Stage 4: supervisor status,
 * dialogs, capture-folder scan, quit handshake, log folder; Stage 7: print). Main validates every
 * payload it receives (src/shared/ipcValidate.ts). The hidden print window's own channels are in
 * printChannels.ts: each sandboxed preload must stay one file, so the two preloads share no runtime
 * module (D9).
 */

export const IPC = {
  engineGetConnection: "nazeer:engine:get-connection",
  engineGetStatus: "nazeer:engine:get-status",
  engineRetry: "nazeer:engine:retry",
  engineStatus: "nazeer:engine:status",
  dialogOpenBag: "nazeer:dialog:open-bag",
  dialogPickFolder: "nazeer:dialog:pick-folder",
  scanCaptureFolders: "nazeer:scan:capture-folders",
  scanSetFolders: "nazeer:scan:set-folders",
  appBeforeQuit: "nazeer:app:before-quit",
  appQuitAck: "nazeer:app:quit-ack",
  appOpenLogFolder: "nazeer:app:open-log-folder",
  licenseGetStatus: "nazeer:license:get-status",
  licenseActivate: "nazeer:license:activate",
  printExportPdf: "nazeer:print:export-pdf",
} as const;

/** Licence keys (D11): what a verified (or, when expired, decoded) key says. */
export type LicenseKind = "trial" | "permanent";
export type LicenseReason = "malformed" | "bad_signature" | "expired";

export interface LicenseInfo {
  kind: LicenseKind;
  customer: string | null;
  /** `YYYY-MM-DDTHH:MM:SSZ`; null for a permanent key */
  expires: string | null;
  issued: string;
  /** first 16 hex of the key's SHA-256 (support reference; the key itself is never shown) */
  fingerprint: string;
}

export interface LicenseStatus {
  /** false in development builds unless NAZEER_LICENSE_ENFORCE=1 */
  required: boolean;
  state: "active" | "inactive";
  /** why the stored key is not active; null when active or when no key was stored */
  reason: LicenseReason | null;
  license: LicenseInfo | null;
  /** the key verified but could not be saved: this session runs, the next start asks again */
  notSaved: boolean;
  /** this build has no licence public key (development builds only; packaging refuses it) */
  configError: "license_not_configured" | null;
}

export interface ActivationResult {
  accepted: boolean;
  /** why the entered key was refused */
  reason: LicenseReason | null;
  /** English detail for the log and support */
  detail: string;
  /** the entered key's licence when it decoded (e.g. the date of an expired trial) */
  license: LicenseInfo | null;
  /** the licence state after the attempt */
  status: LicenseStatus;
}

export type EngineStatusName = "starting" | "ready" | "restarting" | "fatal" | "stopping";

/** What the renderer needs to talk to the engine sidecar (null until the engine is ready). */
export interface EngineConnection {
  baseUrl: string;
  port: number;
  token: string;
  /** the engine interpreter's pid from the ready line (not the spawned launcher's) */
  pid: number;
  dataRoot: string;
  engineVersion: string;
  modelFile: string | null;
  modelSha256: string | null;
  stubModel: boolean;
  warmupMs: number | null;
  arabicStackOk: boolean;
  appVersion: string;
  electron: string;
  chromium: string;
  /** the folder holding the supervisor's log (engine stderr + lifecycle lines) */
  logDir: string;
}

/** A sidecar failure the operator must see (exit codes 2/3/5/6, start timeout, missing exe). */
export interface EngineFatal {
  code: string;
  message: string;
  details: Record<string, unknown>;
  exitCode: number | null;
}

export interface EngineStatusEvent {
  /** increases with every status change; a reply older than an event already applied is dropped */
  seq: number;
  status: EngineStatusName;
  connection: EngineConnection | null;
  fatal: EngineFatal | null;
  /** restarts after a crash since the app started */
  restarts: number;
  /** the soft /health watchdog failed twice in a row (the engine is kept running) */
  unresponsive: boolean;
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

/** The result of scanning the configured capture folders. */
export interface CaptureScan {
  folders: string[];
  bags: ScannedBag[];
  /** a depth, entry, count or time limit cut the scan short */
  truncated: boolean;
  elapsedMs: number;
  errors: { folder: string; message: string }[];
}

/** The renderer's answer to "the app is closing": did it flush everything? */
export interface QuitAck {
  requestId: number;
  /** true when changes could not be saved (main then asks the operator before quitting) */
  unsaved: boolean;
}

export type BeforeQuitHandler = () => Promise<{ unsaved: boolean }> | { unsaved: boolean };

/** Upper bound for the approved overlay bytes sent to main for printing. */
export const MAX_OVERLAY_BYTES = 32 * 1024 * 1024;

/**
 * What the renderer sends to print and seal a report (`print.exportPdf`): the approved overlay
 * version, its SHA-256 and the exact bytes the operator approved, and the report model version /
 * SHA-256 the page renders (validateExportRequest).
 */
export interface ExportRequest {
  sessionId: string;
  overlay: { version: number; sha256: string; bytes: Uint8Array };
  reportModel: { version: number; sha256: string };
}

/** The report model the print page lays out: 1.1 carries every text the page prints. */
export const PRINT_REPORT_MODEL_VERSION = "1.1";

/** What main hands the hidden print page (ADR-D7): everything it typesets, as data. */
export interface PrintJob {
  /** the report model exactly as the engine wrote it (the page checks its shape) */
  model: unknown;
  reportModel: { version: number; sha256: string };
  /** the approved overlay: the bytes the operator approved, re-hashed in main */
  overlay: { version: number; sha256: string; bytes: Uint8Array<ArrayBuffer> };
  /** the engine's pinned IBM Plex Sans Arabic Regular (the face the overlay was drawn with) */
  font: { sha256: string; bytes: Uint8Array<ArrayBuffer> };
  /** the engine's logo, when it has one */
  logo: Uint8Array<ArrayBuffer> | null;
  /** SessionView.required_report_texts: the strings the engine's text probe looks for */
  requiredTexts: string[];
}

export interface PreflightProblem {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/** The print page's own checks, after its face and images are ready (print/preflight.ts). */
export interface PrintPreflight {
  /** false when a problem stops the print */
  ok: boolean;
  problems: PreflightProblem[];
  /** recorded and shown, printed anyway (a character in a note that the face lacks) */
  warnings: PreflightProblem[];
  checked: { requiredTexts: number; textNodes: number; characters: number; images: number };
}

/** A failed export: the engine's error envelope, or an app-side code (status null). */
export interface ExportError {
  status: number | null;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/** What `print.exportPdf` resolves to; an expected failure resolves too, with `ok: false`. */
export type ExportResult =
  | {
      ok: true;
      /** the engine's answer to the upload: the session view and the probe (verdict PASS) */
      session: unknown;
      probe: unknown;
      preflight: PrintPreflight;
      pdfBytes: number;
      timingsMs: Record<string, number>;
    }
  | {
      ok: false;
      error: ExportError;
      /** the engine's probe when it refused the PDF (DRIFT), else null */
      probe: unknown;
      preflight: PrintPreflight | null;
      timingsMs: Record<string, number>;
    };

/** The hidden print window's bridge (`window.nazeerPrint`, preload/print.ts). */
export interface NazeerPrintApi {
  /** The job main prepared for this window (once). */
  getJob(): Promise<PrintJob>;
  /** The page is laid out, its face and images are ready, and its checks ran. */
  ready(result: PrintPreflight): Promise<void>;
}

export interface NazeerApi {
  engine: {
    getConnection(): Promise<EngineConnection | null>;
    getStatus(): Promise<EngineStatusEvent>;
    /** After a fatal start: try again (no-op in any other state). */
    retry(): Promise<void>;
    /** Subscribe to supervisor status changes; returns the unsubscribe function. */
    onStatus(listener: (event: EngineStatusEvent) => void): () => void;
  };
  dialogs: {
    /** The OS file dialog filtered to .bag; null when cancelled. */
    openBag(): Promise<string | null>;
    /** The OS folder dialog; null when cancelled. */
    pickFolder(): Promise<string | null>;
  };
  scan: {
    /** Scan the configured capture folders (bounded: depth, entries, bags, time; no links). */
    captureFolders(): Promise<CaptureScan>;
    /** Replace the configured capture folders; returns the stored list. */
    setFolders(folders: string[]): Promise<string[]>;
  };
  app: {
    /** One handler (the last registered wins); it flushes unsaved work before the app quits. */
    onBeforeQuit(handler: BeforeQuitHandler): () => void;
    openLogFolder(): Promise<void>;
  };
  license: {
    getStatus(): Promise<LicenseStatus>;
    /** Verify a pasted key in main; on success it is stored and the engine starts. */
    activate(key: string): Promise<ActivationResult>;
  };
  print: {
    /** Print the report with the approved overlay in a hidden window and have the engine seal
     * it (main, ADR-D7). One export at a time. */
    exportPdf(request: ExportRequest): Promise<ExportResult>;
  };
}
