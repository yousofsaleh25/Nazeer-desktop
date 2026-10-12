/**
 * About's licence card (D11): the active key's type, customer, expiry and reference, and
 * "Change key" (e.g. a trial upgraded to a permanent key; the stored key is replaced only by a
 * key that verifies in main).
 */
import { KeyRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { NazeerApi } from "@shared/ipc";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Ltr } from "@/components/ui/Ltr";
import { messagePair, type MessageKey } from "@/i18n/t";
import { formatDateTime } from "@/lib/format";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { licenseStatusReceived } from "@/store/slices/license";
import { ActivateForm } from "./ActivateForm";

export function LicenseCard() {
  const status = useAppSelector((state) => state.license.status);
  const dispatch = useAppDispatch();
  const [changing, setChanging] = useState(false);
  const api = (window as { nazeer?: NazeerApi }).nazeer;
  if (status === null) return null;
  const license = status.license;

  const rows: [MessageKey, ReactNode][] =
    license === null
      ? []
      : [
          ["license.kind", <Bi key="k" {...messagePair(`license.kinds.${license.kind}`)} />],
          ["license.customer", <bdi key="c">{license.customer ?? "--"}</bdi>],
          [
            "license.validUntil",
            license.expires === null ? (
              <Bi key="e" {...messagePair("license.noExpiry")} />
            ) : (
              <Ltr key="e">{formatDateTime(license.expires)}</Ltr>
            ),
          ],
          [
            "license.fingerprint",
            <Ltr key="f" className="font-mono text-xs">
              {license.fingerprint}
            </Ltr>,
          ],
        ];

  return (
    <Card
      title={messagePair("license.card")}
      level={2}
      actions={
        status.required && api ? (
          <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
            <KeyRound aria-hidden="true" />
            <Bi {...messagePair("license.changeKey")} />
          </Button>
        ) : undefined
      }
    >
      {status.required ? (
        <dl className="grid grid-cols-[minmax(9rem,max-content)_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-secondary">
                <Bi {...messagePair(label)} />
              </dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-ink-secondary">
          <Bi {...messagePair("license.notRequired")} />
        </p>
      )}
      {status.notSaved ? (
        <p className="text-sm text-warning-text">
          <Bi {...messagePair("license.notSaved")} />
        </p>
      ) : null}
      {api ? (
        <Dialog
          open={changing}
          onOpenChange={setChanging}
          title={messagePair("license.changeKey")}
          size="lg"
        >
          <ActivateForm
            activate={(key) => api.license.activate(key)}
            onAccepted={(next) => {
              dispatch(licenseStatusReceived(next));
              setChanging(false);
            }}
          />
        </Dialog>
      ) : null}
    </Card>
  );
}
