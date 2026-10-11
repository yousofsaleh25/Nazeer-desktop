/**
 * Form fields. `Field` renders the label, a hint and an error and hands their ids to the control
 * inside it (Input, Textarea, Select read them from context), so every control is labelled and
 * described without wiring ids by hand. Operator text (names, notes, camel ids) is `dir="auto"`:
 * an Arabic name runs right to left and an English one left to right in either UI language.
 */
import { createContext, useContext, useId, type ReactNode, type Ref } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Bi, type BiText } from "./Bi";
import { cn } from "@/lib/cn";

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** The ids of the enclosing Field (null outside one). */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: BiText;
  hint?: BiText;
  /** shown in danger and marks the control aria-invalid */
  error?: BiText | null;
  required?: boolean;
  /** a fixed id for the control (otherwise generated) */
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  id,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? `field${generated}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <FieldContext value={{ id: controlId, describedBy, invalid: Boolean(error), required }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={controlId} className="text-sm font-medium text-ink">
          <Bi {...label} />
          {required ? (
            <span aria-hidden="true" className="ms-1 text-danger-text">
              *
            </span>
          ) : null}
        </label>
        {children}
        {hint ? (
          <p id={hintId} className="text-xs text-ink-muted">
            <Bi {...hint} />
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="text-xs font-medium text-danger-text">
            <Bi {...error} />
          </p>
        ) : null}
      </div>
    </FieldContext>
  );
}

const control = cn(
  "w-full rounded-sm border border-border-control bg-surface-raised px-2.5 text-sm text-ink",
  "placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-60",
  "aria-invalid:border-danger aria-invalid:ring-1 aria-invalid:ring-danger",
);

function fieldProps(field: FieldContextValue | null, id: string | undefined) {
  return {
    id: id ?? field?.id,
    "aria-describedby": field?.describedBy,
    "aria-invalid": field?.invalid || undefined,
    required: field?.required || undefined,
  };
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

/** A text input; operator text is `dir="auto"` unless told otherwise (paths and numbers: ltr). */
export function Input({ className, id, dir = "auto", ...props }: InputProps) {
  const field = useField();
  return (
    <input
      dir={dir}
      className={cn(control, "min-h-8 py-1", className)}
      {...fieldProps(field, id)}
      {...props}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ className, id, dir = "auto", rows = 3, ...props }: TextareaProps) {
  const field = useField();
  return (
    <textarea
      dir={dir}
      rows={rows}
      className={cn(control, "min-h-16 py-1.5 leading-relaxed", className)}
      {...fieldProps(field, id)}
      {...props}
    />
  );
}
