/**
 * "Save as" for a sealed PDF (D12 F1), the renderer's half: per report version, the copy main
 * recorded (where, and whether it is still there as written), a save in progress, and its last
 * failure. Main owns the dialog, the bytes and the file; this slice only shows what main answered.
 * `offer` asks the screen that shows a report to open the Save dialog once its viewer has verified
 * the freshly sealed bytes (set when a print is sealed, taken or dropped by that screen).
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ReportKind, SaveAsResult, SavedCopy, SavedCopyQuery } from "@shared/ipc";
import type { ApiErrorShape } from "@/api/errors";

export interface SavedFileEntry {
  /** main was asked for the recorded copy */
  checked: boolean;
  copy: SavedCopy | null;
  saving: boolean;
  /** the copy was written and verified, but main could not store its record */
  unrecorded: boolean;
  error: ApiErrorShape | null;
  /** what failed: saving the copy, or opening it */
  errorFrom: "save" | "open" | null;
}

export interface SavedFilesState {
  entries: Record<string, SavedFileEntry>;
  offer: SavedCopyQuery | null;
}

export const SAVED_FILES_INITIAL: SavedFilesState = { entries: {}, offer: null };

const EMPTY_ENTRY: SavedFileEntry = {
  checked: false,
  copy: null,
  saving: false,
  unrecorded: false,
  error: null,
  errorFrom: null,
};

export function savedFileKey(ref: { kind: ReportKind; id: string; version: number }): string {
  return `${ref.kind}:${ref.id}:v${ref.version}`;
}

export function sameReport(a: SavedCopyQuery | null, b: SavedCopyQuery): boolean {
  return a !== null && a.kind === b.kind && a.id === b.id && a.version === b.version;
}

function entry(state: SavedFilesState, key: string): SavedFileEntry {
  const existing = state.entries[key];
  if (existing !== undefined) return existing;
  const created = { ...EMPTY_ENTRY };
  state.entries[key] = created;
  return created;
}

const savedFilesSlice = createSlice({
  name: "savedFiles",
  initialState: SAVED_FILES_INITIAL,
  reducers: {
    savedCopyLoaded(state, action: PayloadAction<{ key: string; copy: SavedCopy | null }>) {
      const e = entry(state, action.payload.key);
      e.checked = true;
      e.copy = action.payload.copy;
    },
    saveStarted(state, action: PayloadAction<string>) {
      const e = entry(state, action.payload);
      e.saving = true;
      e.error = null;
      e.errorFrom = null;
    },
    saveFinished(state, action: PayloadAction<{ key: string; result: SaveAsResult }>) {
      const e = entry(state, action.payload.key);
      const { result } = action.payload;
      e.saving = false;
      if (result.state === "saved") {
        e.checked = true;
        e.copy = {
          path: result.path,
          savedAt: result.savedAt,
          sha256: result.sha256,
          bytes: result.bytes,
          exists: true,
          changed: false,
        };
        e.unrecorded = !result.recorded;
        e.error = null;
        e.errorFrom = null;
      } else if (result.state === "failed") {
        e.error = result.error;
        e.errorFrom = "save";
      }
    },
    /** opening the copy (or showing it) failed, or worked again */
    openFinished(state, action: PayloadAction<{ key: string; error: ApiErrorShape | null }>) {
      const e = entry(state, action.payload.key);
      e.error = action.payload.error;
      e.errorFrom = action.payload.error === null ? null : "open";
    },
    saveOffered(state, action: PayloadAction<SavedCopyQuery>) {
      state.offer = { ...action.payload };
    },
    /** the screen took the offer (it opens the dialog), or dropped it (the operator left) */
    saveOfferCleared(state, action: PayloadAction<SavedCopyQuery | undefined>) {
      if (action.payload === undefined || sameReport(state.offer, action.payload)) {
        state.offer = null;
      }
    },
  },
});

export const {
  savedCopyLoaded,
  saveStarted,
  saveFinished,
  openFinished,
  saveOffered,
  saveOfferCleared,
} = savedFilesSlice.actions;
export const savedFilesReducer = savedFilesSlice.reducer;

export function savedFileOf(state: SavedFilesState, ref: SavedCopyQuery): SavedFileEntry {
  return state.entries[savedFileKey(ref)] ?? EMPTY_ENTRY;
}
