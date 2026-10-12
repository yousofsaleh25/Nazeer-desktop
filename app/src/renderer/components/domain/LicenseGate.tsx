/**
 * Before the main UI: ask main for the licence status once; while a licence is required and not
 * active, show the Activate screen instead of the app (D11). Main is the authority: it does not
 * start the engine before a key is active, so this screen is not the only lock.
 */
import { useEffect, type ReactNode } from "react";
import type { NazeerApi } from "@shared/ipc";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/i18n/t";
import { Activate } from "@/screens/Activate";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { LICENSE_NOT_REQUIRED, licenseStatusReceived } from "@/store/slices/license";

export function LicenseGate({ children }: { children: ReactNode }) {
  const status = useAppSelector((state) => state.license.status);
  const dispatch = useAppDispatch();
  const t = useT();

  useEffect(() => {
    const api = (window as { nazeer?: NazeerApi }).nazeer;
    if (api === undefined) {
      dispatch(licenseStatusReceived(LICENSE_NOT_REQUIRED));
      return;
    }
    let live = true;
    void api.license.getStatus().then((answer) => {
      if (live) dispatch(licenseStatusReceived(answer));
    });
    return () => {
      live = false;
    };
  }, [dispatch]);

  if (status === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Spinner size="lg" label={t("license.checking")} className="text-primary-text" />
      </div>
    );
  }
  if (status.required && status.state !== "active") {
    return (
      <Activate status={status} onAccepted={(next) => dispatch(licenseStatusReceived(next))} />
    );
  }
  return <>{children}</>;
}
