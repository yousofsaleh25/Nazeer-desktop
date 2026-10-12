/**
 * Types for the store's listener middleware (RTK): the flows that wait or run in the background —
 * autosave, the hover and preview channels, finalize. makeStore() creates one middleware per store
 * (tests build many) and registers the listeners on it.
 */
import type { ThunkDispatch, TypedStartListening, UnknownAction } from "@reduxjs/toolkit";
import type { RootState } from "./store";

export type AppThunkDispatch = ThunkDispatch<RootState, unknown, UnknownAction>;
export type AppStartListening = TypedStartListening<RootState, AppThunkDispatch>;
