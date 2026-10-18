/**
 * Hand-made states the captured fixtures do not contain (a walk in progress, a failed walk, a
 * capture-folder scan, a DRIFT probe, History rows in every index state), for the /design gallery
 * and the tests. Built from the real fixtures where possible; typed with the API types. Never
 * used by the app at runtime.
 */
import type { CaptureScan, EngineConnection } from "@shared/ipc";
import type { BagInfo, HistoryRow, HistoryStats, JobSnapshot } from "@/api/types";
import { fixtures } from "./fixtures";

const set = fixtures.candidateSet;
const exported = fixtures.historyList.items[0]!;

export const sampleConnection: EngineConnection = {
  baseUrl: "http://127.0.0.1:51234",
  port: 51234,
  token: "0".repeat(64),
  pid: 36760,
  dataRoot: fixtures.meta.data_root,
  engineVersion: "0.1.0",
  modelFile: fixtures.health.model.file,
  modelSha256: fixtures.health.model.sha256,
  stubModel: true,
  warmupMs: null,
  arabicStackOk: true,
  appVersion: "0.1.0",
  electron: "44.4.5",
  chromium: "152.0.0.0",
  logDir: String.raw`C:\Users\operator\AppData\Roaming\Nazeer Desktop\logs`,
};

export const sampleBag: BagInfo = {
  ...(set.bag as BagInfo),
  cached_candidate_sets: [set.params_hash],
};

const jobBase: JobSnapshot = {
  job_id: "6bb3885fade3",
  bag_path: sampleBag.path,
  fingerprint: set.fingerprint,
  params_hash: set.params_hash,
  state: "running",
  stage: "walking",
  progress_fraction: 0.62,
  counters: {
    read: 1086,
    sampled: 217,
    detected: 211,
    passed: 139,
    rejected_by_reason: {
      no_detection: 6,
      mask_area_out_of_range: 9,
      mask_cut_by_frame: 51,
      z_median_below_min: 12,
      valid_frac_too_low: 0,
    },
  },
  eta_s: 14.2,
  elapsed_s: 23.3,
  message: "",
  warnings: [],
  error: null,
  result: null,
  started_at: "2026-10-11T15:29:17+00:00",
  finished_at: null,
  terminal: false,
};

export const sampleJobs = {
  running: jobBase,
  slowMedia: {
    ...jobBase,
    progress_fraction: 0.18,
    warnings: ["slow_media: first 200 MB read at 212 MB/s (below 300 MB/s); removable media?"],
  },
  done: {
    ...jobBase,
    state: "done",
    stage: "done",
    progress_fraction: 1,
    counters: {
      read: 1751,
      sampled: 351,
      detected: 342,
      passed: 225,
      rejected_by_reason: set.rejected_by_reason,
    },
    eta_s: null,
    elapsed_s: 37.5,
    finished_at: "2026-10-11T15:29:54+00:00",
    terminal: true,
  },
  failed: {
    ...jobBase,
    state: "failed",
    stage: "walking",
    progress_fraction: 0.31,
    eta_s: null,
    error: {
      code: "bag_read_stalled",
      message: "no frame arrived for 2000 ms after 3 retries",
      details: { position_fraction: 0.31, retries: 3 },
    },
    finished_at: "2026-10-11T15:29:30+00:00",
    terminal: true,
  },
} satisfies Record<string, JobSnapshot>;

export const sampleScan: CaptureScan = {
  folders: ["D:\\captures", "E:\\camel_beauty\\nazeer-desktop\\data\\.bag"],
  bags: [
    {
      path: sampleBag.path,
      name: sampleBag.name,
      sizeBytes: sampleBag.size_bytes,
      modifiedAt: "2026-04-14T17:57:57+00:00",
      folder: "E:\\camel_beauty\\nazeer-desktop\\data\\.bag",
    },
    {
      path: "D:\\captures\\اختبار\\20260414_181203-007.bag",
      name: "20260414_181203-007.bag",
      sizeBytes: 3_912_004_120,
      modifiedAt: "2026-04-14T18:12:03+00:00",
      folder: "D:\\captures",
    },
  ],
  truncated: true,
  elapsedMs: 3000,
  errors: [{ folder: "F:\\usb", message: "drive not ready" }],
};

/** The real PASS probe turned into a DRIFT: one name's run missing and a synthesized bold face. */
export function sampleProbeDrift(): Record<string, unknown> {
  const probe = structuredClone(fixtures.probePass) as Record<string, unknown>;
  const text = probe["text"] as {
    ok: boolean;
    n_missing: number;
    names: { ok: boolean; runs: { found: boolean }[] }[];
  };
  const fonts = probe["fonts"] as { ok: boolean; type3_present: boolean; fonts: string[] };
  text.ok = false;
  text.n_missing = 1;
  const first = text.names[0]!;
  first.ok = false;
  first.runs[1]!.found = false;
  fonts.ok = false;
  fonts.type3_present = true;
  fonts.fonts = [...fonts.fonts, "/Type3 (synthesized bold)"];
  return {
    ...probe,
    verdict: "DRIFT",
    hard_failures: ["text_probe_failed", "font_probe_failed"],
    hints: ["synthesized_face"],
  };
}

export const sampleHistoryRows: HistoryRow[] = [
  exported,
  {
    ...exported,
    session_id: "20261012_091500_a1b2c3",
    camel_id: "Shaqha-12",
    operator: "Operator 2",
    status: "open",
    revision: 3,
    n_measurements: 4,
    n_rejected: 1,
    overlay_version: 0,
    report_version: 0,
    updated_at: "2026-10-12T09:21:44+00:00",
  },
  {
    ...exported,
    session_id: "20261012_101010_d4e5f6",
    camel_id: "",
    status: "finalized",
    outputs_stale: false,
    report_stale: true,
    updated_at: "2026-10-12T10:31:02+00:00",
  },
  {
    ...exported,
    session_id: "20261010_120000_0a0b0c",
    camel_id: "جمل-قديم",
    index_state: "missing_files",
    thumb_url: null,
  },
  {
    ...exported,
    session_id: "20261009_080000_ffeedd",
    camel_id: "",
    status: "open",
    index_state: "corrupt",
    index_error: "session.json: Expecting value: line 1 column 1 (char 0)",
    thumb_url: null,
    n_measurements: 0,
  },
];

export const sampleStats: HistoryStats = {
  sessions: { count: 4, bytes: 21_533_102 },
  comparisons: { count: 1, bytes: 3_412_885 },
  candidates: { count: 1, bytes: 60_877_210 },
  trash: { count: 1, bytes: 5_120_331 },
  index: { rows: 5, by_index_state: { ok: 3, missing_files: 1, corrupt: 1 }, db_bytes: 40_960 },
  backups: { count: 2, bytes: 81_920 },
};
