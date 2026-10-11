/**
 * The engine sidecar's state in the header: starting / ready / restarting / stopping / stopped
 * (fatal). The tooltip names the engine (version, process id, model) so a support call can tell
 * which engine the app is talking to.
 */
import { CircleCheck, CircleX, LoaderCircle, Power } from "lucide-react";
import type { EngineConnection, EngineStatusName } from "@shared/ipc";
import { Bi } from "@/components/ui/Bi";
import { Chip } from "@/components/ui/Chip";
import { Ltr } from "@/components/ui/Ltr";
import { Tooltip } from "@/components/ui/Tooltip";
import type { Tone } from "@/design";
import { messagePair, useT } from "@/i18n/t";

const TONE: Record<EngineStatusName, Tone> = {
  starting: "warning",
  ready: "success",
  restarting: "warning",
  stopping: "neutral",
  fatal: "danger",
};

const ICON = {
  starting: LoaderCircle,
  ready: CircleCheck,
  restarting: LoaderCircle,
  stopping: Power,
  fatal: CircleX,
} as const;

export interface EngineStatusPillProps {
  status: EngineStatusName;
  connection?: EngineConnection | null;
  restarts?: number;
}

export function EngineStatusPill({
  status,
  connection = null,
  restarts = 0,
}: EngineStatusPillProps) {
  const t = useT();
  const Icon = ICON[status];
  const busy = status === "starting" || status === "restarting";
  return (
    <Tooltip
      content={
        <div className="flex flex-col gap-1">
          <Bi {...messagePair(`engine.status.${status}`)} />
          {connection ? (
            <Ltr className="text-ink-secondary">
              {`engine ${connection.engineVersion} · pid ${connection.pid}`}
            </Ltr>
          ) : null}
          {connection?.stubModel ? (
            <span className="text-warning-text">
              <Bi {...messagePair("engine.stubModel")} />
            </span>
          ) : null}
          {restarts > 0 ? (
            <span className="text-ink-secondary">
              <Bi {...messagePair("engine.restarts")} />: <Ltr>{restarts}</Ltr>
            </span>
          ) : null}
        </div>
      }
    >
      <button
        type="button"
        aria-label={`${t("engine.label")}: ${t(`engine.status.${status}`)}`}
        className="rounded-full"
      >
        <Chip tone={TONE[status]} size="md">
          <span className="inline-flex items-center gap-1.5">
            <Icon
              aria-hidden="true"
              className={busy ? "size-3.5 animate-spin motion-reduce:animate-none" : "size-3.5"}
            />
            <Bi {...messagePair(`engine.status.${status}`)} />
          </span>
        </Chip>
      </button>
    </Tooltip>
  );
}
