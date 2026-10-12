/**
 * Paste a licence key and send it to main for verification (D11). The reason a key fails is
 * shown in Arabic and English together, whatever the UI language: the screen appears before the
 * app's language controls, and the person reading it may be either. Main verifies; this only
 * shows the answer.
 */
import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ActivationResult, LicenseStatus } from "@shared/ipc";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Field";
import { Ltr } from "@/components/ui/Ltr";
import { messagePair } from "@/i18n/t";
import { formatDateTime } from "@/lib/format";

export interface ActivateFormProps {
  /** main's licence.activate (window.nazeer.license.activate) */
  activate: (key: string) => Promise<ActivationResult>;
  /** called with the new status once a key was accepted */
  onAccepted: (status: LicenseStatus) => void;
}

export function ActivateForm({ activate, onAccepted }: ActivateFormProps) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActivationResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || key.trim() === "") return;
    setBusy(true);
    setFailure(null);
    activate(key).then(
      (answer) => {
        setBusy(false);
        setResult(answer);
        if (answer.accepted) onAccepted(answer.status);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(error instanceof Error ? error.message : String(error));
      },
    );
  };

  const refused = result !== null && !result.accepted ? result : null;
  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <Field label={messagePair("license.keyLabel")} hint={messagePair("license.keyHint")}>
        <Textarea
          dir="ltr"
          rows={4}
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-xs break-all"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </Field>
      {refused?.reason ? (
        <Alert tone="danger">
          <Bi {...messagePair(`license.reasons.${refused.reason}`)} mode="both" block />
          {refused.reason === "expired" && refused.license?.expires ? (
            <p className="text-ink-secondary">
              <Bi {...messagePair("license.expiredOn")} mode="both" />:{" "}
              <Ltr>{formatDateTime(refused.license.expires)}</Ltr>
            </p>
          ) : null}
        </Alert>
      ) : null}
      {refused !== null && refused.reason === null ? (
        <Alert tone="danger">
          <Bi {...messagePair("license.notConfigured")} mode="both" block />
        </Alert>
      ) : null}
      {failure !== null ? (
        <Alert tone="danger">
          <Ltr>{failure}</Ltr>
        </Alert>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy} disabled={key.trim() === ""}>
          <KeyRound aria-hidden="true" />
          <Bi {...messagePair("license.activate")} mode="both" />
        </Button>
      </div>
    </form>
  );
}
