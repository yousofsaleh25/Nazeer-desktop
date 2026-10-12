/**
 * The measuring screen's side pieces: the hover readout (its own subscription, so pointer traffic
 * re-renders only it), the session's text fields, the save problems (a conflict to resolve, a
 * terminal error, the engine unreachable, a sealed session), the line picker of a 4-point angle,
 * the drawing hint, and the rename / note / colour dialogs.
 */
import { GitMerge, LockOpen } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { InputKind, MeasurementInput, MeasurementRow } from "@/api/types";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { HoverReadout } from "@/components/domain/HoverReadout";
import { is2dKind } from "@/components/domain/measure/interaction";
import { NamePrompt } from "@/components/domain/NamePrompt";
import { CodeLabel, useLabel } from "@/components/domain/labels";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Kbd } from "@/components/ui/Kbd";
import { Ltr, Num } from "@/components/ui/Ltr";
import { MEASURE_PALETTE } from "@/design";
import { messagePair, useT, type MessageKey } from "@/i18n/t";
import { cn } from "@/lib/cn";
import { useAppSelector } from "@/store/hooks";
import type { TextField } from "@/store/session/document";
import type { RebaseConflict } from "@/store/session/rebase";
import type { SaveFlags } from "@/store/slices/session";

/** The engine's limits for operator text (MeasurementInputModel, DocumentIn). */
export const MAX_NAME = 200;
export const MAX_NOTE = 2000;
export const TEXT_LIMITS: Record<TextField, number> = { camelId: 64, operator: 100, notes: 4000 };

export function HoverPanel({ tool }: { tool: InputKind | null }) {
  const depth = useAppSelector((state) => state.session.depth);
  return (
    <HoverReadout depth={depth.result} pending={depth.inFlight !== null} tool2d={is2dKind(tool)} />
  );
}

/** A text field that edits the draft when it loses focus (or on Enter): one undo step per edit. */
function CommitField({
  label,
  value,
  maxLength,
  multiline = false,
  disabled,
  hint,
  onCommit,
}: {
  label: MessageKey;
  value: string;
  maxLength: number;
  multiline?: boolean;
  disabled: boolean;
  hint?: MessageKey;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const shown = editing ?? value;
  const commit = () => {
    if (editing !== null && editing.trim() !== value) onCommit(editing.trim());
    setEditing(null);
  };
  const common = {
    value: shown,
    disabled,
    onChange: (event: { target: { value: string } }) => setEditing(event.target.value),
    onBlur: commit,
  };
  return (
    <Field label={messagePair(label)} hint={hint ? messagePair(hint) : undefined}>
      {multiline ? (
        <Textarea {...common} maxLength={maxLength} />
      ) : (
        <Input
          {...common}
          maxLength={maxLength}
          autoComplete="off"
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
      )}
    </Field>
  );
}

export function SessionDetailsCard({
  camelId,
  operator,
  notes,
  editable,
  onEdit,
}: {
  camelId: string;
  operator: string;
  notes: string;
  editable: boolean;
  onEdit: (field: TextField, value: string) => void;
}) {
  return (
    <Card title={messagePair("session.details")}>
      <CommitField
        label="session.camelId"
        hint="session.camelIdHint"
        value={camelId}
        maxLength={TEXT_LIMITS.camelId}
        disabled={!editable}
        onCommit={(value) => onEdit("camelId", value)}
      />
      <CommitField
        label="session.operator"
        value={operator}
        maxLength={TEXT_LIMITS.operator}
        disabled={!editable}
        onCommit={(value) => onEdit("operator", value)}
      />
      <CommitField
        label="session.notes"
        value={notes}
        maxLength={TEXT_LIMITS.notes}
        multiline
        disabled={!editable}
        onCommit={(value) => onEdit("notes", value)}
      />
    </Card>
  );
}

const CONFLICT_KEYS: Record<RebaseConflict["kind"], MessageKey> = {
  both_edited: "conflict.kinds.both_edited",
  edited_deleted: "conflict.kinds.edited_deleted",
  deleted_edited: "conflict.kinds.deleted_edited",
  both_added: "conflict.kinds.both_added",
  order: "conflict.kinds.order",
  field: "conflict.kinds.field",
};

const FIELD_KEYS: Record<TextField, MessageKey> = {
  camelId: "session.camelId",
  operator: "session.operator",
  notes: "session.notes",
};

function ConflictLine({
  conflict,
  names,
}: {
  conflict: RebaseConflict;
  names: ReadonlyMap<number, string>;
}) {
  const name = conflict.id === undefined ? undefined : names.get(conflict.id);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      {conflict.id !== undefined ? (
        <span className="font-medium">
          {name ? <bdi dir="auto">{name}</bdi> : null} <Ltr>{`#${conflict.id}`}</Ltr>
        </span>
      ) : null}
      {conflict.field !== undefined ? (
        <span className="font-medium">
          <Bi {...messagePair(FIELD_KEYS[conflict.field])} />
        </span>
      ) : null}
      <span className="text-ink-secondary">
        <Bi {...messagePair(CONFLICT_KEYS[conflict.kind])} />
      </span>
    </li>
  );
}

/** Save problems, in the order the badge ranks them; nothing when the save machine is fine. */
export function SaveProblems({
  save,
  status,
  dirty,
  names,
  onKeepMine,
  onTakeTheirs,
  onReopen,
  reopening,
}: {
  save: SaveFlags;
  status: string;
  /** the draft differs from what the engine holds */
  dirty: boolean;
  names: ReadonlyMap<number, string>;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  onReopen: () => void;
  reopening: boolean;
}) {
  const items: ReactNode[] = [];
  if (save.conflict !== null) {
    items.push(
      <Alert
        key="conflict"
        tone="danger"
        icon={GitMerge}
        title={messagePair("conflict.title")}
        actions={
          <>
            <Button size="sm" onClick={onTakeTheirs}>
              <Bi {...messagePair("conflict.takeTheirs")} />
            </Button>
            <Button size="sm" variant="primary" onClick={onKeepMine}>
              <Bi {...messagePair("conflict.keepMine")} />
            </Button>
          </>
        }
      >
        <Bi {...messagePair("conflict.description")} />
        <ul className="mt-1 flex flex-col gap-0.5">
          {save.conflict.conflicts.map((conflict, i) => (
            <ConflictLine key={i} conflict={conflict} names={names} />
          ))}
        </ul>
      </Alert>,
    );
  }
  if (save.blocked && status !== "open") {
    items.push(
      <Alert
        key="blocked"
        tone="neutral"
        title={messagePair("save.blockedTitle")}
        actions={
          <Button size="sm" onClick={onReopen} loading={reopening}>
            <LockOpen aria-hidden="true" />
            <Bi {...messagePair("history.reopen")} />
          </Button>
        }
      >
        <Bi {...messagePair(dirty ? "save.blockedUnsaved" : "save.blockedHint")} />
      </Alert>,
    );
  }
  if (save.offline !== null) {
    items.push(
      <Alert key="offline" tone="warning" title={messagePair("save.offline")}>
        <span>
          <Bi {...messagePair("save.offlineHint")} /> (
          <Bi {...messagePair("save.attempts")} />: <Num value={save.offline.attempts} />)
        </span>
      </Alert>,
    );
  }
  if (save.error !== null) {
    items.push(
      <ErrorPanel
        key="error"
        error={save.error.error}
        context={messagePair("save.errorContext")}
        actions={
          <span className="text-xs text-ink-secondary">
            <Bi {...messagePair("save.errorHint")} />
          </span>
        }
      />,
    );
  }
  return items.length === 0 ? null : <div className="flex flex-col gap-2">{items}</div>;
}

/** The lines a 4-point angle can use: the session's 2D and 3D distances. */
export function LinePicker({
  rows,
  picks,
  onToggle,
}: {
  rows: readonly MeasurementRow[];
  picks: readonly number[];
  onToggle: (id: number) => void;
}) {
  const lines = rows.filter((row) => row.family === "lines");
  return (
    <Card title={messagePair("measure.lines.title")}>
      <p className="text-sm text-ink-secondary">
        <Bi {...messagePair("measure.lines.hint")} />
      </p>
      {lines.length === 0 ? (
        <p className="text-sm text-ink-muted">
          <Bi {...messagePair("measure.lines.none")} />
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {lines.map((line) => {
            const picked = picks.includes(line.id);
            return (
              <li key={line.id}>
                <Button
                  size="sm"
                  variant={picked ? "primary" : "secondary"}
                  aria-pressed={picked}
                  onClick={() => onToggle(line.id)}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: line.display_color }}
                  />
                  <bdi dir="auto">{line.name || `#${line.id}`}</bdi>
                  <Ltr className="text-[0.85em] opacity-75">{`#${line.id}`}</Ltr>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const HINT_KEYS: Record<InputKind, MessageKey> = {
  distance_2d: "measure.hints.distance",
  distance_3d: "measure.hints.distance3d",
  curve_2d: "measure.hints.curve",
  curve_3d: "measure.hints.curve3d",
  angle_2d_3point: "measure.hints.angle3",
  angle_3d_3point: "measure.hints.angle3d",
  angle_2d_from_horizontal: "measure.hints.horizontal",
  angle_4point: "measure.hints.angle4",
};

/** What the chosen kind expects, and the keyboard (the canvas's aria-describedby). */
export function MeasureHint({
  id,
  tool,
  editable,
  points,
}: {
  id: string;
  tool: InputKind | null;
  editable: boolean;
  points: number;
}) {
  const key: MessageKey = !editable
    ? "measure.hints.readOnly"
    : tool === null
      ? "measure.hints.none"
      : HINT_KEYS[tool];
  return (
    <div id={id} className="flex flex-col gap-1 text-sm text-ink-secondary">
      <p>
        {tool !== null && editable ? (
          <span className="me-1 font-medium text-ink">
            <CodeLabel group="input_kinds" code={tool} />:
          </span>
        ) : null}
        <Bi {...messagePair(key)} />
        {points > 0 ? (
          <span className="ms-2 text-ink-muted">
            (<Bi {...messagePair("measure.pointsPlaced")} />: <Num value={points} />)
          </span>
        ) : null}
      </p>
      <p className="flex flex-wrap items-center gap-x-1 text-xs text-ink-muted">
        <Kbd>←</Kbd>
        <Kbd>→</Kbd>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        <Bi {...messagePair("measure.keys")} />
      </p>
    </div>
  );
}

export function RenameDialog({
  input,
  onClose,
  onRename,
}: {
  input: MeasurementInput | null;
  onClose: () => void;
  onRename: (id: number, name: string) => void;
}) {
  const label = useLabel("input_kinds", input?.kind);
  return (
    <Dialog
      open={input !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={messagePair("measure.renameTitle")}
      size="sm"
    >
      {input !== null ? (
        <NamePrompt
          key={input.id}
          kindLabel={label ?? { ar: input.kind, en: input.kind }}
          defaultName={input.name}
          mode="rename"
          onSubmit={(name) => onRename(input.id, name)}
          onCancel={onClose}
        />
      ) : null}
    </Dialog>
  );
}

export function NoteDialog({
  input,
  onClose,
  onSave,
}: {
  input: MeasurementInput | null;
  onClose: () => void;
  onSave: (id: number, note: string) => void;
}) {
  const formId = `note${useId()}`;
  return (
    <Dialog
      open={input !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={messagePair("measure.noteTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            <Bi {...messagePair("common.cancel")} />
          </Button>
          <Button variant="primary" type="submit" form={formId}>
            <Bi {...messagePair("common.save")} />
          </Button>
        </>
      }
    >
      {input !== null ? (
        <NoteForm key={input.id} id={formId} input={input} onSave={onSave} />
      ) : null}
    </Dialog>
  );
}

function NoteForm({
  id,
  input,
  onSave,
}: {
  id: string;
  input: MeasurementInput;
  onSave: (id: number, note: string) => void;
}) {
  const [note, setNote] = useState(input.note);
  return (
    <form
      id={id}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(input.id, note.trim());
      }}
    >
      <Field label={messagePair("measure.note")}>
        <Textarea
          value={note}
          maxLength={MAX_NOTE}
          rows={5}
          autoFocus
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </form>
  );
}

export function ColourDialog({
  input,
  shown,
  onClose,
  onPick,
}: {
  input: MeasurementInput | null;
  /** the colour the row is drawn in now */
  shown: string | null;
  onClose: () => void;
  onPick: (id: number, color: string | null) => void;
}) {
  const t = useT();
  const current = (input?.color ?? null)?.toLowerCase() ?? null;
  return (
    <Dialog
      open={input !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={messagePair("measure.recolorTitle")}
      description={messagePair("measure.recolorHint")}
      size="sm"
    >
      {input !== null ? (
        <div className="flex flex-col gap-3">
          <div
            role="radiogroup"
            aria-label={t("measure.recolorTitle")}
            className="flex flex-wrap gap-2"
          >
            {MEASURE_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={current === color}
                aria-label={color}
                onClick={() => onPick(input.id, color.toUpperCase())}
                className={cn(
                  "size-9 rounded-full border-2",
                  current === color ? "border-ink ring-2 ring-primary" : "border-white/60",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <Button
            variant="ghost"
            className="self-start"
            aria-pressed={current === null}
            onClick={() => onPick(input.id, null)}
          >
            {shown ? (
              <span
                aria-hidden="true"
                className="size-3 rounded-full"
                style={{ backgroundColor: shown }}
              />
            ) : null}
            <Bi {...messagePair("measure.automaticColour")} />
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
