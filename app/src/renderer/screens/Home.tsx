/** Placeholder home until the operator screens land (Stage 6). */
import { Link } from "react-router";
import { Bi } from "@/components/ui/Bi";
import { messagePair } from "@/i18n/t";

export function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas text-ink">
      <h1 className="text-4xl font-semibold">
        <Bi {...messagePair("app.name")} />
      </h1>
      <p className="text-lg text-ink-secondary">
        <Bi {...messagePair("app.tagline")} />
      </p>
      {import.meta.env.DEV ? (
        <Link to="/design" className="mt-4 rounded-md px-3 py-1.5 text-primary-text underline">
          <Bi {...messagePair("nav.design")} />
        </Link>
      ) : null}
    </main>
  );
}
