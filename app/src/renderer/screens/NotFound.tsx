/** A route the app does not have (a stale link, a typed hash): the way back to the start. */
import { MapPinOff } from "lucide-react";
import { Link } from "react-router";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { messagePair } from "@/i18n/t";

export function NotFound() {
  return (
    <div className="flex flex-1 items-start justify-center p-8">
      <EmptyState
        icon={MapPinOff}
        title={messagePair("notFound.title")}
        description={messagePair("notFound.description")}
        className="w-full max-w-lg"
        action={
          <Button variant="primary" asChild>
            <Link to="/">
              <Bi {...messagePair("nav.home")} />
            </Link>
          </Button>
        }
      />
    </div>
  );
}
