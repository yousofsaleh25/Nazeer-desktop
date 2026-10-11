/**
 * Name the measurement just drawn: it enters the session only once named. The name is the
 * operator's text (Arabic or English, `dir="auto"`) and is printed in the report exactly as typed,
 * so it is trimmed but never otherwise changed. Enter saves, Esc cancels.
 */
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { Bi, type BiText } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { messagePair } from "@/i18n/t";

export interface NamePromptProps {
  /** the kind being named (engine label) */
  kindLabel: BiText;
  defaultName?: string;
  /** "Save" for a new measurement, "Rename" for an existing one */
  mode?: "new" | "rename";
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function NamePrompt({
  kindLabel,
  defaultName = "",
  mode = "new",
  onSubmit,
  onCancel,
}: NamePromptProps) {
  const [name, setName] = useState(defaultName);
  const id = `name${useId()}`;
  const trimmed = name.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed) onSubmit(trimmed);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} className="flex w-72 max-w-full flex-col gap-3">
      <p className="text-xs text-ink-secondary">
        <Bi {...kindLabel} />
      </p>
      <Field id={id} label={messagePair("measure.name")} required>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          autoComplete="off"
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <Bi {...messagePair("common.cancel")} />
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!trimmed}>
          <Bi {...messagePair(mode === "new" ? "common.save" : "measure.rename")} />
        </Button>
      </div>
    </form>
  );
}
