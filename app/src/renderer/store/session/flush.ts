/**
 * Flushing autosave before something that must not lose work: quitting (main waits 3 s for the
 * answer, D9 "Quit"), leaving the measuring screen, closing the session. The pending save goes out
 * at once; the answer is whether unsaved work remains when it settles, or when 2.5 s have passed,
 * or as soon as saving cannot continue (engine offline, a terminal error, a conflict).
 */
import type { AppThunkDispatch } from "../listener";
import { autosaveFlushRequested, shouldSave } from "../listeners/autosave";
import { sessionClosed } from "../slices/session";
import type { RootState } from "../store";
import { hasUnsavedWork } from "./selectors";

export const FLUSH_TIMEOUT_MS = 2500;

export interface StoreLike {
  dispatch: AppThunkDispatch;
  getState(): RootState;
  subscribe(listener: () => void): () => void;
}

/** Resolves true once `ready()` holds (checked after every store update), false on timeout. */
export function waitUntil(
  store: StoreLike,
  ready: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);
    const unsubscribe = store.subscribe(() => {
      if (!ready()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

function settled(state: RootState): boolean {
  const session = state.session;
  if (session.inFlight !== null) return false;
  const stuck =
    session.save.offline !== null || session.save.error !== null || session.save.conflict !== null;
  return stuck || !shouldSave(session);
}

export async function flushAutosave(
  store: StoreLike,
  timeoutMs: number = FLUSH_TIMEOUT_MS,
): Promise<{ unsaved: boolean }> {
  store.dispatch(autosaveFlushRequested());
  await waitUntil(store, () => settled(store.getState()), timeoutMs);
  return { unsaved: hasUnsavedWork(store.getState().session) };
}

/** Leave the session: flush, then forget it; unsaved work is reported, not dropped silently. */
export async function closeSession(store: StoreLike): Promise<{ unsaved: boolean }> {
  const result = await flushAutosave(store);
  if (!result.unsaved) store.dispatch(sessionClosed());
  return result;
}
