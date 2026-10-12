/**
 * The frame of every operator route: AppShell with the engine's status, the engine banners, and
 * the screen itself only while the engine is ready (otherwise the waiting or fatal panel). The
 * engine's /meta/labels feed the LabelsProvider; while they are missing, codes show raw (D9).
 */
import { Images, Ruler } from "lucide-react";
import { Outlet } from "react-router";
import type { NazeerApi } from "@shared/ipc";
import { useGetLabelsQuery } from "@/api/engineApi";
import { AppShell, type NavItem } from "@/components/domain/AppShell";
import { EngineFatalPanel, EngineWaiting, engineBanners } from "@/components/domain/EngineGate";
import { LabelsProvider } from "@/components/domain/labels";
import { UNSAVED_STATES, UnsavedBadge } from "@/components/domain/UnsavedBadge";
import { messagePair } from "@/i18n/t";
import { useAppSelector } from "@/store/hooks";
import { saveStateOf } from "@/store/session/selectors";

function bridge(): NazeerApi | undefined {
  return (window as { nazeer?: NazeerApi }).nazeer;
}

/** The frame search and the open session, as links in the header; the session's entry carries
 * its save state while the engine does not hold everything yet, so unsaved work stays visible
 * from every screen (operator, 2026-10-12). */
function useWork(): NavItem[] {
  const candidates = useAppSelector((state) => state.candidates);
  const sessionId = useAppSelector((state) =>
    state.session.load.state === "ready" ? state.session.id : null,
  );
  const camelId = useAppSelector((state) => state.session.draft?.camelId ?? "");
  const saveState = useAppSelector((state) =>
    state.session.load.state === "ready" ? saveStateOf(state.session) : null,
  );
  const work: NavItem[] = [];
  if (candidates.bagPath !== null || candidates.set !== null) {
    const set = candidates.set;
    work.push({
      to: set === null ? "/candidates" : `/candidates/${set.fingerprint}/${set.paramsHash}`,
      label: messagePair("nav.frames"),
      icon: Images,
    });
  }
  if (sessionId !== null) {
    work.push({
      to: `/sessions/${sessionId}`,
      label: messagePair("nav.session"),
      icon: Ruler,
      detail: camelId,
      status:
        saveState !== null && UNSAVED_STATES.has(saveState) ? (
          <UnsavedBadge state={saveState} compact />
        ) : undefined,
    });
  }
  return work;
}

export function OperatorLayout() {
  const engine = useAppSelector((state) => state.engine);
  const ready = engine.status === "ready";
  const labels = useGetLabelsQuery(undefined, { skip: !ready });
  const work = useWork();
  const api = bridge();

  let body;
  if (ready) {
    body = (
      <LabelsProvider labels={labels.data ?? null}>
        <Outlet />
      </LabelsProvider>
    );
  } else if (engine.status === "fatal" && engine.fatal !== null) {
    body = (
      <EngineFatalPanel
        fatal={engine.fatal}
        onRetry={api ? () => void api.engine.retry() : undefined}
        onOpenLogs={api ? () => void api.app.openLogFolder() : undefined}
        onQuit={api ? () => window.close() : undefined}
      />
    );
  } else {
    const status =
      engine.status === "restarting" || engine.status === "stopping" ? engine.status : "starting";
    body = <EngineWaiting status={status} restarts={engine.restarts} />;
  }

  return (
    <AppShell
      engine={{ status: engine.status, connection: engine.connection, restarts: engine.restarts }}
      work={ready ? work : []}
      banner={engineBanners({
        connection: ready ? engine.connection : null,
        unresponsive: ready && engine.unresponsive,
        labelsFailed: ready && labels.isError,
        onRetryLabels: () => void labels.refetch(),
      })}
    >
      {body}
    </AppShell>
  );
}
