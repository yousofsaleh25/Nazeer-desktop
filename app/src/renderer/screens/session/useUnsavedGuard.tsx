/**
 * Before another session replaces the open one (opening, creating, reopening from History): the
 * open session's pending autosave goes out first; work that still cannot be saved (the engine is
 * unreachable, a conflict is open) is never dropped silently — the operator decides in a
 * confirmation dialog.
 */
import { useCallback, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Ltr } from "@/components/ui/Ltr";
import { messagePair } from "@/i18n/t";
import { useAppStore } from "@/store/hooks";
import { flushAutosave } from "@/store/session/flush";
import { hasUnsavedWork } from "@/store/session/selectors";

export interface UnsavedGuard {
  /** true when the open session may be replaced by `targetId` (saved, or discarding confirmed) */
  confirmDiscard: (targetId: string | null) => Promise<boolean>;
  /** the confirmation dialog, to render once */
  dialog: ReactNode;
}

export function useUnsavedGuard(): UnsavedGuard {
  const store = useAppStore();
  const [asking, setAsking] = useState<{
    sessionId: string;
    resolve: (discard: boolean) => void;
  } | null>(null);

  const confirmDiscard = useCallback(
    async (targetId: string | null): Promise<boolean> => {
      const current = store.getState().session;
      if (current.id === null || current.id === targetId || !hasUnsavedWork(current)) return true;
      const { unsaved } = await flushAutosave(store);
      if (!unsaved) return true;
      const sessionId = current.id;
      return new Promise<boolean>((resolve) => setAsking({ sessionId, resolve }));
    },
    [store],
  );

  const answer = (discard: boolean) => {
    asking?.resolve(discard);
    setAsking(null);
  };

  const dialog =
    asking === null ? null : (
      <ConfirmDialog
        open
        onOpenChange={(open) => {
          if (!open) answer(false);
        }}
        title={messagePair("unsaved.title")}
        description={messagePair("unsaved.description")}
        confirmLabel={messagePair("unsaved.discard")}
        cancelLabel={messagePair("unsaved.keep")}
        tone="danger"
        onConfirm={() => answer(true)}
      >
        <p className="text-xs text-ink-muted">
          <Ltr className="font-mono">{asking.sessionId}</Ltr>
        </p>
      </ConfirmDialog>
    );

  return { confirmDiscard, dialog };
}
