/**
 * A screen that failed while rendering (the router's error element): its bilingual label, the
 * error's own message and the copyable details, and the way back to the start — never React
 * Router's default page or a blank window (production has no reload). Inside OperatorLayout it
 * replaces only the screen, so the shell, its navigation and the save state stay.
 */
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { appError } from "@/api/errors";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { messagePair } from "@/i18n/t";

function describe(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function ScreenError() {
  const error = useRouteError();
  return (
    <div className="flex flex-1 items-start justify-center p-8">
      <div className="flex w-full max-w-2xl flex-col gap-3">
        <ErrorPanel error={appError("screen_failed", describe(error))} />
        <div>
          <Button variant="primary" asChild>
            <Link to="/">
              <Bi {...messagePair("nav.home")} />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
