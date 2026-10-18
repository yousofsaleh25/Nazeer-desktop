/**
 * `/meta/labels`: the bilingual label of every code the engine emits (kinds, depth sources, flags,
 * rejections, candidate codes, statuses, buckets, targets, ground badges, confidence, job states,
 * and D12's comparison groups: why a session cannot join a comparison, why a comparison is stale,
 * a comparison's status).
 * The OpenAPI types it as a free object, so the shape is written out here and checked at runtime
 * (`parseLabels`). The UI never hard-codes these strings; a code missing from the payload renders
 * as the raw code (`labelOf` returns null), never as a blank.
 */
import { isRecord } from "./errors";

export interface LabelPair {
  ar: string;
  en: string;
}

export interface SeverityLabel extends LabelPair {
  severity: "warn" | "info";
}

export interface EngineLabels {
  kinds: Record<string, LabelPair>;
  input_kinds: Record<string, LabelPair>;
  sources: Record<string, LabelPair>;
  planes: Record<string, LabelPair>;
  flags: Record<string, SeverityLabel>;
  rejections: Record<string, LabelPair>;
  candidate_rejections: Record<string, LabelPair>;
  candidate_flags: Record<string, SeverityLabel>;
  statuses: Record<string, LabelPair>;
  buckets: Record<string, LabelPair>;
  targets: Record<string, LabelPair>;
  ground_badges: Record<string, LabelPair>;
  confidence: Record<string, LabelPair>;
  job_states: Record<string, LabelPair>;
  comparison_ineligible: Record<string, LabelPair>;
  comparison_stale: Record<string, LabelPair>;
  comparison_statuses: Record<string, LabelPair>;
  constants: Record<string, number>;
}

export type LabelGroup = Exclude<keyof EngineLabels, "constants">;

const PAIR_GROUPS = [
  "kinds",
  "input_kinds",
  "sources",
  "planes",
  "rejections",
  "candidate_rejections",
  "statuses",
  "buckets",
  "targets",
  "ground_badges",
  "confidence",
  "job_states",
  "comparison_ineligible",
  "comparison_stale",
  "comparison_statuses",
] as const satisfies readonly LabelGroup[];
const SEVERITY_GROUPS = ["flags", "candidate_flags"] as const satisfies readonly LabelGroup[];

export class LabelsInvalid extends Error {
  override name = "LabelsInvalid";
}

function pair(value: unknown, where: string): LabelPair {
  if (!isRecord(value) || typeof value["ar"] !== "string" || typeof value["en"] !== "string") {
    throw new LabelsInvalid(`${where}: expected {ar, en} strings`);
  }
  return { ar: value["ar"], en: value["en"] };
}

function group<T>(raw: Record<string, unknown>, name: string, item: (v: unknown, w: string) => T) {
  const value = raw[name];
  if (!isRecord(value)) throw new LabelsInvalid(`${name}: missing or not an object`);
  const out: Record<string, T> = {};
  for (const [code, entry] of Object.entries(value)) out[code] = item(entry, `${name}.${code}`);
  return out;
}

/** The payload, checked; throws LabelsInvalid naming the first problem. Unknown groups are kept out. */
export function parseLabels(raw: unknown): EngineLabels {
  if (!isRecord(raw)) throw new LabelsInvalid("labels: not an object");
  const out: Partial<EngineLabels> = {};
  for (const name of PAIR_GROUPS) out[name] = group(raw, name, pair);
  for (const name of SEVERITY_GROUPS) {
    out[name] = group(raw, name, (value, where) => {
      const severity = isRecord(value) ? value["severity"] : undefined;
      if (severity !== "warn" && severity !== "info") {
        throw new LabelsInvalid(`${where}: severity must be warn or info`);
      }
      return { ...pair(value, where), severity };
    });
  }
  out.constants = group(raw, "constants", (value, where) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new LabelsInvalid(`${where}: expected a finite number`);
    }
    return value;
  });
  return out as EngineLabels;
}

/** An engine constant from the payload (e.g. COMPARISON_MAX_SESSIONS), or null when not sent. */
export function constantOf(labels: EngineLabels | null, name: string): number | null {
  if (labels === null || !Object.hasOwn(labels.constants, name)) return null;
  return labels.constants[name] ?? null;
}

/** The label of `code` in `group`, or null when the engine sent none (render the raw code). */
export function labelOf(
  labels: EngineLabels | null,
  groupName: LabelGroup,
  code: string | null | undefined,
): LabelPair | null {
  if (labels === null || code === null || code === undefined || code === "") return null;
  const entry = Object.hasOwn(labels[groupName], code) ? labels[groupName][code] : undefined;
  return entry === undefined ? null : { ar: entry.ar, en: entry.en };
}
