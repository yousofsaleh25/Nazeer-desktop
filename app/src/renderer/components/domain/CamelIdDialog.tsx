/**
 * Start a measuring session on the picked frame: camel id, operator and notes. The camel id may be
 * left empty now (the engine requires it only at finalize: 422 camel_id_required), so the dialog
 * says so instead of blocking. Ids and names are free text in either script (dir="auto").
 */
import { useId, useState, type FormEvent } from "react";
import type { ApiErrorShape } from "@/api/errors";
import type { CandidateItem } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Num } from "@/components/ui/Ltr";
import { useLanguage } from "@/design/language";
import { messagePair, translate } from "@/i18n/t";
import { ErrorPanel } from "./ErrorPanel";

export interface SessionStartValues {
  camel_id: string;
  operator: string;
  notes: string;
}

export interface CamelIdDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate: CandidateItem | null;
  initial?: Partial<SessionStartValues>;
  busy?: boolean;
  error?: ApiErrorShape | null;
  onSubmit: (values: SessionStartValues) => void;
}

export function CamelIdDialog({
  open,
  onOpenChange,
  candidate,
  initial,
  busy = false,
  error = null,
  onSubmit,
}: CamelIdDialogProps) {
  const { lang } = useLanguage();
  const formId = `camel-id${useId()}`;
  const [values, setValues] = useState<SessionStartValues>({
    camel_id: initial?.camel_id ?? "",
    operator: initial?.operator ?? "",
    notes: initial?.notes ?? "",
  });
  const set = (key: keyof SessionStartValues) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({
      camel_id: values.camel_id.trim(),
      operator: values.operator.trim(),
      notes: values.notes.trim(),
    });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={messagePair("session.startTitle")}
      description={messagePair("session.startDescription")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            <Bi {...messagePair("common.cancel")} />
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy}>
            <Bi {...messagePair("session.start")} />
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        {candidate ? (
          <p className="text-sm text-ink-secondary">
            <Bi {...messagePair("session.fromFrame")} />{" "}
            <Num value={candidate.bag_time_s} digits={1} unit={translate(lang, "units.s")} />
          </p>
        ) : null}
        <Field label={messagePair("session.camelId")} hint={messagePair("session.camelIdHint")}>
          <Input
            value={values.camel_id}
            onChange={(event) => set("camel_id")(event.target.value)}
            maxLength={64}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label={messagePair("session.operator")}>
          <Input
            value={values.operator}
            onChange={(event) => set("operator")(event.target.value)}
            maxLength={100}
            autoComplete="off"
          />
        </Field>
        <Field label={messagePair("session.notes")}>
          <Textarea
            value={values.notes}
            onChange={(event) => set("notes")(event.target.value)}
            maxLength={4000}
          />
        </Field>
        {error ? <ErrorPanel error={error} /> : null}
      </form>
    </Dialog>
  );
}
