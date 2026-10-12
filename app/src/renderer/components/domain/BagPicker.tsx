/**
 * Choose a D455 recording: the system file dialog (filtered to .bag), a pasted path, the recent
 * list (from the engine; a moved or deleted file is marked, not hidden) or the bounded scan of
 * the configured capture folders (main process). The renderer only ever hands a path to the
 * engine; it never reads the multi-GB file itself.
 */
import { FolderOpen, FolderSearch, HardDrive, Settings2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { CaptureScan, ScannedBag } from "@shared/ipc";
import type { RecentBag } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Field";
import { Ltr, Num, PathText } from "@/components/ui/Ltr";
import { Spinner } from "@/components/ui/Spinner";
import { messagePair, translate, useT } from "@/i18n/t";
import { useLanguage } from "@/design/language";
import { byteSize, formatDateTime } from "@/lib/format";

export interface ScanState {
  state: "idle" | "scanning" | "done" | "error";
  result: CaptureScan | null;
}

export interface BagPickerProps {
  recent: readonly RecentBag[];
  scan?: ScanState;
  /** the path being inspected right now (its Open button shows progress) */
  busyPath?: string | null;
  onBrowse: () => void;
  onOpen: (path: string) => void;
  onForget?: (path: string) => void;
  onScan?: () => void;
  onConfigureFolders?: () => void;
}

export function isBagPath(path: string): boolean {
  return /\.bag$/i.test(path.trim());
}

function Size({ bytes }: { bytes: number | null | undefined }) {
  const { lang } = useLanguage();
  if (bytes === null || bytes === undefined) return null;
  const size = byteSize(bytes);
  return (
    <Num value={size.value} digits={size.digits} unit={translate(lang, `units.${size.unit}`)} />
  );
}

function BagLine({
  name,
  path,
  meta,
  disabled,
  busy,
  onOpen,
  extra,
}: {
  name: string;
  path: string;
  meta: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  onOpen: () => void;
  extra?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <HardDrive aria-hidden="true" className="size-4.5 shrink-0 text-ink-muted" />
      <div className="flex min-w-0 flex-1 flex-col">
        <Ltr className="truncate font-medium">{name}</Ltr>
        <PathText path={path} className="truncate text-xs text-ink-muted" />
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-ink-secondary">{meta}</div>
      </div>
      {extra}
      <Button size="sm" variant="secondary" disabled={disabled} loading={busy} onClick={onOpen}>
        <Bi {...messagePair("bag.open")} />
      </Button>
    </li>
  );
}

export function BagPicker({
  recent,
  scan,
  busyPath = null,
  onBrowse,
  onOpen,
  onForget,
  onScan,
  onConfigureFolders,
}: BagPickerProps) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const scanResult = scan?.result ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Card title={messagePair("bag.title")} level={2}>
        <p className="text-sm text-ink-secondary">
          <Bi {...messagePair("bag.intro")} />
        </p>
        <div>
          <Button variant="primary" size="lg" onClick={onBrowse}>
            <FolderOpen aria-hidden="true" />
            <Bi {...messagePair("bag.browse")} />
          </Button>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (isBagPath(typed)) onOpen(typed.trim());
          }}
        >
          <Field label={messagePair("bag.pastePath")} className="min-w-64 flex-1">
            <Input
              dir="ltr"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={"D:\\captures\\20260414_175757-006.bag"}
              spellCheck={false}
            />
          </Field>
          <Button type="submit" disabled={!isBagPath(typed)} loading={busyPath === typed.trim()}>
            <Bi {...messagePair("bag.open")} />
          </Button>
        </form>
      </Card>

      <Card title={messagePair("bag.recent")} level={2}>
        {recent.length === 0 ? (
          <EmptyState title={messagePair("bag.noRecent")} />
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((bag) => (
              <BagLine
                key={bag.path}
                name={bag.name}
                path={bag.path}
                disabled={!bag.exists}
                busy={busyPath === bag.path}
                onOpen={() => onOpen(bag.path)}
                meta={
                  <>
                    <span>
                      <Bi {...messagePair("bag.lastOpened")} />:{" "}
                      <Ltr>{formatDateTime(bag.last_opened_at)}</Ltr>
                    </span>
                    <Size bytes={bag.size_bytes} />
                  </>
                }
                extra={
                  <>
                    {!bag.exists ? (
                      <Chip tone="warning">
                        <Bi {...messagePair("bag.missing")} />
                      </Chip>
                    ) : null}
                    {onForget ? (
                      <IconButton
                        icon={X}
                        size="icon-sm"
                        label={t("bag.forget")}
                        onClick={() => onForget(bag.path)}
                      />
                    ) : null}
                  </>
                }
              />
            ))}
          </ul>
        )}
      </Card>

      {onScan ? (
        <Card
          title={messagePair("bag.captureFolders")}
          level={2}
          actions={
            <>
              {onConfigureFolders ? (
                <Button size="sm" variant="ghost" onClick={onConfigureFolders}>
                  <Settings2 aria-hidden="true" />
                  <Bi {...messagePair("bag.folders")} />
                </Button>
              ) : null}
              <Button size="sm" onClick={onScan} loading={scan?.state === "scanning"}>
                <FolderSearch aria-hidden="true" />
                <Bi {...messagePair("bag.scan")} />
              </Button>
            </>
          }
        >
          {scan?.state === "idle" && scanResult === null ? (
            <p className="text-sm text-ink-secondary">
              <Bi {...messagePair("bag.scanHint")} />
            </p>
          ) : null}
          {scan?.state === "scanning" && scanResult === null ? (
            <p className="flex items-center gap-2 text-sm text-ink-secondary">
              <Spinner size="sm" />
              <Bi {...messagePair("bag.scanning")} />
            </p>
          ) : null}
          {scanResult && scanResult.folders.length === 0 ? (
            <EmptyState
              title={messagePair("bag.noFolders")}
              description={messagePair("bag.noFoldersHint")}
            />
          ) : null}
          {scanResult && scanResult.folders.length > 0 && scanResult.bags.length === 0 ? (
            <EmptyState title={messagePair("bag.noneFound")} />
          ) : null}
          {scanResult && scanResult.bags.length > 0 ? (
            <ul className="divide-y divide-border">
              {scanResult.bags.map((bag: ScannedBag) => (
                <BagLine
                  key={bag.path}
                  name={bag.name}
                  path={bag.path}
                  busy={busyPath === bag.path}
                  onOpen={() => onOpen(bag.path)}
                  meta={
                    <>
                      <Ltr>{formatDateTime(bag.modifiedAt)}</Ltr>
                      <Size bytes={bag.sizeBytes} />
                    </>
                  }
                />
              ))}
            </ul>
          ) : null}
          {scanResult?.truncated ? (
            <p className="text-xs text-warning-text">
              <Bi {...messagePair("bag.truncated")} />
            </p>
          ) : null}
          {scanResult?.errors.map((problem) => (
            <p key={problem.folder} className="text-xs text-danger-text">
              <PathText path={problem.folder} />: <bdi dir="ltr">{problem.message}</bdi>
            </p>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
