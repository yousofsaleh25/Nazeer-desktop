/**
 * The bag the operator opened (Home): its path and what the engine read from it
 * (`POST /bags/inspect`: size, duration, streams, intrinsics, fingerprint, cached candidate sets).
 * The engine adds an inspected bag to its recent list; the renderer only ever passes the path.
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ApiErrorShape } from "@/api/errors";
import type { BagInfo } from "@/api/types";

export interface BagState {
  path: string | null;
  info: BagInfo | null;
  inspect: { state: "idle" | "loading" | "ready" | "error"; error: ApiErrorShape | null };
}

export const BAG_INITIAL: BagState = {
  path: null,
  info: null,
  inspect: { state: "idle", error: null },
};

const bagSlice = createSlice({
  name: "bag",
  initialState: BAG_INITIAL,
  reducers: {
    bagInspectStarted(_state, action: PayloadAction<string>) {
      return { path: action.payload, info: null, inspect: { state: "loading", error: null } };
    },
    bagInspected(state, action: PayloadAction<BagInfo>) {
      state.info = action.payload;
      state.inspect = { state: "ready", error: null };
    },
    bagInspectFailed(state, action: PayloadAction<ApiErrorShape>) {
      state.inspect = { state: "error", error: action.payload };
    },
    bagCleared() {
      return BAG_INITIAL;
    },
  },
});

export const { bagInspectStarted, bagInspected, bagInspectFailed, bagCleared } = bagSlice.actions;
export const bagReducer = bagSlice.reducer;
