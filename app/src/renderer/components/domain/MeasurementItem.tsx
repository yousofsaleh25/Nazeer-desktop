/**
 * One measurement in the list, rendered from the engine's `presentation` as sent: the value and
 * its uncertainty as text, the kind label, flags, confidence, the depth basis per point, and —
 * for a rejected row — no number, only the reasons (honesty contract). Names and notes are the
 * operator's text in either script (dir="auto").
 */
import { ArrowDown, ArrowUp, Ellipsis, Pencil, StickyNote, Trash2 } from "lucide-react";
import type { MeasurementRow } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Ltr } from "@/components/ui/Ltr";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/Menu";
import { messagePair, useT } from "@/i18n/t";
import { cn } from "@/lib/cn";
import { DepthBasisCell } from "./DepthBasisCell";
import { ConfidenceChip, FlagChip, RejectionChip } from "./FlagChip";

/** saved = the engine has stored it; pending = not saved yet; preview = a live value while drawing */
export type RowStatus = "saved" | "pending" | "preview";

export interface MeasurementActions {
  onSelect?: (id: number) => void;
  onRename?: (id: number) => void;
  onEditNote?: (id: number) => void;
  onMove?: (id: number, delta: -1 | 1) => void;
  onDelete?: (id: number) => void;
}

export interface MeasurementItemProps extends MeasurementActions {
  row: MeasurementRow;
  status?: RowStatus;
  selected?: boolean;
  readOnly?: boolean;
  first?: boolean;
  last?: boolean;
}

export function MeasurementItem({
  row,
  status = "saved",
  selected = false,
  readOnly = false,
  first = false,
  last = false,
  onSelect,
  onRename,
  onEditNote,
  onMove,
  onDelete,
}: MeasurementItemProps) {
  const t = useT();
  const p = row.presentation;
  const editable = !readOnly && (onRename || onEditNote || onMove || onDelete);
  return (
    <li
      data-row={row.id}
      data-status={status}
      aria-current={selected || undefined}
      className={cn(
        "flex flex-col gap-1.5 border-s-4 px-3 py-2.5",
        selected ? "bg-primary-soft" : "hover:bg-surface-hover",
      )}
      style={{ borderInlineStartColor: row.display_color }}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onSelect?.(row.id)}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm text-start"
        >
          <span className="flex max-w-full items-center gap-2">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full border border-white/70"
              style={{ backgroundColor: row.display_color }}
            />
            <bdi dir="auto" className="truncate font-semibold text-ink">
              {row.name || `#${row.id}`}
            </bdi>
            <Ltr className="shrink-0 text-xs text-ink-muted">{`#${row.id}`}</Ltr>
          </span>
          <span className="text-xs text-ink-secondary">
            <Bi {...p.kind_label} />
          </span>
        </button>
        {status !== "saved" ? (
          <Chip tone={status === "pending" ? "warning" : "info"}>
            <Bi {...messagePair(status === "pending" ? "measure.pending" : "measure.preview")} />
          </Chip>
        ) : null}
        {editable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("measure.actions")}>
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {onRename ? (
                <DropdownMenuItem icon={Pencil} onSelect={() => onRename(row.id)}>
                  <Bi {...messagePair("measure.rename")} />
                </DropdownMenuItem>
              ) : null}
              {onEditNote ? (
                <DropdownMenuItem icon={StickyNote} onSelect={() => onEditNote(row.id)}>
                  <Bi {...messagePair("measure.editNote")} />
                </DropdownMenuItem>
              ) : null}
              {onMove ? (
                <>
                  <DropdownMenuItem
                    icon={ArrowUp}
                    disabled={first}
                    onSelect={() => onMove(row.id, -1)}
                  >
                    <Bi {...messagePair("measure.moveUp")} />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={ArrowDown}
                    disabled={last}
                    onSelect={() => onMove(row.id, 1)}
                  >
                    <Bi {...messagePair("measure.moveDown")} />
                  </DropdownMenuItem>
                </>
              ) : null}
              {onDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={Trash2} tone="danger" onSelect={() => onDelete(row.id)}>
                    <Bi {...messagePair("measure.delete")} />
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {p.rejected ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-danger-text">
            <Bi {...messagePair("measure.rejected")} />
          </p>
          <div className="flex flex-wrap gap-1">
            {p.rejection.map((part) => (
              <RejectionChip key={`${part.point}-${part.code}`} part={part} />
            ))}
          </div>
        </div>
      ) : (
        <p className="flex flex-wrap items-baseline gap-x-2 text-ink">
          <span className="text-lg font-semibold">
            <Bi ar={p.value_text.ar} en={p.value_text.en} />
          </span>
          {p.uncertainty_text.en ? (
            <span className="text-sm text-ink-secondary">
              <Bi ar={p.uncertainty_text.ar} en={p.uncertainty_text.en} />
            </span>
          ) : null}
        </p>
      )}

      {p.flags.length > 0 || p.confidence?.["code"] === "low" ? (
        <div className="flex flex-wrap gap-1">
          {p.confidence?.["code"] === "low" ? <ConfidenceChip confidence={p.confidence} /> : null}
          {p.flags.map((flag) => (
            <FlagChip key={flag.code} flag={flag} />
          ))}
        </div>
      ) : null}

      <DepthBasisCell basis={p.depth_basis} />

      {row.note ? (
        <p className="text-xs text-ink-secondary">
          <bdi dir="auto">{row.note}</bdi>
        </p>
      ) : null}
    </li>
  );
}
