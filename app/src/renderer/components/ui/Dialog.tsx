/**
 * Modal dialogs (Radix: focus trap, Esc, focus returns to the trigger). `Dialog` is for forms and
 * details; `ConfirmDialog` (an alert dialog) for decisions that cannot be undone, such as deleting
 * a session — its confirm button is never the default focus.
 */
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Bi, type BiText } from "./Bi";
import { Button } from "./Button";
import { cn } from "@/lib/cn";
import { messagePair, useT } from "@/i18n/t";

const overlay = "fixed inset-0 z-(--nz-z-overlay) bg-backdrop";
// centred with `inset: 0; margin: auto` (no physical offsets), as tall as its content
const panel = cn(
  "fixed inset-0 z-(--nz-z-dialog) m-auto flex h-fit max-h-[min(90vh,48rem)] w-[min(92vw,var(--dialog-width))] flex-col",
  "overflow-hidden rounded-lg border border-border bg-surface-raised text-ink shadow-lg",
);

const WIDTHS = { sm: "28rem", md: "36rem", lg: "52rem" } as const;

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: BiText;
  description?: BiText;
  children?: ReactNode;
  /** buttons, laid out at the inline end */
  footer?: ReactNode;
  size?: keyof typeof WIDTHS;
  className?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: DialogProps) {
  const t = useT();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlay} />
        <DialogPrimitive.Content
          className={cn(panel, className)}
          style={{ ["--dialog-width" as string]: WIDTHS[size] }}
          // without a description Radix wants aria-describedby explicitly unset
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <DialogPrimitive.Title className="text-lg font-semibold">
                <Bi {...title} />
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-sm text-ink-secondary">
                  <Bi {...description} />
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("common.close")}>
                <X aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {children !== undefined ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          ) : null}
          {footer !== undefined ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogClose = DialogPrimitive.Close;

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: BiText;
  description: BiText;
  confirmLabel: BiText;
  cancelLabel?: BiText;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = messagePair("common.cancel"),
  tone = "primary",
  busy = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={overlay} />
        <AlertDialogPrimitive.Content
          className={panel}
          style={{ ["--dialog-width" as string]: WIDTHS.sm }}
        >
          <div className="flex flex-col gap-2 px-5 py-4">
            <AlertDialogPrimitive.Title className="text-lg font-semibold">
              <Bi {...title} />
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="text-sm text-ink-secondary">
              <Bi {...description} />
            </AlertDialogPrimitive.Description>
            {children}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="secondary">
                <Bi {...cancelLabel} />
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              loading={busy}
              onClick={onConfirm}
            >
              <Bi {...confirmLabel} />
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
