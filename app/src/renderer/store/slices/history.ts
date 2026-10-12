/**
 * History's query (the list itself is RTK Query `listSessions`, reconciled by the engine on every
 * call): search text, status, index state, sort and page. Every status and index state is listed
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
  sort: HistorySort;
  page: number;
}

export const HISTORY_INITIAL: HistoryState = {
  q: "",
  status: null,
  indexState: null,
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

/** The list query's parameters (GET /sessions). */
export function historyParams(state: HistoryState): ListQuery {
  return {
    q: state.q.trim() === "" ? undefined : state.q.trim(),
    status: state.status ?? undefined,
    index_state: state.indexState ?? undefined,
    sort: state.sort,
    limit: HISTORY_PAGE_SIZE,
    offset: state.page * HISTORY_PAGE_SIZE,
  };
}
