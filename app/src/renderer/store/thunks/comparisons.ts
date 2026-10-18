/**
 * "Compare again" (D12 F2.7): a stale comparison is never refreshed in place; the operator makes a
 * new one with the same order, cover and language. Each camel's current History row is read again
 * (the engine's eligibility and the image to approve; `GET /sessions?q=<id>`, the exact id picked
 * from the answer): a deleted camel, or one that can no longer join (reopened, not finalized again,
 * files missing…), is left out and named with the engine's reason. The Compare dialog then opens
 * with the rest.
 *
 * Printing a comparison (D12 Stage 5): main fetches each camel's image from the engine, checks it
 * against the approval sent here (or the engine's `approved_by_seal`), lays the page out, prints it
 * and has the engine seal it. The screen showing the sealed PDF then opens the Save dialog once its
 * viewer verified the bytes, as for a session's report.
 */
import type { ComparisonExportResult, NazeerApi } from "@shared/ipc";
import { settle } from "@/api/client";
import { activeEngine, ENGINE_NOT_CONNECTED } from "@/api/connection";
import { engineApi } from "@/api/engineApi";
import { appError, type ApiErrorShape } from "@/api/errors";
import type { ComparisonView, HistoryList } from "@/api/types";
import { readNumber, readRecord } from "@/lib/read";
import {
  compareAgainPrepared,
  comparisonExportFinished,
  comparisonExportStarted,
  exportApprovals,
  memberFromRow,
  type DroppedMember,
  type SelectedMember,
} from "../slices/comparisons";
import { saveOffered } from "../slices/savedFiles";
import type { AppThunk } from "./session";

/** Rows the search may return for one id (ids are unique; the exact one is picked). */
const ID_SEARCH_LIMIT = 20;

export function prepareCompareAgain(view: ComparisonView): AppThunk<Promise<ApiErrorShape | null>> {
  return async (dispatch) => {
    const engine = activeEngine();
    if (engine === null) return ENGINE_NOT_CONNECTED;
    const members: SelectedMember[] = [];
    const dropped: DroppedMember[] = [];
    const ordered = [...view.members].sort((a, b) => a.position - b.position);
    for (const member of ordered) {
      const result = await settle(() =>
        engine.client.GET("/sessions", {
          params: { query: { q: member.session_id, limit: ID_SEARCH_LIMIT } },
        }),
      );
      if ("error" in result) return result.error;
      const list = result.data as HistoryList;
      const row = list.items.find((item) => item.session_id === member.session_id);
      const base = { sessionId: member.session_id, camelId: member.camel_id };
      if (row === undefined) {
        dropped.push({ ...base, group: "comparison_stale", reason: "member_deleted" });
        continue;
      }
      const picked = memberFromRow(row);
      if (!picked.eligible) {
        dropped.push({
          ...base,
          group: "comparison_ineligible",
          reason: picked.reason ?? "files_missing",
        });
        continue;
      }
      members.push(picked);
    }
    const { title, event, judge, council } = view.cover;
    dispatch(
      compareAgainPrepared({
        from: view.comparison_id,
        members,
        cover: { title, event, judge, council },
        language: view.language,
        dropped,
      }),
    );
    return null;
  };
}

function printBridge(): NazeerApi["print"] | undefined {
  return (window as { nazeer?: NazeerApi }).nazeer?.print;
}

/** Print the comparison the screen shows and have the engine seal it (D12 F2.11). */
export function exportComparisonReport(
  view: ComparisonView,
): AppThunk<Promise<ApiErrorShape | null>> {
  return async (dispatch, getState) => {
    const print = printBridge();
    if (print === undefined) return appError("bridge_missing", "printing needs the Nazeer app");
    const id = view.comparison_id;
    const approvals = exportApprovals(getState().comparisons.approvals, view.members);
    if (approvals === null) {
      return appError(
        "comparison_approval_required",
        "approve each camel's image before printing the comparison",
      );
    }
    dispatch(comparisonExportStarted(id));
    let result: ComparisonExportResult;
    try {
      result = await print.exportComparison({
        comparisonId: id,
        model: { version: view.outputs.model.version, sha256: view.outputs.model.sha256 },
        approvals,
      });
    } catch (error) {
      result = {
        ok: false,
        error: appError("print_failed", error instanceof Error ? error.message : String(error)),
        probe: null,
        preflight: null,
        timingsMs: {},
      };
    }
    // read the comparison again after every attempt: sealed, a refused print kept, or sealed
    // although the answer was lost
    dispatch(engineApi.util.invalidateTags(["Comparisons"]));
    dispatch(
      comparisonExportFinished({
        comparisonId: id,
        ok: result.ok,
        error: result.ok ? null : result.error,
        probe: result.probe,
        preflight: result.preflight,
        timingsMs: result.timingsMs,
      }),
    );
    // D12: the screen showing the sealed PDF opens the Save dialog once it verified these bytes
    const version = result.ok
      ? readNumber(readRecord(readRecord(result.comparison, "outputs"), "report"), "version")
      : null;
    if (version !== null) dispatch(saveOffered({ kind: "comparison", id, version }));
    return result.ok ? null : result.error;
  };
}
