/** The operator window's bridge: a typed, minimal window.nazeer (no raw ipcRenderer). */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type EngineConnection, type EngineStatusEvent, type NazeerApi } from "@shared/ipc";

const api: NazeerApi = {
  engine: {
    getConnection: () =>
      ipcRenderer.invoke(IPC.engineGetConnection) as Promise<EngineConnection | null>,
    onStatus: (listener) => {
      const handler = (_event: IpcRendererEvent, payload: EngineStatusEvent): void =>
        listener(payload);
      ipcRenderer.on(IPC.engineStatus, handler);
      return () => {
        ipcRenderer.removeListener(IPC.engineStatus, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld("nazeer", api);
