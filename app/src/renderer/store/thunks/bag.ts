/**
 * Opening a bag: the renderer sends only its path; the engine reads it (`POST /bags/inspect`) and
 * remembers it in its recent list, so the recent-bags query is refreshed afterwards. The answer
 * names its path: the slice keeps it only while that bag is still the open one.
 */
import { settle } from "@/api/client";
import { activeEngine, ENGINE_NOT_CONNECTED } from "@/api/connection";
import { engineApi } from "@/api/engineApi";
import { appError, isRecord, type ApiErrorShape } from "@/api/errors";
import { bagInspected, bagInspectFailed, bagInspectStarted } from "../slices/bag";
import type { AppThunk } from "./session";

export function inspectBag(path: string): AppThunk<Promise<ApiErrorShape | null>> {
  return async (dispatch) => {
    dispatch(bagInspectStarted(path));
    const engine = activeEngine();
    if (engine === null) {
      dispatch(bagInspectFailed({ path, error: ENGINE_NOT_CONNECTED }));
      return ENGINE_NOT_CONNECTED;
    }
    const result = await settle(() => engine.client.POST("/bags/inspect", { body: { path } }));
    if ("error" in result) {
      dispatch(bagInspectFailed({ path, error: result.error }));
      return result.error;
    }
    if (!isRecord(result.data) || typeof result.data["fingerprint"] !== "string") {
      const error = appError("invalid_response", "the bag information has no fingerprint");
      dispatch(bagInspectFailed({ path, error }));
      return error;
    }
    dispatch(bagInspected({ path, info: result.data }));
    dispatch(engineApi.util.invalidateTags(["RecentBags"]));
    return null;
  };
}
