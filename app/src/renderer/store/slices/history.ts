/**
 * History's query (the list itself is RTK Query `listSessions`, reconciled by the engine on every
 * call): search text, status, index state, event, measuring dates (D12: to find the camels of one
 * day for a comparison), sort and page. Every status and index state is listed
 * (corrupt, missing files, unindexed, delete failed), never hidden.
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { operations } from "@shared/api";

type ListQuery = NonNullable<operations["list_sessions"]["parameters"]["query"]>;
export type HistorySort = NonNullable<ListQuery["sort"]>;
export type HistoryStatus = NonNullable<ListQuery["status"]>;
export type HistoryIndexState = NonNullable<ListQuery["index_state"]>;

export const HISTORY_PAGE_SIZE = 50;

export interface HistoryState {
  q: string;
  status: HistoryStatus | null;
  indexState: HistoryIndexState | null;
  /** part of the event name */
  event: string;
  /** measured on or after / on or before this local day ("YYYY-MM-DD"; "" = no bound) */
  createdFrom: string;
  createdTo: string;
  sort: HistorySort;
  page: number;
}

export const HISTORY_INITIAL: HistoryState = {
  q: "",
  status: null,
  indexState: null,
  event: "",
  createdFrom: "",
  createdTo: "",
  sort: "updated_desc",
  page: 0,
};

const historySlice = createSlice({
  name: "history",
  initialState: HISTORY_INITIAL,
  reducers: {
    historyQueryChanged(state, action: PayloadAction<Partial<Omit<HistoryState, "page">>>) {
      Object.assign(state, action.payload);
      state.page = 0;
    },
    historyPageChanged(state, action: PayloadAction<number>) {
      state.page = Math.max(0, Math.floor(action.payload));
    },
    historyReset() {
      return HISTORY_INITIAL;
    },
  },
});

export const { historyQueryChanged, historyPageChanged, historyReset } = historySlice.actions;
export const historyReducer = historySlice.reducer;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A local day's first or last instant as ISO 8601 (the engine compares instants; both bounds are
 * inclusive); undefined for "" or a malformed day.
 */
export function dayBound(day: string, end: "start" | "end"): string | undefined {
  const match = DAY.exec(day);
  if (match === null) return undefined;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date =
    end === "start" ? new Date(y, m - 1, d, 0, 0, 0, 0) : new Date(y, m - 1, d, 23, 59, 59, 999);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return undefined;
  }
  return date.toISOString();
}

/** Some filter narrows the list (an empty list then means "no match", not "no sessions"). */
export function historyFiltered(state: HistoryState): boolean {
  return Boolean(
    state.q.trim() ||
    state.status ||
    state.indexState ||
    state.event.trim() ||
    state.createdFrom ||
    state.createdTo,
  );
}

/** The list query's parameters (GET /sessions). */
export function historyParams(state: HistoryState): ListQuery {
  return {
    q: state.q.trim() === "" ? undefined : state.q.trim(),
    status: state.status ?? undefined,
    index_state: state.indexState ?? undefined,
    event: state.event.trim() === "" ? undefined : state.event.trim(),
    created_from: dayBound(state.createdFrom, "start"),
    created_to: dayBound(state.createdTo, "end"),
    sort: state.sort,
    limit: HISTORY_PAGE_SIZE,
    offset: state.page * HISTORY_PAGE_SIZE,
  };
}
