/**
 * The report model as the print page reads it (`report_model_vN.json`, version 1.1): every label
 * and every number-bearing text is the engine's, so the page only lays them out (ADR-D7). The
 * OpenAPI does not type the file; this parser checks every field the page prints and refuses the
 * model with the path of the first wrong field, so a changed file never prints as blanks.
 */
import { PRINT_REPORT_MODEL_VERSION } from "@shared/ipc";

export interface Pair {
  ar: string;
  en: string;
}

export type Language = "ar" | "en" | "both";

export interface FlagChip extends Pair {
  code: string;
  severity: string;
}

export interface BasisEntry extends Pair {
  point: number | null;
}

export interface RejectionPart extends Pair {
  point: string | null;
  code: string;
}

export interface PrintRow {
  id: number;
  name: string;
  note: string;
  color: string | null;
  kindLabel: Pair;
  valueText: Pair;
  uncertaintyText: Pair;
  depthBasis: BasisEntry[];
  flags: FlagChip[];
  /** shown as a chip when it is not "high" */
  confidence: (Pair & { code: string }) | null;
  rejected: boolean;
  rejection: RejectionPart[];
  /** a 3D curve's 2D cross-check line */
  crossCheck: Pair | null;
  /** a 4-point angle's "between #a and #b" line */
  lines: Pair | null;
}

export interface RubricRow extends Pair {
  num: number;
  weight: number;
}

export interface Region extends Pair {
  num: number;
  bodyPartAr: string;
}

export interface ObservationField extends Pair {
  key: string;
  placeholder: string;
}

export interface SignatureWell extends Pair {
  id: string;
  name: string;
}

export const FRAME_ROW_KEYS = [
  "z_ref",
  "ground",
  "depth_bbox",
  "model",
  "intrinsics",
  "candidate",
] as const;

export type FrameRowKey = (typeof FRAME_ROW_KEYS)[number];

export interface PrintModel {
  schemaVersion: string;
  engineVersion: string;
  generatedAt: string;
  language: Language;
  names: Record<string, string>;
  observations: Record<string, string>;
  session: {
    sessionId: string;
    camelId: string;
    operator: string;
    notes: string;
    revision: number;
  };
  frame: {
    bagName: string;
    texts: Record<FrameRowKey | "source", Pair>;
  };
  overlay: { file: string; version: number; sha256: string; width: number; height: number };
  rows: PrintRow[];
  summary: { nMeasurements: number; snappedText: Pair; countsText: Pair };
  labels: {
    brand: Pair;
    title: Pair;
    certification: Pair[];
    disclaimer: Pair;
    headings: Record<string, Pair>;
    columns: Record<string, Pair>;
    sessionRows: Record<string, Pair>;
    frameRows: Record<FrameRowKey, Pair>;
    provenanceRows: Record<string, Pair>;
    rejected: Pair;
    signatureFields: { name: Pair; date: Pair };
  };
  rubric: { variantLabel: Pair; rows: RubricRow[]; totalWeight: number };
  regions: Region[];
  observationFields: ObservationField[];
  signatureWells: SignatureWell[];
  /** library name → version (the provenance footer) */
  versions: [string, string][];
}

export class ModelError extends Error {}

type Json = Record<string, unknown>;

function record(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ModelError(`${path} is not an object`);
  }
  return value as Json;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ModelError(`${path} is not a list`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") throw new ModelError(`${path} is not a string`);
  return value;
}

/** Operator text the engine stores as "" when empty; null is accepted as "" too. */
function optText(value: unknown, path: string): string {
  return value === null || value === undefined ? "" : text(value, path);
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ModelError(`${path} is not a number`);
  }
  return value;
}

function int(value: unknown, path: string): number {
  const n = number(value, path);
  if (!Number.isInteger(n)) throw new ModelError(`${path} is not an integer`);
  return n;
}

function pair(value: unknown, path: string): Pair {
  const r = record(value, path);
  return { ar: text(r["ar"], `${path}.ar`), en: text(r["en"], `${path}.en`) };
}

function pairs(value: unknown, path: string): Record<string, Pair> {
  const r = record(value, path);
  return Object.fromEntries(Object.entries(r).map(([key, v]) => [key, pair(v, `${path}.${key}`)]));
}

function strings(value: unknown, path: string): Record<string, string> {
  const r = record(value, path);
  return Object.fromEntries(Object.entries(r).map(([key, v]) => [key, text(v, `${path}.${key}`)]));
}

function row(value: unknown, path: string): PrintRow {
  const r = record(value, path);
  const confidence = r["confidence_label"];
  const curve = r["curve"];
  const lines = r["lines"];
  return {
    id: int(r["id"], `${path}.id`),
    name: optText(r["name"], `${path}.name`),
    note: optText(r["note"], `${path}.note`),
    color: r["display_color"] === null ? null : text(r["display_color"], `${path}.display_color`),
    kindLabel: pair(r["kind_label"], `${path}.kind_label`),
    valueText: pair(r["value_text"], `${path}.value_text`),
    uncertaintyText: pair(r["uncertainty_text"], `${path}.uncertainty_text`),
    depthBasis: list(r["depth_basis"], `${path}.depth_basis`).map((entry, i) => {
      const at = `${path}.depth_basis[${i}]`;
      const point = record(entry, at)["point"];
      return { ...pair(entry, at), point: point === null ? null : int(point, `${at}.point`) };
    }),
    flags: list(r["flags"], `${path}.flags`).map((chip, i) => {
      const at = `${path}.flags[${i}]`;
      const c = record(chip, at);
      return {
        ...pair(chip, at),
        code: text(c["code"], `${at}.code`),
        severity: text(c["severity"], `${at}.severity`),
      };
    }),
    confidence:
      confidence === null || confidence === undefined
        ? null
        : {
            ...pair(confidence, `${path}.confidence_label`),
            code: text(record(confidence, path)["code"], `${path}.confidence_label.code`),
          },
    rejected: r["rejected"] === true,
    rejection: list(r["rejection"], `${path}.rejection`).map((part, i) => {
      const at = `${path}.rejection[${i}]`;
      const p = record(part, at);
      return {
        ...pair(part, at),
        code: text(p["code"], `${at}.code`),
        point: p["point"] === null ? null : text(p["point"], `${at}.point`),
      };
    }),
    crossCheck:
      curve === undefined ||
      curve === null ||
      record(curve, `${path}.curve`)["cross_check_2d_m"] === null
        ? null
        : pair(
            record(curve, `${path}.curve`)["cross_check_text"],
            `${path}.curve.cross_check_text`,
          ),
    lines:
      lines === undefined || lines === null
        ? null
        : pair(record(lines, `${path}.lines`)["text"], `${path}.lines.text`),
  };
}

function language(value: unknown): Language {
  if (value === "ar" || value === "en" || value === "both") return value;
  throw new ModelError("inputs.language is not ar, en or both");
}

/** The print model, or a ModelError naming the first field that is missing or wrong. */
export function parsePrintModel(raw: unknown): PrintModel {
  const m = record(raw, "model");
  const schemaVersion = text(m["report_model_version"], "report_model_version");
  if (schemaVersion !== PRINT_REPORT_MODEL_VERSION) {
    throw new ModelError(
      `report model ${schemaVersion}: this print page lays out version ${PRINT_REPORT_MODEL_VERSION}`,
    );
  }
  const inputs = record(m["inputs"], "inputs");
  const session = record(m["session"], "session");
  const frame = record(m["frame"], "frame");
  const texts = record(frame["texts"], "frame.texts");
  const overlay = record(m["overlay"], "overlay");
  const summary = record(m["summary"], "summary");
  const st = record(m["static"], "static");
  const rubric = record(st["rubric"], "static.rubric");
  const certification = record(st["certification"], "static.certification");
  const certAr = list(certification["ar"], "static.certification.ar");
  const certEn = list(certification["en"], "static.certification.en");
  if (certAr.length !== certEn.length) {
    throw new ModelError("static.certification has different Arabic and English line counts");
  }
  const frameRows = pairs(st["frame_rows"], "static.frame_rows");
  const frameTexts: Record<string, Pair> = {};
  for (const key of [...FRAME_ROW_KEYS, "source"] as const) {
    frameTexts[key] = pair(texts[key], `frame.texts.${key}`);
    if (key !== "source" && frameRows[key] === undefined) {
      throw new ModelError(`static.frame_rows.${key} is missing`);
    }
  }
  const signatureFields = record(st["signature_fields"], "static.signature_fields");
  const versions = record(m["versions"] ?? {}, "versions");
  return {
    schemaVersion,
    engineVersion: text(m["engine_version"], "engine_version"),
    generatedAt: text(m["generated_at"], "generated_at"),
    language: language(inputs["language"]),
    names: strings(inputs["names"] ?? {}, "inputs.names"),
    observations: strings(inputs["observations"] ?? {}, "inputs.observations"),
    session: {
      sessionId: text(session["session_id"], "session.session_id"),
      camelId: optText(session["camel_id"], "session.camel_id"),
      operator: optText(session["operator"], "session.operator"),
      notes: optText(session["notes"], "session.notes"),
      revision: int(session["revision"], "session.revision"),
    },
    frame: {
      bagName: optText(frame["bag_name"], "frame.bag_name"),
      texts: frameTexts,
    },
    overlay: {
      file: text(overlay["file"], "overlay.file"),
      version: int(overlay["version"], "overlay.version"),
      sha256: text(overlay["sha256"], "overlay.sha256"),
      width: int(overlay["width"], "overlay.width"),
      height: int(overlay["height"], "overlay.height"),
    },
    rows: list(m["measurements"], "measurements").map((r, i) => row(r, `measurements[${i}]`)),
    summary: {
      nMeasurements: int(summary["n_measurements"], "summary.n_measurements"),
      snappedText: pair(summary["snapped_text"], "summary.snapped_text"),
      countsText: pair(summary["counts_text"], "summary.counts_text"),
    },
    labels: {
      brand: pair(st["brand"], "static.brand"),
      title: pair(st["title"], "static.title"),
      certification: certAr.map((ar, i) => ({
        ar: text(ar, `static.certification.ar[${i}]`),
        en: text(certEn[i], `static.certification.en[${i}]`),
      })),
      disclaimer: pair(st["disclaimer"], "static.disclaimer"),
      headings: pairs(st["headings"], "static.headings"),
      columns: pairs(st["columns"], "static.columns"),
      sessionRows: pairs(st["session_rows"], "static.session_rows"),
      frameRows,
      provenanceRows: pairs(st["provenance_rows"], "static.provenance_rows"),
      rejected: pair(st["rejected"], "static.rejected"),
      signatureFields: {
        name: pair(signatureFields["name"], "static.signature_fields.name"),
        date: pair(signatureFields["date"], "static.signature_fields.date"),
      },
    },
    rubric: {
      variantLabel: pair(rubric["variant_label"], "static.rubric.variant_label"),
      rows: list(rubric["rows"], "static.rubric.rows").map((r, i) => {
        const at = `static.rubric.rows[${i}]`;
        const v = record(r, at);
        return {
          ...pair(r, at),
          num: int(v["num"], `${at}.num`),
          weight: number(v["weight"], `${at}.weight`),
        };
      }),
      totalWeight: number(rubric["total_weight"], "static.rubric.total_weight"),
    },
    regions: list(st["regions_27"], "static.regions_27").map((r, i) => {
      const at = `static.regions_27[${i}]`;
      const v = record(r, at);
      return {
        ...pair(r, at),
        num: int(v["num"], `${at}.num`),
        bodyPartAr: text(v["body_part_ar"], `${at}.body_part_ar`),
      };
    }),
    observationFields: list(st["observation_fields"], "static.observation_fields").map((f, i) => {
      const at = `static.observation_fields[${i}]`;
      const v = record(f, at);
      return {
        ...pair(f, at),
        key: text(v["key"], `${at}.key`),
        placeholder: optText(v["placeholder"], `${at}.placeholder`),
      };
    }),
    signatureWells: list(m["signature_wells"], "signature_wells").map((w, i) => {
      const at = `signature_wells[${i}]`;
      const v = record(w, at);
      return {
        ...pair(w, at),
        id: text(v["id"], `${at}.id`),
        name: optText(v["name"], `${at}.name`),
      };
    }),
    versions: Object.entries(versions)
      .filter((entry): entry is [string, string | number] => {
        const value = entry[1];
        return (typeof value === "string" && value.length > 0) || typeof value === "number";
      })
      .map(([key, value]): [string, string] => [key, String(value)])
      .filter(([, value]) => value.length <= 80)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}
