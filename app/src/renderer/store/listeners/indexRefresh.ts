/**
 * The History and Comparisons lists follow the open session (D12 F2.7): when its status, its image
 * or its sealed report changes — finalize, reopen, a seal — the cached lists are dropped, so History
 * shows the row's new eligibility and the Comparisons tab the comparisons that turned stale. (The
 * engine computes both on every list; this only makes sure the app asks again.)
 */
import { engineApi } from "@/api/engineApi";
import type { SessionView } from "@/api/types";
import type { AppStartListening } from "../listener";

function mark(view: SessionView | null): string {
  if (view === null) return "";
  const overlay = view.outputs.overlay;
  const report = view.outputs.report;
  return [
    view.session_id,
    view.status,
    overlay ? `${overlay.version}:${overlay.sha256}` : "-",
    report ? String(report.version) : "-",
  ].join("|");
}

export function startIndexRefresh(startListening: AppStartListening): void {
  startListening({
    predicate: (_action, current, previous) => {
      const now = current.session.view;
      const before = previous.session.view;
      if (now === before || now === null || before === null) return false;
      return now.session_id === before.session_id && mark(now) !== mark(before);
    },
    effect: (_action, api) => {
      api.dispatch(engineApi.util.invalidateTags(["History", "Comparisons"]));
    },
  });
}
