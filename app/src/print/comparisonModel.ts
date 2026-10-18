/**
 * The comparison model as the print page reads it (`comparison_model_vN.json`, version 1.0; D12
 * F2.6): the engine matched the rows and composed every text, so the page only lays them out. The
 * model carries texts only — no value the page could sort, subtract or total. As for the report
 * model, every field the page prints is checked and a wrong one is named by its path.
 */
import { PRINT_COMPARISON_MODEL_VERSION } from "@shared/ipc";
import {
  certification,
  confidenceLabel,
  depthBasis,
  flagChips,
  int,
  language,
  list,
  ModelError,
  optText,
  pair,
  pairs,
  record,
  rejectionParts,
  signatureWells,
  text,
  versionList,
  type BasisEntry,
  type FlagChip,
  type Language,
  type Pair,
  type RejectionPart,
  type SignatureWell,
} from "./model";

/** What one camel shows for one measurement (the texts of its own report). */
export interface ComparisonCell {
  measurementId: number;
  /** null when rejected */
  valueText: Pair | null;
  uncertaintyText: Pair | null;
  /** "k of n points snapped to the camel (KNN)" for a 3D row with snapped points */
  depthNote: Pair | null;
  flags: FlagChip[];
  /** shown when the confidence is not high */
  confidence: (Pair & { code: string }) | null;
  rejected: boolean;
  rejection: RejectionPart[];
}

export interface ComparisonTableRow {
  rowId: number;
  /** the operator's name as written; "" for an unnamed measurement */
  name: string;
  /** the engine's text for the name cell (an unnamed measurement's label and number) */
  nameText: Pair;
  unnamed: boolean;
  kindLabel: Pair;
  /** "(k/n)" when a camel has the same name and kind more than once (Q4) */
  occurrenceText: Pair | null;
  /** one per camel, in the operator's order; null = that camel has no such measurement */
  cells: (ComparisonCell | null)[];
}

/** One measurement of a camel's own section (the texts of its report). */
export interface MemberRow {
  id: number;
  name: string;
  note: string;
  color: string | null;
  kindLabel: Pair;
  valueText: Pair | null;
  uncertaintyText: Pair | null;
  depthBasis: BasisEntry[];
  depthNote: Pair | null;
  flags: FlagChip[];
  confidence: (Pair & { code: string }) | null;
  rejected: boolean;
  rejection: RejectionPart[];
  /** a 3D curve's 2D cross-check, or a 4-point angle's lines */
  detail: Pair | null;
}

export interface ComparisonPrintMember {
  position: number;
  sessionId: string;
  camelId: string;
  overlay: { file: string; version: number; sha256: string; width: number; height: number };
  frame: { zRef: Pair; ground: Pair };
  rows: MemberRow[];
  summary: { snappedText: Pair; countsText: Pair };
  texts: {
    heading: Pair;
    status: Pair;
    source: Pair;
    provenance: { overlay: Pair; reportModel: Pair; session: Pair };
  };
}

export interface ComparisonPrintModel {
  schemaVersion: string;
  version: number;
  engineVersion: string;
  generatedAt: string;
  comparisonId: string;
  createdAt: string;
  language: Language;
  cover: { title: string; event: string; judge: string; council: string; titleText: Pair };
  members: ComparisonPrintMember[];
  rows: ComparisonTableRow[];
  signatureWells: SignatureWell[];
  labels: {
    brand: Pair;
    title: Pair;
    certification: Pair[];
    disclaimers: Pair[];
    headings: Record<string, Pair>;
    columns: Record<string, Pair>;
    coverRows: Record<string, Pair>;
    frameRows: { zRef: Pair; ground: Pair };
    provenanceRows: Record<string, Pair>;
    signatureFields: { name: Pair; date: Pair };
    rejected: Pair;
    missing: Pair;
  };
  versions: [string, string][];
}

function optPair(value: unknown, path: string): Pair | null {
  return value === null || value === undefined ? null : pair(value, path);
}

function cell(value: unknown, path: string): ComparisonCell | null {
  if (value === null) return null;
  const c = record(value, path);
  return {
    measurementId: int(c["measurement_id"], `${path}.measurement_id`),
    valueText: optPair(c["value_text"], `${path}.value_text`),
    uncertaintyText: optPair(c["uncertainty_text"], `${path}.uncertainty_text`),
    depthNote: optPair(c["depth_note"], `${path}.depth_note`),
    flags: flagChips(c["flags"], `${path}.flags`),
    confidence: confidenceLabel(c["confidence"], `${path}.confidence`),
    rejected: c["rejected"] === true,
    rejection: rejectionParts(c["rejection"], `${path}.rejection`),
  };
}

function memberRow(value: unknown, path: string): MemberRow {
  const r = record(value, path);
  const color = r["color"];
  return {
    id: int(r["measurement_id"], `${path}.measurement_id`),
    name: optText(r["name"], `${path}.name`),
    note: optText(r["note"], `${path}.note`),
    color: typeof color === "string" && color !== "" ? color : null,
    kindLabel: pair(r["kind_label"], `${path}.kind_label`),
    valueText: optPair(r["value_text"], `${path}.value_text`),
    uncertaintyText: optPair(r["uncertainty_text"], `${path}.uncertainty_text`),
    depthBasis: depthBasis(r["depth_basis"], `${path}.depth_basis`),
    depthNote: optPair(r["depth_note"], `${path}.depth_note`),
    flags: flagChips(r["flags"], `${path}.flags`),
    confidence: confidenceLabel(r["confidence"], `${path}.confidence`),
    rejected: r["rejected"] === true,
    rejection: rejectionParts(r["rejection"], `${path}.rejection`),
    detail: optPair(r["detail"], `${path}.detail`),
  };
}

function member(value: unknown, index: number): ComparisonPrintMember {
  const path = `members[${index}]`;
  const m = record(value, path);
  const position = int(m["position"], `${path}.position`);
  if (position !== index + 1) {
    throw new ModelError(`${path}.position is ${position}, not ${index + 1}`);
  }
  const overlay = record(m["overlay"], `${path}.overlay`);
  const frameTexts = record(record(m["frame"], `${path}.frame`)["texts"], `${path}.frame.texts`);
  const summary = record(m["summary"], `${path}.summary`);
  const texts = record(m["texts"], `${path}.texts`);
  const provenance = record(texts["provenance"], `${path}.texts.provenance`);
  return {
    position,
    sessionId: text(m["session_id"], `${path}.session_id`),
    camelId: optText(m["camel_id"], `${path}.camel_id`),
    overlay: {
      file: text(overlay["file"], `${path}.overlay.file`),
      version: int(overlay["version"], `${path}.overlay.version`),
      sha256: text(overlay["sha256"], `${path}.overlay.sha256`),
      width: int(overlay["width"], `${path}.overlay.width`),
      height: int(overlay["height"], `${path}.overlay.height`),
    },
    frame: {
      zRef: pair(frameTexts["z_ref"], `${path}.frame.texts.z_ref`),
      ground: pair(frameTexts["ground"], `${path}.frame.texts.ground`),
    },
    rows: list(m["rows"], `${path}.rows`).map((r, i) => memberRow(r, `${path}.rows[${i}]`)),
    summary: {
      snappedText: pair(summary["snapped_text"], `${path}.summary.snapped_text`),
      countsText: pair(summary["counts_text"], `${path}.summary.counts_text`),
    },
    texts: {
      heading: pair(texts["heading"], `${path}.texts.heading`),
      status: pair(texts["status"], `${path}.texts.status`),
      source: pair(texts["source"], `${path}.texts.source`),
      provenance: {
        overlay: pair(provenance["overlay"], `${path}.texts.provenance.overlay`),
        reportModel: pair(provenance["report_model"], `${path}.texts.provenance.report_model`),
        session: pair(provenance["session"], `${path}.texts.provenance.session`),
      },
    },
  };
}

function tableRow(value: unknown, index: number, nMembers: number): ComparisonTableRow {
  const path = `rows[${index}]`;
  const r = record(value, path);
  const cells = list(r["cells"], `${path}.cells`);
  if (cells.length !== nMembers) {
    throw new ModelError(`${path}.cells has ${cells.length} cells for ${nMembers} camels`);
  }
  return {
    rowId: int(r["row_id"], `${path}.row_id`),
    name: optText(r["name"], `${path}.name`),
    nameText: pair(r["name_text"], `${path}.name_text`),
    unnamed: r["unnamed"] === true,
    kindLabel: pair(r["kind_label"], `${path}.kind_label`),
    occurrenceText: optPair(r["occurrence_text"], `${path}.occurrence_text`),
    cells: cells.map((c, i) => cell(c, `${path}.cells[${i}]`)),
  };
}

/** The comparison print model, or a ModelError naming the first field that is missing or wrong. */
export function parseComparisonModel(raw: unknown): ComparisonPrintModel {
  const m = record(raw, "model");
  const schemaVersion = text(m["comparison_model_version"], "comparison_model_version");
  if (schemaVersion !== PRINT_COMPARISON_MODEL_VERSION) {
    throw new ModelError(
      `comparison model ${schemaVersion}: this print page lays out version ` +
        PRINT_COMPARISON_MODEL_VERSION,
    );
  }
  const cover = record(m["cover"], "cover");
  const members = list(m["members"], "members").map(member);
  if (members.length === 0) throw new ModelError("members is empty");
  const st = record(m["static"], "static");
  const frameRows = record(st["frame_rows"], "static.frame_rows");
  const signatureFields = record(st["signature_fields"], "static.signature_fields");
  const disclaimers = list(st["disclaimers"], "static.disclaimers").map((d, i) =>
    pair(d, `static.disclaimers[${i}]`),
  );
  return {
    schemaVersion,
    version: int(m["version"], "version"),
    engineVersion: text(m["engine_version"], "engine_version"),
    generatedAt: text(m["generated_at"], "generated_at"),
    comparisonId: text(m["comparison_id"], "comparison_id"),
    createdAt: text(m["created_at"], "created_at"),
    language: language(m["language"], "language"),
    cover: {
      title: optText(cover["title"], "cover.title"),
      event: optText(cover["event"], "cover.event"),
      judge: optText(cover["judge"], "cover.judge"),
      council: optText(cover["council"], "cover.council"),
      titleText: pair(cover["title_text"], "cover.title_text"),
    },
    members,
    rows: list(m["rows"], "rows").map((r, i) => tableRow(r, i, members.length)),
    signatureWells: signatureWells(m["signature_wells"], "signature_wells"),
    labels: {
      brand: pair(st["brand"], "static.brand"),
      title: pair(st["title"], "static.title"),
      certification: certification(st["certification"], "static.certification"),
      disclaimers,
      headings: pairs(st["headings"], "static.headings"),
      columns: pairs(st["columns"], "static.columns"),
      coverRows: pairs(st["cover_rows"], "static.cover_rows"),
      frameRows: {
        zRef: pair(frameRows["z_ref"], "static.frame_rows.z_ref"),
        ground: pair(frameRows["ground"], "static.frame_rows.ground"),
      },
      provenanceRows: pairs(st["provenance_rows"], "static.provenance_rows"),
      signatureFields: {
        name: pair(signatureFields["name"], "static.signature_fields.name"),
        date: pair(signatureFields["date"], "static.signature_fields.date"),
      },
      rejected: pair(st["rejected"], "static.rejected"),
      missing: pair(st["missing"], "static.missing"),
    },
    versions: versionList(m["versions"]),
  };
}

/** Camel columns per block of the comparison table: fewer when each cell holds both languages. */
export function columnsPerBlock(lang: Language): number {
  return lang === "both" ? 4 : 6;
}

/** Member indexes in blocks of at most `size`, in the operator's order. */
export function columnBlocks(nMembers: number, size: number): number[][] {
  const blocks: number[][] = [];
  for (let start = 0; start < nMembers; start += size) {
    blocks.push(
      Array.from({ length: Math.min(size, nMembers - start) }, (_, offset) => start + offset),
    );
  }
  return blocks;
}
