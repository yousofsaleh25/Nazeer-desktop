/**
 * Feeds main's supervisor status into the store: one push subscription plus one getStatus() for
 * the state at load (the `seq` check drops whichever arrives older). When the connection changes
 * (ready, restart, stop) the client is rebuilt for the new port and token and the RTK Query cache
 * is reset, so no request or cached answer of the previous engine is reused. The new client is
 * installed before the event is dispatched: listeners run inside the dispatch, and the one that
 * catches up after a restart (autosave) must already call the new engine.
 */
import type { EngineConnection, EngineStatusEvent, NazeerApi } from "@shared/ipc";
import { setEngineConnection } from "@/api/connection";
import { engineApi } from "@/api/engineApi";
import { engineBridgeMissing, engineReducer, engineStatusReceived } from "./slices/engine";
import type { AppStore } from "./store";

function connectionKey(connection: EngineConnection | null): string {
  return connection === null ? "" : `${connection.baseUrl}|${connection.token}|${connection.pid}`;
}

export function connectEngineBridge(
  store: AppStore,
  bridge: NazeerApi["engine"] | undefined,
): () => void {
  if (bridge === undefined) {
    store.dispatch(engineBridgeMissing());
    return () => undefined;
  }
  let disposed = false;
  const apply = (event: EngineStatusEvent): void => {
    if (disposed) return;
    const action = engineStatusReceived(event);
    const before = store.getState().engine;
    // the state the slice will keep (it drops an event older than the one applied)
    const connection = engineReducer(before, action).connection;
    const changed = connectionKey(connection) !== connectionKey(before.connection);
    if (changed) setEngineConnection(connection);
    store.dispatch(action);
    if (changed) store.dispatch(engineApi.util.resetApiState());
  };
  const unsubscribe = bridge.onStatus(apply);
  void bridge.getStatus().then(apply, () => undefined);
  return () => {
    disposed = true;
    unsubscribe();
  };
}
