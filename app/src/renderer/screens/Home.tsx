/**
 * Open a recording (#/): the system file dialog, a pasted path, the engine's recent list or the
 * bounded scan of the capture folders (main process). The engine inspects the bag — the renderer
 * only ever passes its path — and the frame search starts from its summary.
 */
import { FolderPlus, Images, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { CaptureScan, NazeerApi } from "@shared/ipc";
import { useListRecentBagsQuery, useRemoveRecentBagMutation } from "@/api/engineApi";
import { networkError, toApiError, type ApiErrorShape } from "@/api/errors";
import { BagPicker, type ScanState } from "@/components/domain/BagPicker";
import { BagSummaryCard } from "@/components/domain/BagSummaryCard";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { Bi } from "@/components/ui/Bi";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { PathText } from "@/components/ui/Ltr";
import { messagePair, useT } from "@/i18n/t";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { candidateJobRequested } from "@/store/listeners/candidates";
import { inspectBag } from "@/store/thunks/bag";

function bridge(): NazeerApi | undefined {
  return (window as { nazeer?: NazeerApi }).nazeer;
}

function CaptureFoldersDialog({
  open,
  onOpenChange,
  folders,
  busy,
  onAdd,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: readonly string[];
  busy: boolean;
  onAdd: () => void;
  onRemove: (folder: string) => void;
}) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={messagePair("bag.foldersTitle")}
      description={messagePair("bag.foldersDescription")}
      footer={
        <>
          <Button onClick={onAdd} loading={busy}>
            <FolderPlus aria-hidden="true" />
            <Bi {...messagePair("bag.addFolder")} />
          </Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            <Bi {...messagePair("common.close")} />
          </Button>
        </>
      }
    >
      {folders.length === 0 ? (
        <EmptyState title={messagePair("bag.noFolders")} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {folders.map((folder) => (
            <li key={folder} className="flex items-center gap-2 py-2">
              <PathText path={folder} className="min-w-0 flex-1 truncate text-sm" />
              <IconButton
                icon={X}
                size="icon-sm"
                label={t("bag.removeFolder")}
                disabled={busy}
                onClick={() => onRemove(folder)}
              />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export function Home() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const bag = useAppSelector((state) => state.bag);
  const recent = useListRecentBagsQuery();
  const [forget] = useRemoveRecentBagMutation();
  const [scan, setScan] = useState<ScanState>({ state: "idle", result: null });
  const [problem, setProblem] = useState<ApiErrorShape | null>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [foldersBusy, setFoldersBusy] = useState(false);
  const api = bridge();

  const open = (path: string) => {
    setProblem(null);
    void dispatch(inspectBag(path));
  };

  const browse = () => {
    if (api === undefined) return;
    api.dialogs.openBag().then(
      (path) => {
        if (path !== null) open(path);
      },
      (error: unknown) => setProblem(networkError(error)),
    );
  };

  const runScan = async (): Promise<CaptureScan | null> => {
    if (api === undefined) return null;
    setScan((current) => ({ state: "scanning", result: current.result }));
    try {
      const result = await api.scan.captureFolders();
      setScan({ state: "done", result });
      return result;
    } catch (error) {
      setScan({ state: "error", result: null });
      setProblem(networkError(error));
      return null;
    }
  };

  const changeFolders = async (change: (folders: string[]) => string[] | null) => {
    if (api === undefined) return;
    setFoldersBusy(true);
    try {
      const known = scan.result?.folders ?? (await runScan())?.folders ?? [];
      const next = change([...known]);
      if (next !== null) {
        await api.scan.setFolders(next);
        await runScan();
      }
    } catch (error) {
      setProblem(networkError(error));
    } finally {
      setFoldersBusy(false);
    }
  };

  const addFolder = async () => {
    if (api === undefined) return;
    const folder = await api.dialogs.pickFolder().catch((error: unknown) => {
      setProblem(networkError(error));
      return null;
    });
    if (folder === null) return;
    await changeFolders((folders) => (folders.includes(folder) ? null : [...folders, folder]));
  };

  const findFrames = (force: boolean) => {
    if (bag.info === null) return;
    dispatch(candidateJobRequested({ bagPath: bag.info.path, force }));
    void navigate("/candidates");
  };

  const cached = (bag.info?.cached_candidate_sets.length ?? 0) > 0;

  return (
    <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,30rem)]">
      <div className="flex flex-col gap-1 lg:col-span-2">
        <h1 className="text-2xl font-semibold">
          <Bi {...messagePair("app.name")} />
        </h1>
        <p className="text-ink-secondary">
          <Bi {...messagePair("app.tagline")} />
        </p>
      </div>
      <BagPicker
        recent={recent.data?.items ?? []}
        scan={api ? scan : undefined}
        busyPath={bag.inspect.state === "loading" ? bag.path : null}
        onBrowse={browse}
        onOpen={open}
        onForget={(path) => void forget(path)}
        onScan={api ? () => void runScan() : undefined}
        onConfigureFolders={
          api
            ? () => {
                setFoldersOpen(true);
                if (scan.result === null) void runScan();
              }
            : undefined
        }
      />
      <div className="flex flex-col gap-4">
        {problem ? <ErrorPanel error={problem} /> : null}
        {recent.error ? (
          <ErrorPanel error={toApiError(recent.error)} onRetry={() => void recent.refetch()} />
        ) : null}
        {bag.inspect.state === "error" && bag.inspect.error ? (
          <ErrorPanel
            error={bag.inspect.error}
            context={messagePair("bag.openFailed")}
            onRetry={bag.path ? () => open(bag.path as string) : undefined}
          />
        ) : null}
        {bag.info !== null ? (
          <>
            <BagSummaryCard bag={bag.info} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" onClick={() => findFrames(false)}>
                <Images aria-hidden="true" />
                <Bi {...messagePair(cached ? "bag.showFrames" : "bag.findFrames")} />
              </Button>
              {cached ? (
                <Button size="lg" onClick={() => findFrames(true)}>
                  <RefreshCw aria-hidden="true" />
                  <Bi {...messagePair("bag.searchAgain")} />
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-ink-muted">
              <Bi {...messagePair("bag.findFramesHint")} />
            </p>
          </>
        ) : bag.inspect.state === "loading" ? null : (
          <Card title={messagePair("bag.nextTitle")} level={2}>
            <p className="text-sm text-ink-secondary">
              <Bi {...messagePair("bag.nextHint")} />
            </p>
          </Card>
        )}
      </div>
      <CaptureFoldersDialog
        open={foldersOpen}
        onOpenChange={setFoldersOpen}
        folders={scan.result?.folders ?? []}
        busy={foldersBusy || scan.state === "scanning"}
        onAdd={() => void addFolder()}
        onRemove={(folder) =>
          void changeFolders((folders) => folders.filter((other) => other !== folder))
        }
      />
    </div>
  );
}
