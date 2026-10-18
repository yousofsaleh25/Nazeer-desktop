/**
 * Approve a camel's image for a comparison (D12 Q1): a member without a report sealed from its
 * current image is approved here, on the engine's full image — fetched, SHA-256'd with WebCrypto
 * and shown only when it matches the engine's stamp (the same check as the single report's
 * approval, OverlayApproval). The approval names the image's version and SHA-256; the bytes are
 * held only while the dialog is open (never in the open session's overlay cache).
 */
import { useState } from "react";
import { useVerifiedEngineBytes } from "@/api/assets";
import type { OverlayOutput } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Dialog } from "@/components/ui/Dialog";
import { Ltr } from "@/components/ui/Ltr";
import { messagePair } from "@/i18n/t";
import { useObjectUrl } from "@/lib/objectUrl";
import type { MemberApproval, OverlayRef } from "@/store/slices/comparisons";
import { OverlayApproval, type OverlayVerification } from "./OverlayApproval";

export interface MemberApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  camelId: string;
  overlay: OverlayRef;
  approved: MemberApproval | null;
  onApprove: (approval: MemberApproval) => void;
}

/** The file name the engine's asset URL ends with (shown beside the version). */
export function fileOfUrl(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? "";
  const last = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function MemberApprovalDialog({
  open,
  onOpenChange,
  sessionId,
  camelId,
  overlay,
  approved,
  onApprove,
}: MemberApprovalDialogProps) {
  const [retry, setRetry] = useState(0);
  const fetched = useVerifiedEngineBytes(open ? overlay.url : null, overlay.sha256, retry);
  const imageUrl = useObjectUrl(fetched.state === "match" ? fetched.bytes : null, "image/png");
  const verification: OverlayVerification =
    fetched.state === "match" && imageUrl !== null
      ? { state: "match", computed: fetched.computed, imageUrl }
      : fetched.state === "mismatch"
        ? { state: "mismatch", computed: fetched.computed }
        : fetched.state === "error"
          ? { state: "error", error: fetched.error }
          : { state: "verifying" };
  const output: OverlayOutput = {
    version: overlay.version,
    sha256: overlay.sha256,
    url: overlay.url,
    file: fileOfUrl(overlay.url),
    width: null,
    height: null,
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={messagePair("compare.approveTitle")}
    >
      <div className="flex flex-col gap-3" data-testid="member-approval" data-session={sessionId}>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          {camelId ? (
            <bdi dir="auto" className="font-semibold">
              {camelId}
            </bdi>
          ) : (
            <span className="text-ink-muted">
              <Bi {...messagePair("history.noCamelId")} />
            </span>
          )}
          <Ltr className="font-mono text-xs text-ink-muted">{sessionId}</Ltr>
        </p>
        <OverlayApproval
          overlay={output}
          verification={verification}
          approved={approved}
          onApprove={() => {
            if (verification.state !== "match") return;
            onApprove({ version: overlay.version, sha256: verification.computed });
          }}
          onRetry={() => setRetry((n) => n + 1)}
        />
      </div>
    </Dialog>
  );
}
