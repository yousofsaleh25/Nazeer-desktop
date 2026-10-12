/**
 * The engine sidecar as main's supervisor reports it (EngineStatusEvent over the bridge). An event
 * whose `seq` is not newer than the one applied is dropped (a getStatus() reply racing a push).
 * Without the bridge (the page opened outside Electron) the app cannot work: `bridge_missing`.
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  EngineConnection,
  EngineFatal,
  EngineStatusEvent,
  EngineStatusName,
} from "@shared/ipc";

export interface EngineState {
  seq: number;
  status: EngineStatusName;
  connection: EngineConnection | null;
  fatal: EngineFatal | null;
  restarts: number;
  unresponsive: boolean;
}

export const ENGINE_INITIAL: EngineState = {
  seq: -1,
  status: "starting",
  connection: null,
  fatal: null,
  restarts: 0,
  unresponsive: false,
};

const engineSlice = createSlice({
  name: "engine",
  initialState: ENGINE_INITIAL,
  reducers: {
    engineStatusReceived(state, action: PayloadAction<EngineStatusEvent>) {
      const event = action.payload;
      if (event.seq <= state.seq) return state;
      return {
        seq: event.seq,
        status: event.status,
        connection: event.connection,
        fatal: event.fatal,
        restarts: event.restarts,
        unresponsive: event.unresponsive,
      };
    },
    engineBridgeMissing(state) {
      state.status = "fatal";
      state.connection = null;
      state.fatal = {
        code: "bridge_missing",
        message: "window.nazeer is not available: the page is not running inside the Nazeer app",
        details: {},
        exitCode: null,
      };
    },
  },
});

export const { engineStatusReceived, engineBridgeMissing } = engineSlice.actions;
export const engineReducer = engineSlice.reducer;
