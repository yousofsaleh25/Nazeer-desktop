/**
 * The Activate screen (D11): shown before the main UI while a licence is required and not active
 * — on first run, or when the stored trial has ended. Everything on it is in both languages.
 */
import type { LicenseStatus, NazeerApi } from "@shared/ipc";
import { ActivateForm } from "@/components/domain/ActivateForm";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Card } from "@/components/ui/Card";
import { Ltr } from "@/components/ui/Ltr";
import { LanguageProvider, useLanguage } from "@/design/language";
import { messagePair } from "@/i18n/t";
import { formatDateTime } from "@/lib/format";

export interface ActivateProps {
  status: LicenseStatus;
  onAccepted: (status: LicenseStatus) => void;
}

function bridge(): NazeerApi | undefined {
  return (window as { nazeer?: NazeerApi }).nazeer;
}

export function Activate({ status, onAccepted }: ActivateProps) {
  const api = bridge();
  const { lang } = useLanguage();
  // every label on this screen in both languages (field label and hint included): it appears
  // before the app's language controls, and its reader may read either
  return (
    <LanguageProvider lang={lang} bilingual>
      <ActivateScreen status={status} onAccepted={onAccepted} api={api} />
    </LanguageProvider>
  );
}

function ActivateScreen({
  status,
  onAccepted,
  api,
}: ActivateProps & { api: NazeerApi | undefined }) {
  return (
    <main className="flex min-h-screen items-start justify-center bg-canvas px-4 py-16 text-ink">
      <Card className="w-full max-w-xl" padded>
        <h1 className="text-2xl font-semibold">
          <Bi {...messagePair("license.title")} mode="both" block />
        </h1>
        <p className="text-sm text-ink-secondary">
          <Bi {...messagePair("license.intro")} mode="both" block />
        </p>
        {status.configError !== null ? (
          <Alert tone="danger">
            <Bi {...messagePair("license.notConfigured")} mode="both" block />
          </Alert>
        ) : null}
        {status.reason === "expired" ? (
          <Alert tone="warning">
            <Bi {...messagePair("license.storedExpired")} mode="both" block />
            {status.license?.expires ? (
              <p className="text-ink-secondary">
                <Bi {...messagePair("license.expiredOn")} mode="both" />:{" "}
                <Ltr>{formatDateTime(status.license.expires)}</Ltr>
              </p>
            ) : null}
          </Alert>
        ) : status.reason !== null ? (
          <Alert tone="warning">
            <Bi {...messagePair("license.storedInvalid")} mode="both" block />
          </Alert>
        ) : null}
        {api ? (
          <ActivateForm activate={(key) => api.license.activate(key)} onAccepted={onAccepted} />
        ) : null}
      </Card>
    </main>
  );
}
