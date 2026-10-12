/**
 * The open session (C3.4): the engine's last view; the document the engine holds (`base`, at
 * `storedRevision`); the operator's `draft`; the save in flight; the save machine's flags; undo and
 * redo; the active tool and selection; the hover and preview channels. Edits change only the draft
 * (and only while the session can be edited); the autosave listener (listeners/autosave.ts)
 * sends it. Nothing is computed here from the draft: rows, values and flags come from the engine
 * (the view, or a preview reply). Ids are client-owned and `nextMeasurementId` never decreases,
 * undo included.
 */
import { createSlice, current, type PayloadAction } from "@reduxjs/toolkit";
import type { ApiErrorShape } from "@/api/errors";
import type {
  DepthOut,
  InputKind,
  MeasurementInput,
  MeasurementRow,
  PreviewOut,
  SessionView,
  Target,
} from "@/api/types";
import {
  adoptEcho,
  documentOf,
  MAX_MEASUREMENTS,
  MAX_SAFE_ID,
  nextIdAfter,
  sameDocument,
  type SessionDocument,
  type TextField,
} from "../session/document";
import {
  emptyChannel,
  probeFailed,
  probeReply,
  probeRequest,
  probeReset,
  type ProbeChannel,
} from "../session/probe";
import type { RebaseConflict } from "../session/rebase";

export const UNDO_LIMIT = 100;

export interface DepthRequest {
  u: number;
  v: number;
  target: Target;
}

export interface PreviewRequest {
  measurement: MeasurementInput;
}

export interface SaveConflict {
  conflicts: RebaseConflict[];
  mine: SessionDocument;
  theirs: SessionDocument;
  /** the engine's view the conflict was found against */
  view: SessionView;
}

export interface SaveFlags {
  /** a terminal 4xx: autosave waits until the draft changes */
  error: { error: ApiErrorShape; draft: SessionDocument } | null;
  /** network or engine unavailable: retried with backoff, resumed when the engine is ready */
  offline: { error: ApiErrorShape; attempts: number } | null;
  /** a clash after a 409: the operator keeps theirs or mine */
  conflict: SaveConflict | null;
  /** the session is not open (finalized, exported): nothing is autosaved */
  blocked: boolean;
  /** a finalize is running: edits and undo are frozen */
  finalizing: boolean;
}

export interface SessionState {
  id: string | null;
  load: { state: "idle" | "loading" | "ready" | "error"; error: ApiErrorShape | null };
  view: SessionView | null;
  etag: string | null;
  storedRevision: number;
  nextMeasurementId: number;
  base: SessionDocument | null;
  draft: SessionDocument | null;
  inFlight: { revision: number; document: SessionDocument } | null;
  save: SaveFlags;
  undo: { past: SessionDocument[]; future: SessionDocument[] };
  tool: InputKind | null;
  selection: number | null;
  depth: ProbeChannel<DepthRequest, DepthOut>;
  preview: ProbeChannel<PreviewRequest, MeasurementRow>;
  /** the last preview row per measurement id, with the input it was computed for */
  previews: Record<number, { input: MeasurementInput; row: MeasurementRow }>;
  finalize: { error: ApiErrorShape | null };
}

const NO_FLAGS: SaveFlags = {
  error: null,
  offline: null,
  conflict: null,
  blocked: false,
  finalizing: false,
};

export const SESSION_INITIAL: SessionState = {
  id: null,
  load: { state: "idle", error: null },
  view: null,
  etag: null,
  storedRevision: 0,
  nextMeasurementId: 1,
  base: null,
  draft: null,
  inFlight: null,
  save: NO_FLAGS,
  undo: { past: [], future: [] },
  tool: null,
  selection: null,
  depth: emptyChannel(),
  preview: emptyChannel(),
  previews: {},
  finalize: { error: null },
};

/** Edits are allowed on a loaded, open session that is not finalizing or in conflict. */
export function canEditSession(state: SessionState): boolean {
  return (
    state.draft !== null &&
    state.view !== null &&
    state.view.status === "open" &&
    !state.save.blocked &&
    !state.save.finalizing &&
    state.save.conflict === null
  );
}

function plain<T>(value: T): T {
  // a snapshot of an Immer draft (or the value itself when it is not one)
  try {
    return current(value as object) as T;
  } catch {
    return value;
  }
}

function adoptView(state: SessionState, view: SessionView, etag: string | null): void {
  state.id = view.session_id;
  state.view = view;
  state.etag = etag;
  state.storedRevision = view.revision;
  state.save.blocked = view.status !== "open";
}

function withNextId(state: SessionState, ...docs: SessionDocument[]): void {
  let next = Math.max(state.nextMeasurementId, state.view?.next_measurement_id ?? 1);
  for (const doc of docs) next = nextIdAfter(next, doc);
  state.nextMeasurementId = next;
}

/** Apply an edit to the draft (if the session can be edited) and record it for undo. */
function edit(state: SessionState, change: (doc: SessionDocument) => SessionDocument | null): void {
  if (!canEditSession(state) || state.draft === null) return;
  const before = plain(state.draft);
  const after = change(before);
  if (after === null || sameDocument(after, before)) return;
  state.undo.past.push(before);
  if (state.undo.past.length > UNDO_LIMIT) state.undo.past.shift();
  state.undo.future = [];
  state.draft = after;
}

function updateMeasurement(
  doc: SessionDocument,
  id: number,
  change: (m: MeasurementInput) => MeasurementInput,
): SessionDocument | null {
  const index = doc.measurements.findIndex((m) => m.id === id);
  if (index < 0) return null;
  const measurements = [...doc.measurements];
  measurements[index] = change(measurements[index] as MeasurementInput);
  return { ...doc, measurements };
}

export type MeasurementChanges = Partial<Omit<MeasurementInput, "id" | "kind">>;

const sessionSlice = createSlice({
  name: "session",
  initialState: SESSION_INITIAL,
  reducers: {
    sessionLoadStarted(_state, action: PayloadAction<string>) {
      return { ...SESSION_INITIAL, id: action.payload, load: { state: "loading", error: null } };
    },
    sessionLoadFailed(state, action: PayloadAction<ApiErrorShape>) {
      state.load = { state: "error", error: action.payload };
    },
    sessionLoaded(_state, action: PayloadAction<{ view: SessionView; etag: string | null }>) {
      const { view, etag } = action.payload;
      const doc = documentOf(view);
      return {
        ...SESSION_INITIAL,
        id: view.session_id,
        load: { state: "ready", error: null },
        view,
        etag,
        storedRevision: view.revision,
        nextMeasurementId: nextIdAfter(Math.max(1, view.next_measurement_id), doc),
        base: doc,
        draft: doc,
        save: { ...NO_FLAGS, blocked: view.status !== "open" },
      } satisfies SessionState;
    },
    sessionClosed() {
      return SESSION_INITIAL;
    },

    // ----- edits (the draft only) -----
    measurementAdded(state, action: PayloadAction<Omit<MeasurementInput, "id">>) {
      const id = state.nextMeasurementId;
      if (id > MAX_SAFE_ID || (state.draft?.measurements.length ?? 0) >= MAX_MEASUREMENTS) return;
      const before = state.draft;
      edit(state, (doc) => ({
        ...doc,
        measurements: [...doc.measurements, { ...action.payload, id }],
      }));
      if (state.draft !== before) {
        state.nextMeasurementId = id + 1;
        state.selection = id;
      }
    },
    measurementChanged(state, action: PayloadAction<{ id: number; changes: MeasurementChanges }>) {
      const { id, changes } = action.payload;
      edit(state, (doc) => updateMeasurement(doc, id, (m) => ({ ...m, ...changes })));
    },
    measurementRemoved(state, action: PayloadAction<number>) {
      const id = action.payload;
      edit(state, (doc) =>
        doc.measurements.some((m) => m.id === id)
          ? { ...doc, measurements: doc.measurements.filter((m) => m.id !== id) }
          : null,
      );
      if (state.selection === id) state.selection = null;
    },
    measurementMoved(state, action: PayloadAction<{ id: number; delta: -1 | 1 }>) {
      const { id, delta } = action.payload;
      edit(state, (doc) => {
        const from = doc.measurements.findIndex((m) => m.id === id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= doc.measurements.length) return null;
        const measurements = [...doc.measurements];
        const [moved] = measurements.splice(from, 1);
        measurements.splice(to, 0, moved as MeasurementInput);
        return { ...doc, measurements };
      });
    },
    textEdited(state, action: PayloadAction<{ field: TextField; value: string }>) {
      const { field, value } = action.payload;
      edit(state, (doc) => ({ ...doc, [field]: value }));
    },
    undone(state) {
      if (!canEditSession(state) || state.draft === null) return;
      const previous = state.undo.past.pop();
      if (previous === undefined) return;
      state.undo.future.push(plain(state.draft));
      state.draft = plain(previous);
    },
    redone(state) {
      if (!canEditSession(state) || state.draft === null) return;
      const next = state.undo.future.pop();
      if (next === undefined) return;
      state.undo.past.push(plain(state.draft));
      state.draft = plain(next);
    },

    // ----- the save machine (dispatched by the autosave listener and the session thunks) -----
    saveStarted(state, action: PayloadAction<{ revision: number; document: SessionDocument }>) {
      state.inFlight = action.payload;
    },
    saveSucceeded(state, action: PayloadAction<{ view: SessionView; etag: string | null }>) {
      const { view, etag } = action.payload;
      const stored = documentOf(view);
      const sent = state.inFlight?.document ?? plain(state.base);
      if (state.draft !== null && sent !== null) {
        state.draft = adoptEcho(plain(state.draft), plain(sent), stored);
      }
      state.base = stored;
      state.inFlight = null;
      state.save.error = null;
      state.save.offline = null;
      adoptView(state, view, etag);
      withNextId(state, stored);
    },
    saveFailed(state, action: PayloadAction<{ error: ApiErrorShape; transient: boolean }>) {
      const { error, transient } = action.payload;
      state.inFlight = null;
      if (transient) {
        state.save.offline = { error, attempts: (state.save.offline?.attempts ?? 0) + 1 };
      } else if (state.draft !== null) {
        state.save.offline = null;
        state.save.error = { error, draft: plain(state.draft) };
      }
    },
    /** The engine moved on and my draft merged cleanly onto it: continue on its revision. */
    saveRebased(
      state,
      action: PayloadAction<{ view: SessionView; merged: SessionDocument; etag?: string | null }>,
    ) {
      const { view, merged, etag = null } = action.payload;
      state.inFlight = null;
      state.save.error = null;
      state.save.offline = null;
      state.base = documentOf(view);
      state.draft = merged;
      adoptView(state, view, etag);
      withNextId(state, merged);
    },
    saveConflicted(state, action: PayloadAction<SaveConflict>) {
      state.inFlight = null;
      state.save.offline = null;
      state.save.conflict = action.payload;
    },
    conflictResolved(state, action: PayloadAction<"mine" | "theirs">) {
      if (state.save.conflict === null) return;
      const conflict = plain(state.save.conflict);
      state.save.conflict = null;
      state.save.error = null;
      state.base = conflict.theirs;
      state.draft = action.payload === "mine" ? conflict.mine : conflict.theirs;
      state.undo = { past: [], future: [] };
      adoptView(state, conflict.view, null);
      withNextId(state, conflict.mine, conflict.theirs);
    },
    /** The engine's session is not open any more: keep the draft (unsaved), save nothing. */
    sessionBlocked(state, action: PayloadAction<SessionView>) {
      const view = action.payload;
      state.inFlight = null;
      state.save.offline = null;
      state.base = documentOf(view);
      adoptView(state, view, null);
      withNextId(state, state.base);
    },
    /** A newer view with the same document (report inputs, status, outputs, ETag). */
    viewUpdated(state, action: PayloadAction<{ view: SessionView; etag: string | null }>) {
      adoptView(state, action.payload.view, action.payload.etag);
    },

    // ----- finalize -----
    finalizeStarted(state) {
      state.save.finalizing = true;
      state.finalize.error = null;
    },
    finalizeSucceeded(state, action: PayloadAction<{ view: SessionView; etag: string | null }>) {
      const stored = documentOf(action.payload.view);
      state.save.finalizing = false;
      state.save.error = null;
      state.save.offline = null;
      state.base = stored;
      state.draft = stored;
      state.inFlight = null;
      state.undo = { past: [], future: [] };
      adoptView(state, action.payload.view, action.payload.etag);
      withNextId(state, stored);
    },
    finalizeFailed(state, action: PayloadAction<ApiErrorShape>) {
      state.save.finalizing = false;
      state.finalize.error = action.payload;
    },

    // ----- tool, selection, hover, preview -----
    toolChanged(state, action: PayloadAction<InputKind | null>) {
      state.tool = action.payload;
      state.depth = probeReset(state.depth);
      state.preview = probeReset(state.preview);
    },
    selectionChanged(state, action: PayloadAction<number | null>) {
      state.selection = action.payload;
    },
    depthRequested(state, action: PayloadAction<DepthRequest>) {
      state.depth = probeRequest(plain(state.depth), action.payload);
    },
    depthReplied(state, action: PayloadAction<DepthOut>) {
      const seq = action.payload.seq;
      if (seq !== null) state.depth = probeReply(plain(state.depth), seq, action.payload);
    },
    depthFailed(state, action: PayloadAction<number>) {
      state.depth = probeFailed(plain(state.depth), action.payload);
    },
    depthReset(state) {
      state.depth = probeReset(plain(state.depth));
    },
    previewRequested(state, action: PayloadAction<PreviewRequest>) {
      state.preview = probeRequest(plain(state.preview), action.payload);
    },
    previewReplied(state, action: PayloadAction<PreviewOut>) {
      const { seq, row } = action.payload;
      const channel = plain(state.preview);
      const asked = channel.inFlight;
      if (seq === null || asked === null || asked.seq !== seq) return;
      state.preview = probeReply(channel, seq, row);
      if (asked.generation === channel.generation) {
        const input = asked.request.measurement;
        state.previews[input.id] = { input, row };
      }
    },
    previewFailed(state, action: PayloadAction<number>) {
      state.preview = probeFailed(plain(state.preview), action.payload);
    },
    previewReset(state) {
      state.preview = probeReset(plain(state.preview));
    },
  },
});

export const {
  sessionLoadStarted,
  sessionLoadFailed,
  sessionLoaded,
  sessionClosed,
  measurementAdded,
  measurementChanged,
  measurementRemoved,
  measurementMoved,
  textEdited,
  undone,
  redone,
  saveStarted,
  saveSucceeded,
  saveFailed,
  saveRebased,
  saveConflicted,
  conflictResolved,
  sessionBlocked,
  viewUpdated,
  finalizeStarted,
  finalizeSucceeded,
  finalizeFailed,
  toolChanged,
  selectionChanged,
  depthRequested,
  depthReplied,
  depthFailed,
  depthReset,
  previewRequested,
  previewReplied,
  previewFailed,
  previewReset,
} = sessionSlice.actions;
export const sessionReducer = sessionSlice.reducer;

/** The actions that change the draft: each one (re)starts the autosave debounce. */
export const DRAFT_EDITS = [
  measurementAdded,
  measurementChanged,
  measurementRemoved,
  measurementMoved,
  textEdited,
  undone,
  redone,
] as const;
