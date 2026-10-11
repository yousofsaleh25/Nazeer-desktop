/**
 * Transient notices ("Saved", "Backup written"). Presentational: the list lives in the store
 * (Stage 5) and comes in as props. Errors that need action are never only a toast: they get an
 * ErrorPanel or a persistent badge. Swipes toward the inline end dismiss.
 */
import * as ToastPrimitive from "@radix-ui/react-toast";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Bi, type BiText } from "./Bi";
import { useLanguage } from "@/design/language";
import { useT } from "@/i18n/t";
import { cn } from "@/lib/cn";

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: BiText;
  description?: BiText;
  /** ms; danger toasts stay until dismissed */
  duration?: number;
}

const ICONS: Record<ToastTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

const TONE: Record<ToastTone, string> = {
  info: "border-info-border [&_.toast-icon]:text-info-text",
  success: "border-success-border [&_.toast-icon]:text-success-text",
  warning: "border-warning-border [&_.toast-icon]:text-warning-text",
  danger: "border-danger-border [&_.toast-icon]:text-danger-text",
};

export interface ToasterProps {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
}

export function Toaster({ toasts, onDismiss }: ToasterProps) {
  const { lang } = useLanguage();
  const t = useT();
  return (
    <ToastPrimitive.Provider
      swipeDirection={lang === "ar" ? "left" : "right"}
      label={t("common.notifications")}
    >
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone];
        return (
          <ToastPrimitive.Root
            key={toast.id}
            type={toast.tone === "danger" ? "foreground" : "background"}
            duration={toast.tone === "danger" ? Number.POSITIVE_INFINITY : (toast.duration ?? 5000)}
            onOpenChange={(open) => {
              if (!open) onDismiss(toast.id);
            }}
            className={cn(
              "flex items-start gap-3 rounded-lg border bg-surface-raised p-3 text-ink shadow-lg",
              TONE[toast.tone],
            )}
          >
            <Icon aria-hidden="true" className="toast-icon mt-0.5 size-4.5 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <ToastPrimitive.Title className="text-sm font-semibold">
                <Bi {...toast.title} />
              </ToastPrimitive.Title>
              {toast.description ? (
                <ToastPrimitive.Description className="text-sm text-ink-secondary">
                  <Bi {...toast.description} />
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label={t("common.close")}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-hover"
            >
              <X aria-hidden="true" className="size-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="fixed end-0 bottom-0 z-(--nz-z-toast) flex w-[min(100vw,24rem)] flex-col gap-2 p-4 outline-none" />
    </ToastPrimitive.Provider>
  );
}
