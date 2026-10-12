/**
 * Three-way rebase of the operator's draft onto the engine's current document (C3.4, D10 app
 * side): `base` is what the engine held when the draft started diverging, `mine` the draft,
 * `theirs` the `current` view of a 409 `stale_revision`. Merged by measurement id; a change on one
 * side is taken, the same change on both sides is fine, and two different changes to the same
 * thing are a conflict the operator resolves (keep mine / take the engine's) — never a silent
 * drop. The merged document is the tentative result (my side wherever there is a conflict).
 */
import type { MeasurementInput } from "@/api/types";
import { sameValue, TEXT_FIELDS, type SessionDocument, type TextField } from "./document";

export type ConflictKind =
  /** both sides changed the measurement, differently */
  | "both_edited"
  /** I changed it, the engine's side deleted it */
  | "edited_deleted"
  /** I deleted it, the engine's side changed it */
  | "deleted_edited"
  /** both sides added this id, differently */
  | "both_added"
  /** both sides reordered, differently */
  | "order"
  /** both sides changed a text field, differently */
  | "field";

export interface RebaseConflict {
  kind: ConflictKind;
  id?: number;
  field?: TextField;
}

export interface RebaseResult {
  merged: SessionDocument;
  conflicts: RebaseConflict[];
}

function byId(list: MeasurementInput[]): Map<number, MeasurementInput> {
  return new Map(list.map((m) => [m.id, m]));
}

/** The ids two orderings share, in the first ordering's order. */
function shared(order: number[], other: Set<number>): number[] {
  return order.filter((id) => other.has(id));
}

function reordered(base: number[], side: number[]): boolean {
  const common = new Set(side);
  const baseCommon = shared(base, common);
  const sideSet = new Set(baseCommon);
  return !sameValue(baseCommon, shared(side, sideSet));
}

export function rebase(
  base: SessionDocument,
  mine: SessionDocument,
  theirs: SessionDocument,
): RebaseResult {
  const conflicts: RebaseConflict[] = [];
  const B = byId(base.measurements);
  const M = byId(mine.measurements);
  const T = byId(theirs.measurements);
  const merged = new Map<number, MeasurementInput>();
  const ids = new Set([...B.keys(), ...M.keys(), ...T.keys()]);

  for (const id of ids) {
    const b = B.get(id);
    const m = M.get(id);
    const t = T.get(id);
    if (b !== undefined) {
      const mineChanged = m === undefined || !sameValue(b, m);
      const theirsChanged = t === undefined || !sameValue(b, t);
      if (m !== undefined && t !== undefined) {
        if (!mineChanged) merged.set(id, t);
        else if (!theirsChanged || sameValue(m, t)) merged.set(id, m);
        else {
          conflicts.push({ kind: "both_edited", id });
          merged.set(id, m);
        }
      } else if (m !== undefined) {
        // deleted on the engine's side
        if (mineChanged) {
          conflicts.push({ kind: "edited_deleted", id });
          merged.set(id, m);
        }
      } else if (t !== undefined && theirsChanged) {
        // deleted by me, changed on the engine's side
        conflicts.push({ kind: "deleted_edited", id });
      }
    } else if (m !== undefined && t !== undefined) {
      if (!sameValue(m, t)) conflicts.push({ kind: "both_added", id });
      merged.set(id, m);
    } else if (m !== undefined) {
      merged.set(id, m);
    } else if (t !== undefined) {
      merged.set(id, t);
    }
  }

  const orderB = base.measurements.map((m) => m.id);
  const orderM = mine.measurements.map((m) => m.id);
  const orderT = theirs.measurements.map((m) => m.id);
  const mineMoved = reordered(orderB, orderM);
  const theirsMoved = reordered(orderB, orderT);
  if (mineMoved && theirsMoved) {
    const common = new Set(orderM.filter((id) => orderT.includes(id)));
    if (!sameValue(shared(orderM, common), shared(orderT, common)))
      conflicts.push({ kind: "order" });
  }
  const [primary, secondary] = theirsMoved && !mineMoved ? [orderT, orderM] : [orderM, orderT];
  const order: number[] = [];
  for (const id of [...primary, ...secondary]) {
    if (merged.has(id) && !order.includes(id)) order.push(id);
  }

  const text = {} as Record<TextField, string>;
  for (const field of TEXT_FIELDS) {
    const [b, m, t] = [base[field], mine[field], theirs[field]];
    if (m === b) text[field] = t;
    else if (t === b || t === m) text[field] = m;
    else {
      conflicts.push({ kind: "field", field });
      text[field] = m;
    }
  }

  return {
    merged: {
      measurements: order.map((id) => merged.get(id) as MeasurementInput),
      camelId: text.camelId,
      operator: text.operator,
      notes: text.notes,
    },
    conflicts,
  };
}
