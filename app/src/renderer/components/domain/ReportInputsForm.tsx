/**
 * The report's explicit inputs (D7: never taken from storage): the PDF language, the scoring-form
 * variant, the judge / council / event names and the judge's observations. Field labels,
 * placeholders, colour options and variant names come from the report model (engine). Names are
 * printed exactly as typed and must be found in the PDF text layer, so they are trimmed only.
 */
import type { ReportFormContent } from "@/api/reportModel";
import type { ReportInputs, ReportLanguage, RubricVariant } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { useId } from "react";
import { messagePair } from "@/i18n/t";
import { cn } from "@/lib/cn";

const LANGUAGES: readonly ReportLanguage[] = ["ar", "en", "both"];
const LANGUAGE_KEYS = {
  ar: "report.languageAr",
  en: "report.languageEn",
  both: "report.languageBoth",
} as const;
const NAMES = ["judge", "council", "event"] as const;
const NAME_KEYS = {
  judge: "report.judge",
  council: "report.council",
  event: "report.event",
} as const;

/** The PDF language (ar | en | both), an explicit input (D7); also the comparison's (D12). */
export function ReportLanguagePicker({
  value,
  onChange,
}: {
  value: ReportLanguage;
  onChange: (language: ReportLanguage) => void;
}) {
  const languageId = `report-language${useId()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <span id={languageId} className="text-sm font-medium">
        <Bi {...messagePair("report.language")} />
      </span>
      <div
        role="radiogroup"
        aria-labelledby={languageId}
        className="flex w-fit overflow-hidden rounded-md border border-border-control"
      >
        {LANGUAGES.map((language) => (
          <button
            key={language}
            type="button"
            role="radio"
            aria-checked={value === language}
            onClick={() => onChange(language)}
            className={cn(
              "min-h-8 px-3 text-sm",
              value === language
                ? "bg-primary text-primary-fg"
                : "bg-surface hover:bg-surface-hover",
            )}
          >
            <Bi {...messagePair(LANGUAGE_KEYS[language])} />
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ReportInputsFormProps {
  value: ReportInputs;
  content: ReportFormContent;
  onChange: (value: ReportInputs) => void;
  disabled?: boolean;
}

export function ReportInputsForm({
  value,
  content,
  onChange,
  disabled = false,
}: ReportInputsFormProps) {
  const setName = (key: string, text: string) =>
    onChange({ ...value, names: { ...value.names, [key]: text } });
  const setObservation = (key: string, text: string) =>
    onChange({ ...value, observations: { ...value.observations, [key]: text } });

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-5">
      <ReportLanguagePicker
        value={value.language}
        onChange={(language) => onChange({ ...value, language })}
      />

      <Field label={messagePair("report.variant")}>
        <Select<RubricVariant>
          value={value.rubric_variant}
          onValueChange={(rubric_variant) => onChange({ ...value, rubric_variant })}
          options={Object.entries(content.variants).map(([code, label]) => ({
            value: code as RubricVariant,
            label,
          }))}
          disabled={disabled}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        {NAMES.map((key) => (
          <Field key={key} label={messagePair(NAME_KEYS[key])}>
            <Input
              value={value.names[key] ?? ""}
              onChange={(event) => setName(key, event.target.value)}
            />
          </Field>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {content.observationFields.map((field) => {
          const current = value.observations[field.key] ?? "";
          const label = { ar: field.ar, en: field.en };
          if (field.kind === "select") {
            const known = content.colourOptions.some((option) => option.ar === current);
            return (
              <Field key={field.key} label={label}>
                <Select
                  value={current || undefined}
                  onValueChange={(next) => setObservation(field.key, next)}
                  placeholder={messagePair("report.choose")}
                  options={[
                    ...content.colourOptions.map((option) => ({ value: option.ar, label: option })),
                    ...(current && !known
                      ? [{ value: current, label: { ar: current, en: current } }]
                      : []),
                  ]}
                  disabled={disabled}
                />
              </Field>
            );
          }
          const wide = field.kind === "textarea";
          return (
            <Field key={field.key} label={label} className={wide ? "sm:col-span-2" : undefined}>
              {wide ? (
                <Textarea
                  value={current}
                  placeholder={field.placeholder}
                  onChange={(event) => setObservation(field.key, event.target.value)}
                />
              ) : (
                <Input
                  value={current}
                  placeholder={field.placeholder}
                  onChange={(event) => setObservation(field.key, event.target.value)}
                />
              )}
            </Field>
          );
        })}
      </div>
      <p className="text-xs text-ink-muted">
        <Bi {...messagePair("report.inputsHint")} />
      </p>
    </fieldset>
  );
}
