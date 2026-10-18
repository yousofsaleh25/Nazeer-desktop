/**
 * The camels ticked for a comparison (D12): how many of the most the engine takes, Clear, and
 * Compare, which opens the Compare dialog. Sticks to the bottom of the History list while camels are
 * ticked, so the count stays in view across pages and filters.
 */
import { GitCompareArrows, X } from "lucide-react";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Num } from "@/components/ui/Ltr";
import { messagePair } from "@/i18n/t";

export interface CompareBarProps {
  count: number;
  /** the engine's maximum (null: not known; the engine still refuses beyond it) */
  max: number | null;
  onClear: () => void;
  onCompare: () => void;
}

export function CompareBar({ count, max, onClear, onCompare }: CompareBarProps) {
  if (count === 0) return null;
  const full = max !== null && count >= max;
  return (
    <div
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-raised px-3.5 py-2.5 shadow-md"
      data-testid="compare-bar"
    >
      <p className="flex items-baseline gap-2 text-sm" role="status">
        <Bi {...messagePair("compare.selected")} />
        <span className="font-semibold">
          <Num value={count} />
          {max !== null ? (
            <>
              {" / "}
              <Num value={max} />
            </>
          ) : null}
        </span>
        {full ? (
          <span className="text-xs text-ink-secondary">
            <Bi {...messagePair("compare.full")} />
          </span>
        ) : null}
      </p>
      <div className="ms-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onClear}>
          <X aria-hidden="true" />
          <Bi {...messagePair("compare.clear")} />
        </Button>
        <Button size="sm" variant="primary" onClick={onCompare}>
          <GitCompareArrows aria-hidden="true" />
          <Bi {...messagePair("compare.open")} /> <Num value={count} />
        </Button>
      </div>
    </div>
  );
}
