/**
 * What the operator screens show around the engine's state: a waiting panel while the engine
 * starts / restarts / stops, the fatal panel when it cannot run (the code's bilingual label, the
 * engine's or supervisor's message and details, Try again / Open the log folder / Quit), and the
 * banners for a running engine that is degraded (no Arabic text stack, stub model, not
 * answering /health).
 */
import { FolderOpen, Power } from "lucide-react";
import type { EngineConnection, EngineFatal, EngineStatusName } from "@shared/ipc";
import type { ApiErrorShape } from "@/api/errors";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Ltr } from "@/components/ui/Ltr";
import { Spinner } from "@/components/ui/Spinner";
import { messagePair, useT, type MessageKey } from "@/i18n/t";
import { ErrorPanel } from "./ErrorPanel";

const WAIT_TEXT: Record<Exclude<EngineStatusName, "ready" | "fatal">, MessageKey> = {
  starting: "engine.waitStarting",
  restarting: "engine.waitRestarting",
  stopping: "engine.waitStopping",
};

export function EngineWaiting({
  status,
  restarts = 0,
}: {
  status: Exclude<EngineStatusName, "ready" | "fatal">;
  restarts?: number;
}) {
  const t = useT();
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-lg" data-engine-status={status}>
        <div className="flex items-center gap-3">
          <Spinner size="lg" label={t(`engine.status.${status}`)} className="text-primary-text" />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">
              <Bi {...messagePair(`engine.status.${status}`)} />
            </p>
            <p className="text-sm text-ink-secondary">
              <Bi {...messagePair(WAIT_TEXT[status])} />
            </p>
            {restarts > 0 ? (
              <p className="text-xs text-ink-muted">
                <Bi {...messagePair("engine.restarts")} />: <Ltr>{restarts}</Ltr>
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

export function fatalAsError(fatal: EngineFatal): ApiErrorShape {
  const details =
    fatal.exitCode === null ? fatal.details : { ...fatal.details, exit_code: fatal.exitCode };
  return { status: null, code: fatal.code, message: fatal.message, details };
}

export interface EngineFatalPanelProps {
  fatal: EngineFatal;
  /** absent when there is no bridge to act through */
  onRetry?: () => void;
  onOpenLogs?: () => void;
  onQuit?: () => void;
}

export function EngineFatalPanel({ fatal, onRetry, onOpenLogs, onQuit }: EngineFatalPanelProps) {
  return (
    <div className="flex flex-1 items-start justify-center p-8">
      <Card
        className="w-full max-w-2xl"
        title={messagePair("engine.fatalTitle")}
        level={2}
        data-engine-status="fatal"
      >
        <p className="text-sm text-ink-secondary">
          <Bi {...messagePair("engine.fatalHint")} />
        </p>
        {fatal.code === "engine_already_running" ? (
          <Alert tone="warning">
            <Bi {...messagePair("engine.orphanHint")} />
          </Alert>
        ) : null}
        <ErrorPanel
          error={fatalAsError(fatal)}
          onRetry={onRetry}
          actions={
            <>
              {onOpenLogs ? (
                <Button size="sm" variant="ghost" onClick={onOpenLogs}>
                  <FolderOpen aria-hidden="true" />
                  <Bi {...messagePair("engine.openLogs")} />
                </Button>
              ) : null}
              {onQuit ? (
                <Button size="sm" variant="ghost" onClick={onQuit}>
                  <Power aria-hidden="true" />
                  <Bi {...messagePair("engine.quit")} />
                </Button>
              ) : null}
            </>
          }
        />
      </Card>
    </div>
  );
}

export interface EngineBannersProps {
  connection: EngineConnection | null;
  unresponsive: boolean;
  labelsFailed?: boolean;
  onRetryLabels?: () => void;
}

/** The banners for a running engine; null when there is nothing to say. */
export function engineBanners({
  connection,
  unresponsive,
  labelsFailed = false,
  onRetryLabels,
}: EngineBannersProps) {
  const banners = [];
  if (connection !== null && !connection.arabicStackOk) {
    banners.push(
      <Alert key="arabic" tone="danger">
        <Bi {...messagePair("engine.bannerArabicStack")} />
      </Alert>,
    );
  }
  if (unresponsive) {
    banners.push(
      <Alert key="unresponsive" tone="warning" title={messagePair("engine.unresponsive")}>
        <Bi {...messagePair("engine.bannerUnresponsive")} />
      </Alert>,
    );
  }
  if (connection?.stubModel === true) {
    banners.push(
      <Alert key="stub" tone="warning">
        <Bi {...messagePair("engine.bannerStubModel")} />
      </Alert>,
    );
  }
  if (labelsFailed) {
    banners.push(
      <Alert
        key="labels"
        tone="warning"
        actions={
          onRetryLabels ? (
            <Button size="sm" variant="ghost" onClick={onRetryLabels}>
              <Bi {...messagePair("common.retry")} />
            </Button>
          ) : undefined
        }
      >
        <Bi {...messagePair("engine.labelsFailed")} />
      </Alert>,
    );
  }
  return banners.length > 0 ? <>{banners}</> : null;
}
