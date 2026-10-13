/**
 * What the measuring screen reads from the session slice: the save state for the UnsavedBadge, the
 * "unsaved work" answer for quitting and leaving, and the rows to show. A row is always the
 * engine's: the stored row when the draft holds the same input (saved); the stored row, or the
 * last preview, computed for the same geometry (pending or preview: the name, note and colour,
 * which never change a value, are the draft's); or nothing yet (pending, no value). A 4-point angle
 * whose lines are not saved waits for them. Never a value the app computed.
 */
import type { MeasurementInput, MeasurementRow } from "@/api/types";
import type { MeasurementListItem } from "@/components/domain/MeasurementList";
import type { SaveState } from "@/components/domain/UnsavedBadge";
import { canEditSession, type SessionState } from "../slices/session";
import {
  MAX_MEASUREMENTS,
  MAX_SAFE_ID,
  sameDocument,
  sameValue,
  type SessionDocument,
} from "./document";

export function saveStateOf(session: SessionState): SaveState {
  const { save, draft, base } = session;
  if (save.finalizing) return "finalizing";
  if (save.conflict !== null) return "conflict";
  if (save.blocked) return "blocked";
  if (session.inFlight !== null) return "saving";
  if (save.offline !== null) return "offline";
  if (save.error !== null && draft !== null && sameDocument(save.error.draft, draft))
    return "error";
  if (draft === null || base === null || sameDocument(draft, base)) return "clean";
  return "dirty";
}

/** Work the engine does not hold yet: a draft that differs, a save in flight, a conflict. */
export function hasUnsavedWork(session: SessionState): boolean {
  if (session.draft === null || session.base === null) return false;
  return (
    session.inFlight !== null ||
    session.save.conflict !== null ||
    !sameDocument(session.draft, session.base)
  );
}

export function canEdit(session: SessionState): boolean {
  return canEditSession(session);
}

/** Another measurement can be added (500 per session; ids stay below 2**53). */
export function canAddMeasurement(session: SessionState): boolean {
  return (
    canEditSession(session) &&
    (session.draft?.measurements.length ?? 0) < MAX_MEASUREMENTS &&
    session.nextMeasurementId <= MAX_SAFE_ID
  );
}

export type DisplayRow = MeasurementListItem;

const targetsOf = (input: MeasurementInput) =>
  input.targets ?? (input.points ?? []).map(() => "camel");

/**
 * Inputs the engine computes the same value for: same kind, points, targets and referenced lines
 * (the name, note and colour are presentation).
 */
export function sameGeometry(a: MeasurementInput, b: MeasurementInput): boolean {
  return (
    a.kind === b.kind &&
    sameValue(a.points ?? [], b.points ?? []) &&
    sameValue(targetsOf(a), targetsOf(b)) &&
    (a.line_a_id ?? null) === (b.line_a_id ?? null) &&
    (a.line_b_id ?? null) === (b.line_b_id ?? null)
  );
}

/** An engine row shown for the draft's input: the input's name, note and colour over it. */
function shownAs(row: MeasurementRow, input: MeasurementInput): MeasurementRow {
  return {
    ...row,
    name: input.name,
    note: input.note,
    display_color: input.color ?? row.display_color,
  };
}

export function displayRows(session: SessionState): DisplayRow[] {
  if (session.draft === null) return [];
  return displayRowsOf(session.draft, session.view?.measurements ?? [], session.previews);
}

/** displayRows from its three inputs (what a memoised screen depends on). */
export function displayRowsOf(
  draft: SessionDocument,
  measurements: readonly MeasurementRow[],
  previews: SessionState["previews"],
): DisplayRow[] {
  const stored = new Map(measurements.map((r) => [r.id, r]));
  const rows = draft.measurements.map((input): DisplayRow => {
    const saved = stored.get(input.id);
    if (saved !== undefined && sameValue(saved.input, input)) {
      return { input, row: saved, status: "saved" };
    }
    if (saved !== undefined && sameGeometry(saved.input, input)) {
      return { input, row: shownAs(saved, input), status: "pending" };
    }
    const preview = previews[input.id];
    if (preview !== undefined && sameGeometry(preview.input, input)) {
      return { input, row: shownAs(preview.row, input), status: "preview" };
    }
    return { input, row: null, status: "pending" };
  });
  // a 4-point angle's value follows its lines: while one of them is changed, added or deleted
  // and not saved yet, the angle waits too — whether its row is the stored one, the stored one
  // under a new name, or a preview (the engine resolves a preview's lines in the stored document)
  const savedIds = new Set(rows.filter((r) => r.status === "saved").map((r) => r.input.id));
  const draftIds = new Set(rows.map((r) => r.input.id));
  const settled = (id: number) => (draftIds.has(id) ? savedIds.has(id) : !stored.has(id));
  return rows.map((item) => {
    const { input } = item;
    if (input.kind !== "angle_4point" || item.row === null) return item;
    const lines = [input.line_a_id, input.line_b_id];
    const waiting = lines.some((id) => typeof id === "number" && !settled(id));
    return waiting ? { input, row: null, status: "pending" } : item;
  });
}
