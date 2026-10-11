/**
 * Approve the engine's overlay PNG (D7): the image shown here is the engine's rendering — the very
 * bytes the PDF will carry — and only after their SHA-256 (WebCrypto, computed by the caller)
 * equals the engine's stamp. A mismatch is a hard error: no image, no approval. The editing canvas
 * is never an approval surface.
 */
import { CircleCheck, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ApiErrorShape } from "@/api/errors";
import type { OverlayOutput } from "@/api/types";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Ltr } from "@/components/ui/Ltr";
import { Spinner } from "@/components/ui/Spinner";
import { messagePair, useT } from "@/i18n/t";
import { ErrorPanel } from "./ErrorPanel";

export type OverlayVerification =
  | { state: "verifying" }
  | { state: "match"; computed: string; imageUrl: string }
  | { state: "mismatch"; computed: string }
  | { state: "error"; error: ApiErrorShape };

export interface OverlayApprovalProps {
  overlay: OverlayOutput;
  verification: OverlayVerification;
  /** the approval the operator gave (in the report slice); null = not approved yet */
  approved: { version: number; sha256: string } | null;
  onApprove: () => void;
  onRetry: () => void;
}

function Sha({ value }: { value: string }) {
  return (
    <Ltr className="font-mono text-xs break-all">
      <span title={value}>{value}</span>
    </Ltr>
  );
}

export function OverlayApproval({
  overlay,
  verification,
  approved,
  onApprove,
  onRetry,
}: OverlayApprovalProps) {
  const t = useT();
  const isApproved =
    approved !== null && approved.version === overlay.version && approved.sha256 === overlay.sha256;
  const ratio =
    overlay.width && overlay.height ? `${overlay.width} / ${overlay.height}` : undefined;
  return (
    <div className="flex flex-col gap-3">
      <Alert tone="info" title={messagePair("approval.title")}>
        <Bi {...messagePair("approval.explain")} />
      </Alert>

      {verification.state === "verifying" ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm text-ink-secondary">
            <Spinner size="sm" />
            <Bi {...messagePair("approval.verifying")} />
          </p>
          <div
            aria-hidden="true"
            className="w-full animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none"
            style={{ aspectRatio: ratio ?? "16 / 10" }}
          />
        </div>
      ) : null}

      {verification.state === "match" ? (
        <figure className="flex flex-col gap-2">
          <img
            src={verification.imageUrl}
            alt={t("approval.imageAlt")}
            width={overlay.width ?? undefined}
            height={overlay.height ?? undefined}
            className="h-auto w-full rounded-md border border-border bg-black"
          />
          <figcaption className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
            <Chip tone="success" icon={ShieldCheck}>
              <Bi {...messagePair("approval.verified")} />
            </Chip>
            <Ltr>{`v${overlay.version} · ${overlay.file}`}</Ltr>
            <Sha value={overlay.sha256} />
          </figcaption>
        </figure>
      ) : null}

      {verification.state === "mismatch" ? (
        <Alert
          tone="danger"
          icon={ShieldAlert}
          title={messagePair("approval.mismatch")}
          actions={
            <Button size="sm" onClick={onRetry}>
              <Bi {...messagePair("common.retry")} />
            </Button>
          }
        >
          <Bi {...messagePair("approval.mismatchExplain")} />
          <dl className="mt-1 grid gap-1 text-xs">
            <dt className="text-ink-secondary">
              <Bi {...messagePair("approval.expected")} />
            </dt>
            <dd>
              <Sha value={overlay.sha256} />
            </dd>
            <dt className="text-ink-secondary">
              <Bi {...messagePair("approval.computed")} />
            </dt>
            <dd>
              <Sha value={verification.computed} />
            </dd>
          </dl>
        </Alert>
      ) : null}

      {verification.state === "error" ? (
        <ErrorPanel error={verification.error} onRetry={onRetry} />
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {isApproved ? (
          <Chip tone="success" size="md" icon={CircleCheck}>
            <Bi {...messagePair("approval.approved")} /> <Ltr>{`v${overlay.version}`}</Ltr>
          </Chip>
        ) : null}
        <Button
          variant="primary"
          size="lg"
          disabled={verification.state !== "match" || isApproved}
          onClick={onApprove}
        >
          <ShieldCheck aria-hidden="true" />
          <Bi {...messagePair("approval.approve")} />
        </Button>
      </div>
    </div>
  );
}
