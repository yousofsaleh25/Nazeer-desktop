/** IPC handlers. Every channel checks its sender; payloads are validated as channels grow. */
import { ipcMain } from "electron";
import { IPC, type EngineConnection } from "@shared/ipc";
import { isTrustedSender, type SecurityContext } from "./security";

export interface IpcDeps {
  /** The engine connection once the supervisor has a ready engine (Stage 4); null before. */
  getConnection(): EngineConnection | null;
}

export function registerIpc(ctx: SecurityContext, deps: IpcDeps): void {
  ipcMain.handle(IPC.engineGetConnection, (event) => {
    if (!isTrustedSender(event, ctx)) throw new Error("untrusted sender");
    return deps.getConnection();
  });
}
