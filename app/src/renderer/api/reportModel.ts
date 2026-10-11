/**
 * The parts of `report_model_vN.json` the app reads before printing (the print page reads the rest
 * in Stage 7). The OpenAPI does not type the file, so the shape is written out and checked here.
 * All strings are the engine's: the observation fields, their placeholders, the colour options
 * and the rubric variants are never hard-coded in the app.
 */
import { isRecord } from "./errors";
import type { LabelPair } from "./labels";

export interface ObservationField extends LabelPair {
  key: string;
  kind: "select" | "text" | "textarea";
  placeholder: string;
}

export interface ReportFormContent {
  observationFields: ObservationField[];
  colourOptions: LabelPair[];
  variants: Record<string, LabelPair>;
}

function pair(value: unknown): LabelPair | null {
  return isRecord(value) && typeof value["ar"] === "string" && typeof value["en"] === "string"
    ? { ar: value["ar"], en: value["en"] }
    : null;
}

/** The form content of a report model; null when the file does not have the expected shape. */
export function reportFormContent(model: unknown): ReportFormContent | null {
  const content = isRecord(model) ? model["static"] : null;
  if (!isRecord(content)) return null;
  const fields = content["observation_fields"];
  const colours = content["colour_options"];
  const rubric = content["rubric"];
  const variants = isRecord(rubric) ? rubric["variants"] : null;
  if (!Array.isArray(fields) || !Array.isArray(colours) || !isRecord(variants)) return null;

  const observationFields: ObservationField[] = [];
  for (const field of fields) {
    const label = pair(field);
    if (!isRecord(field) || label === null || typeof field["key"] !== "string") return null;
    const kind = field["kind"];
    if (kind !== "select" && kind !== "text" && kind !== "textarea") return null;
    const placeholder = typeof field["placeholder"] === "string" ? field["placeholder"] : "";
    observationFields.push({ ...label, key: field["key"], kind, placeholder });
  }
  const colourOptions = colours.map(pair);
  if (colourOptions.some((option) => option === null)) return null;
  const variantLabels: Record<string, LabelPair> = {};
  for (const [code, value] of Object.entries(variants)) {
    const label = pair(value);
    if (label === null) return null;
    variantLabels[code] = label;
  }
  return {
    observationFields,
    colourOptions: colourOptions as LabelPair[],
    variants: variantLabels,
  };
}
