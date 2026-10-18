/**
 * "Save as" for a sealed PDF (D12 F1): the button, and what main answered — where the copy was saved
 * (with "Open file" and "Show in folder"), that none is saved yet, or that the saved copy moved or
 * changed since. Main owns the Save dialog, the bytes and the file; this only shows its answers. The
 * engine's sealed copy stays in the app either way.
 */
import { FileDown, FolderOpen, SquareArrowOutUpRight } from "lucide-react";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { PathText } from "@/components/ui/Ltr";
import { messagePair } from "@/i18n/t";
import type { SavedFileEntry } from "@/store/slices/savedFiles";
import { ErrorPanel } from "./ErrorPanel";

export interface SaveCopyPanelProps {
  entry: SavedFileEntry;
  onSave: () => void;
  onOpen: () => void;
  onShow: () => void;
  /** no sealed PDF to save (yet) */
  disabled?: boolean;
}

export function SaveCopyPanel({
  entry,
  onSave,
  onOpen,
  onShow,
  disabled = false,
}: SaveCopyPanelProps) {
  const { copy, saving, checked, unrecorded, error, errorFrom } = entry;
  const saved = copy !== null && copy.exists;
  return (
    <div className="flex flex-col gap-2" data-testid="save-copy">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={onSave} disabled={disabled || saving} loading={saving}>
          <FileDown aria-hidden="true" />
          <Bi {...messagePair("report.saveAs")} />
        </Button>
        {saving ? (
          <span className="text-sm text-ink-secondary" role="status">
            <Bi {...messagePair("report.savingCopy")} />
          </span>
        ) : null}
      </div>
      {saved ? (
        <div className="flex flex-col gap-1 text-sm" data-testid="saved-copy">
          <p className="flex flex-wrap items-baseline gap-x-1.5">
            <Bi {...messagePair("report.savedTo")} />
            <PathText path={copy.path} className="font-mono text-xs break-all" />
          </p>
          {copy.changed ? (
            <p className="text-xs text-warning-text">
              <Bi {...messagePair("report.copyChanged")} />
            </p>
          ) : null}
          {unrecorded ? (
            <p className="text-xs text-warning-text">
              <Bi {...messagePair("report.copyNotRecorded")} />
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={onOpen}>
              <SquareArrowOutUpRight aria-hidden="true" className="rtl:-scale-x-100" />
              <Bi {...messagePair("report.openFile")} />
            </Button>
            <Button size="sm" variant="ghost" onClick={onShow}>
              <FolderOpen aria-hidden="true" />
              <Bi {...messagePair("report.showInFolder")} />
            </Button>
          </div>
        </div>
      ) : checked && !saving ? (
        <p className="text-sm text-ink-secondary" data-testid="not-saved-to-file">
          {copy !== null ? (
            <span className="block text-xs text-warning-text">
              <Bi {...messagePair("report.copyMissing")} />
            </span>
          ) : null}
          <Bi {...messagePair("report.notSavedToFile")} />
        </p>
      ) : null}
      {error !== null ? (
        <ErrorPanel
          error={error}
          context={messagePair(
            errorFrom === "open" ? "report.openCopyFailed" : "report.saveCopyFailed",
          )}
        />
      ) : null}
    </div>
  );
}
