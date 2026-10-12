/**
 * The operator's document of an open session (C3.4): the ordered measurement inputs and the three
 * text fields, exactly what an autosave sends. The engine computes everything else (values,
 * depth, rejections); the app never derives one. Conversions from a SessionView, the equality the
 * save machine uses, and the request bodies.
 */
import type { components } from "@shared/api";
import type { MeasurementInput, SessionView } from "@/api/types";

/** Ids and revisions never exceed 2**53 − 1 (the engine refuses larger ones). */
export const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;
/** The engine's limits (DocumentIn / MeasurementInputModel): measurements per session, points. */
export const MAX_MEASUREMENTS = 500;
export const MAX_POINTS = 500;

export interface SessionDocument {
  measurements: MeasurementInput[];
  camelId: string;
  operator: string;
  notes: string;
}

export type TextField = "camelId" | "operator" | "notes";
export const TEXT_FIELDS: readonly TextField[] = ["camelId", "operator", "notes"];

/** The inputs a view holds, in their stored order, and its text fields. */
export function documentOf(view: SessionView): SessionDocument {
  const rows = [...view.measurements].sort((a, b) => a.order - b.order);
  return {
    measurements: rows.map((row) => row.input),
    camelId: view.camel_id,
    operator: view.operator,
    notes: view.notes,
  };
}

/** Structural equality of JSON values (the inputs are plain data). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

export function sameDocument(a: SessionDocument, b: SessionDocument): boolean {
  return (
    a.camelId === b.camelId &&
    a.operator === b.operator &&
    a.notes === b.notes &&
    sameValue(a.measurements, b.measurements)
  );
}

/**
 * After a save is acknowledged, the draft takes the engine's echo of everything the operator has
 * not changed since sending (the engine fills a missing colour or the default targets): each
 * measurement still equal to what was sent becomes the stored one, and so does each text field.
 * Edits made while the save was in flight are kept.
 */
export function adoptEcho(
  draft: SessionDocument,
  sent: SessionDocument,
  stored: SessionDocument,
): SessionDocument {
  const sentById = new Map(sent.measurements.map((m) => [m.id, m]));
  const storedById = new Map(stored.measurements.map((m) => [m.id, m]));
  return {
    measurements: draft.measurements.map((m) => {
      const before = sentById.get(m.id);
      const echo = storedById.get(m.id);
      return before !== undefined && echo !== undefined && sameValue(m, before) ? echo : m;
    }),
    camelId: draft.camelId === sent.camelId ? stored.camelId : draft.camelId,
    operator: draft.operator === sent.operator ? stored.operator : draft.operator,
    notes: draft.notes === sent.notes ? stored.notes : draft.notes,
  };
}

/** The document part of an autosave or a finalize body. */
export function documentBody(
  doc: SessionDocument,
  nextMeasurementId: number,
): components["schemas"]["DocumentBody"] {
  return {
    measurements: doc.measurements,
    camel_id: doc.camelId,
    operator: doc.operator,
    notes: doc.notes,
    next_measurement_id: nextMeasurementId,
  };
}

/** The ids are client-owned: the next one is above every id the session has ever held. */
export function nextIdAfter(current: number, doc: SessionDocument): number {
  return Math.max(current, ...doc.measurements.map((m) => m.id + 1));
}
