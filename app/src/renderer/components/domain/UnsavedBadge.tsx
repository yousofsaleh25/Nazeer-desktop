/**
 * The autosave state of the open session, always visible on the measuring screen (C3.4): never
 * silent about unsaved work. States come from the session slice's save machine (Stage 5).
 */
import { CircleAlert, CircleCheck, CloudOff, GitMerge, Lock, Pencil } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Bi } from "@/components/ui/Bi";
import { Chip } from "@/components/ui/Chip";
import { Ltr } from "@/components/ui/Ltr";
import { Spinner } from "@/components/ui/Spinner";
import type { Tone } from "@/design";
import { messagePair } from "@/i18n/t";

export type SaveState =
  "clean" | "dirty" | "saving" | "error" | "offline" | "blocked" | "conflict" | "finalizing";

const LOOK: Record<SaveState, { tone: Tone; icon: LucideIcon | null }> = {
  clean: { tone: "success", icon: CircleCheck },
  dirty: { tone: "warning", icon: Pencil },
  saving: { tone: "info", icon: null },
  error: { tone: "danger", icon: CircleAlert },
  offline: { tone: "danger", icon: CloudOff },
  blocked: { tone: "neutral", icon: Lock },
  conflict: { tone: "danger", icon: GitMerge },
  finalizing: { tone: "info", icon: null },
};

export interface UnsavedBadgeProps {
  state: SaveState;
  /** the stored revision (shown when clean) */
  revision?: number | null;
  /** the smaller chip (the open session's entry in the header) */
  compact?: boolean;
}

/** States that mean the engine does not hold everything the operator did yet. */
export const UNSAVED_STATES: ReadonlySet<SaveState> = new Set([
  "dirty",
  "saving",
  "error",
  "offline",
  "conflict",
  "finalizing",
]);

export function UnsavedBadge({ state, revision = null, compact = false }: UnsavedBadgeProps) {
  const { tone, icon: Icon } = LOOK[state];
  return (
    <span role="status" aria-live="polite" data-state={state} className="inline-flex">
      <Chip tone={tone} size={compact ? "sm" : "md"}>
        <span className="inline-flex items-center gap-1.5">
          {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : <Spinner size="sm" />}
          <Bi {...messagePair(`save.${state}`)} />
          {state === "clean" && revision !== null ? (
            <Ltr className="text-[0.85em] opacity-80">{`r${revision}`}</Ltr>
          ) : null}
        </span>
      </Chip>
    </span>
  );
}
