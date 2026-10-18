/**
 * The comparison report's app state (D12 F2): the camels picked in History, in the operator's order
 * (the order the PDF prints — nothing here sorts by a value); the Compare dialog's cover and
 * language; the approvals given in the dialog (Q1), keyed by session and naming the image's version
 * and SHA-256 — kept apart from the single-slot `overlayBytes` cache the open session needs; and
 * the Comparisons tab's query (the list itself is RTK Query `listComparisons`); the last print of a
 * comparison (Stage 5).
 *
 * A picked camel is a snapshot of its History row: whether the engine lets it join, why not, and the
 * image to approve. Every list refreshes the snapshots of the camels it shows, so a camel reopened
 * meanwhile turns ineligible here too (the engine re-checks every member anyway when it creates the
 * comparison).
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { components, operations } from "@shared/api";
import type { ComparisonExportRequest, PrintPreflight } from "@shared/ipc";
import type { ApiErrorShape } from "@/api/errors";
import type { ComparisonMember, HistoryRow } from "@/api/types";

type Schemas = components["schemas"];
type ListQuery = NonNullable<operations["list_comparisons"]["parameters"]["query"]>;
export type ComparisonSort = NonNullable<ListQuery["sort"]>;
export type ComparisonStatus = NonNullable<ListQuery["status"]>;
export type ComparisonLanguage = Schemas["ComparisonCreateIn"]["language"];
export type IneligibleReason = NonNullable<Schemas["ComparisonEligibility"]["reason"]>;

export const COMPARISONS_PAGE_SIZE = 50;

export interface OverlayRef {
  version: number;
  sha256: string;
  url: string;
}

export interface SelectedMember {
  sessionId: string;
  camelId: string;
  event: string;
  eligible: boolean;
  reason: IneligibleReason | null;
  /** a report sealed from its current image: no approval needed */
  approvedBySeal: boolean;
  /** the image to approve (null when ineligible) */
  overlay: OverlayRef | null;
}

export interface MemberApproval {
  version: number;
  sha256: string;
}

export interface CoverDraft {
  title: string;
  event: string;
  judge: string;
  council: string;
}

/** A camel "Compare again" left out, and why (the engine's label group and code). */
export interface DroppedMember {
  sessionId: string;
  camelId: string;
  group: "comparison_ineligible" | "comparison_stale";
  reason: string;
}

export interface ComparisonsQuery {
  q: string;
  status: ComparisonStatus | null;
  /** only stale (true), only current (false), or both (null) */
  stale: boolean | null;
  sort: ComparisonSort;
  page: number;
}

/** The last print of a comparison in this app run (D12 Stage 5), as the report slice's export. */
export interface ComparisonExportState {
  comparisonId: string;
  state: "printing" | "sealed" | "failed";
  error: ApiErrorShape | null;
  /** the engine's probe: of the sealed PDF, or of a refused one (DRIFT) */
  probe: unknown;
  /** the print page's own checks (warnings too), when it got that far */
  preflight: PrintPreflight | null;
  timingsMs: Record<string, number>;
}

export interface ComparisonsState {
  selection: SelectedMember[];
  dialogOpen: boolean;
  cover: CoverDraft;
  language: ComparisonLanguage;
  approvals: Record<string, MemberApproval>;
  /** the comparison "Compare again" started from, and the camels it could not keep */
  againFrom: string | null;
  dropped: DroppedMember[];
  query: ComparisonsQuery;
  export: ComparisonExportState | null;
}

export const EMPTY_COVER: CoverDraft = { title: "", event: "", judge: "", council: "" };

export const COMPARISONS_QUERY_INITIAL: ComparisonsQuery = {
  q: "",
  status: null,
  stale: null,
  sort: "created_desc",
  page: 0,
};

export const COMPARISONS_INITIAL: ComparisonsState = {
  selection: [],
  dialogOpen: false,
  cover: EMPTY_COVER,
  language: "both",
  approvals: {},
  againFrom: null,
  dropped: [],
  query: COMPARISONS_QUERY_INITIAL,
  export: null,
};

/** A History row as a pickable camel. */
export function memberFromRow(row: HistoryRow): SelectedMember {
  const eligibility = row.comparison;
  const overlay = eligibility.overlay ?? null;
  return {
    sessionId: row.session_id,
    camelId: row.camel_id,
    event: row.event,
    eligible: eligibility.eligible,
    reason: eligibility.reason ?? null,
    approvedBySeal: eligibility.approved_by_seal,
    overlay:
      overlay === null
        ? null
        : { version: overlay.version, sha256: overlay.sha256, url: overlay.url },
  };
}

/** How a picked camel's image stands: sealed in a report, approved here, or still to approve. */
export type ApprovalState = "seal" | "approved" | "needed";

export function approvalOf(
  approvals: Readonly<Record<string, MemberApproval>>,
  member: Pick<SelectedMember, "sessionId" | "approvedBySeal" | "overlay">,
): ApprovalState {
  if (member.approvedBySeal) return "seal";
  const given = approvals[member.sessionId];
  const overlay = member.overlay;
  if (given !== undefined && overlay !== null) {
    if (given.version === overlay.version && given.sha256 === overlay.sha256) return "approved";
  }
  return "needed";
}

/** The dialog can create the comparison: at least one camel, every one eligible and approved. */
export function readyToCreate(state: ComparisonsState, max: number | null): boolean {
  const { selection } = state;
  if (selection.length === 0 || (max !== null && selection.length > max)) return false;
  return selection.every(
    (member) => member.eligible && approvalOf(state.approvals, member) !== "needed",
  );
}

/** A comparison's camel as approvalOf reads it (its image from the comparison view). */
export function comparisonMemberRef(member: {
  session_id: string;
  approved_by_seal: boolean;
  overlay: { version: number; sha256: string; url: string };
}): Pick<SelectedMember, "sessionId" | "approvedBySeal" | "overlay"> {
  return {
    sessionId: member.session_id,
    approvedBySeal: member.approved_by_seal,
    overlay: member.overlay,
  };
}

/**
 * What the print sends for a comparison's camels (`print.exportComparison`): the approval given in
 * the app for each camel whose image is not sealed in a report, or null when one is still needed.
 */
export function exportApprovals(
  approvals: Readonly<Record<string, MemberApproval>>,
  members: readonly ComparisonMember[],
): ComparisonExportRequest["approvals"] | null {
  const out: ComparisonExportRequest["approvals"] = [];
  for (const member of members) {
    const state = approvalOf(approvals, comparisonMemberRef(member));
    if (state === "needed") return null;
    if (state === "approved") {
      out.push({
        sessionId: member.session_id,
        overlayVersion: member.overlay.version,
        sha256: member.overlay.sha256,
      });
    }
  }
  return out;
}

/** The event every picked camel shares (the cover's starting value), else "". */
export function sharedEvent(selection: readonly SelectedMember[]): string {
  const first = selection[0]?.event ?? "";
  return selection.every((member) => member.event === first) ? first : "";
}

const comparisonsSlice = createSlice({
  name: "comparisons",
  initialState: COMPARISONS_INITIAL,
  reducers: {
    /** Tick or untick a camel; an ineligible one, or one past `max`, is never added. */
    memberToggled(state, action: PayloadAction<{ member: SelectedMember; max: number | null }>) {
      const { member, max } = action.payload;
      const at = state.selection.findIndex((m) => m.sessionId === member.sessionId);
      if (at >= 0) {
        state.selection.splice(at, 1);
        return;
      }
      if (!member.eligible || (max !== null && state.selection.length >= max)) return;
      state.selection.push(member);
    },
    /** "Select all shown": the eligible camels not picked yet, in the list's order, up to `max`. */
    membersAdded(state, action: PayloadAction<{ members: SelectedMember[]; max: number | null }>) {
      const { members, max } = action.payload;
      for (const member of members) {
        if (max !== null && state.selection.length >= max) break;
        if (!member.eligible) continue;
        if (state.selection.some((m) => m.sessionId === member.sessionId)) continue;
        state.selection.push(member);
      }
    },
    memberRemoved(state, action: PayloadAction<string>) {
      state.selection = state.selection.filter((m) => m.sessionId !== action.payload);
      if (state.selection.length === 0) state.dialogOpen = false;
    },
    /** Move a camel to position `to` (0-based; drag and drop). */
    memberMoved(state, action: PayloadAction<{ sessionId: string; to: number }>) {
      const from = state.selection.findIndex((m) => m.sessionId === action.payload.sessionId);
      if (from < 0) return;
      const to = Math.max(0, Math.min(state.selection.length - 1, Math.floor(action.payload.to)));
      if (to === from) return;
      const [member] = state.selection.splice(from, 1);
      if (member !== undefined) state.selection.splice(to, 0, member);
    },
    selectionCleared(state) {
      state.selection = [];
      state.dialogOpen = false;
      state.againFrom = null;
      state.dropped = [];
    },
    /** A History list arrived: refresh the snapshots of the picked camels it shows. */
    selectionRowsSeen(state, action: PayloadAction<SelectedMember[]>) {
      for (const seen of action.payload) {
        const at = state.selection.findIndex((m) => m.sessionId === seen.sessionId);
        if (at >= 0) state.selection[at] = seen;
      }
    },
    compareDialogOpened(state) {
      if (state.selection.length === 0) return;
      // a fresh dialog starts from the event the camels share; "Compare again" brings its own cover
      if (state.againFrom === null) {
        state.cover = { ...EMPTY_COVER, event: sharedEvent(state.selection) };
      }
      state.dialogOpen = true;
    },
    compareDialogClosed(state) {
      state.dialogOpen = false;
    },
    coverChanged(state, action: PayloadAction<Partial<CoverDraft>>) {
      Object.assign(state.cover, action.payload);
    },
    languageChanged(state, action: PayloadAction<ComparisonLanguage>) {
      state.language = action.payload;
    },
    memberApproved(state, action: PayloadAction<{ sessionId: string } & MemberApproval>) {
      const { sessionId, version, sha256 } = action.payload;
      state.approvals[sessionId] = { version, sha256 };
    },
    /** The engine created the comparison: the picked camels are done with (approvals stay). */
    comparisonCreated(state) {
      state.selection = [];
      state.dialogOpen = false;
      state.cover = EMPTY_COVER;
      state.againFrom = null;
      state.dropped = [];
    },
    /** "Compare again": the same order and cover, minus the camels that can no longer join. */
    compareAgainPrepared(
      state,
      action: PayloadAction<{
        from: string;
        members: SelectedMember[];
        cover: CoverDraft;
        language: ComparisonLanguage;
        dropped: DroppedMember[];
      }>,
    ) {
      const { from, members, cover, language, dropped } = action.payload;
      state.selection = members;
      state.cover = cover;
      state.language = language;
      state.againFrom = from;
      state.dropped = dropped;
      state.dialogOpen = members.length > 0;
    },
    comparisonsQueryChanged(state, action: PayloadAction<Partial<Omit<ComparisonsQuery, "page">>>) {
      Object.assign(state.query, action.payload);
      state.query.page = 0;
    },
    comparisonsPageChanged(state, action: PayloadAction<number>) {
      state.query.page = Math.max(0, Math.floor(action.payload));
    },
    comparisonExportStarted(state, action: PayloadAction<string>) {
      state.export = {
        comparisonId: action.payload,
        state: "printing",
        error: null,
        probe: null,
        preflight: null,
        timingsMs: {},
      };
    },
    comparisonExportFinished(
      state,
      action: PayloadAction<{
        comparisonId: string;
        ok: boolean;
        error: ApiErrorShape | null;
        probe: unknown;
        preflight: PrintPreflight | null;
        timingsMs: Record<string, number>;
      }>,
    ) {
      const { comparisonId, ok, ...rest } = action.payload;
      if (state.export?.comparisonId !== comparisonId) return;
      state.export = { comparisonId, state: ok ? "sealed" : "failed", ...rest };
    },
  },
});

export const {
  memberToggled,
  membersAdded,
  memberRemoved,
  memberMoved,
  selectionCleared,
  selectionRowsSeen,
  compareDialogOpened,
  compareDialogClosed,
  coverChanged,
  languageChanged,
  memberApproved,
  comparisonCreated,
  compareAgainPrepared,
  comparisonsQueryChanged,
  comparisonsPageChanged,
  comparisonExportStarted,
  comparisonExportFinished,
} = comparisonsSlice.actions;
export const comparisonsReducer = comparisonsSlice.reducer;

/** The list query's parameters (GET /comparisons). */
export function comparisonsParams(query: ComparisonsQuery): ListQuery {
  return {
    q: query.q.trim() === "" ? undefined : query.q.trim(),
    status: query.status ?? undefined,
    stale: query.stale ?? undefined,
    sort: query.sort,
    limit: COMPARISONS_PAGE_SIZE,
    offset: query.page * COMPARISONS_PAGE_SIZE,
  };
}

/** The cover as the engine takes it (operator text: trimmed only, printed as typed). */
export function coverBody(cover: CoverDraft): Schemas["CoverIn"] {
  return {
    title: cover.title.trim(),
    event: cover.event.trim(),
    judge: cover.judge.trim(),
    council: cover.council.trim(),
  };
}
