/**
 * The frame of the /design pages (development builds only): title, links between the gallery
 * pages, the UI preferences, and the engine's real /meta/labels for every component inside.
 */
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { LabelsProvider } from "@/components/domain/labels";
import { PrefControls } from "@/components/domain/PrefControls";
import { Bi } from "@/components/ui/Bi";
import { messagePair, useT, type MessageKey } from "@/i18n/t";
import { cn } from "@/lib/cn";
import { fixtures } from "./fixtures";

const PAGES: readonly { to: string; label: MessageKey }[] = [
  { to: "/design", label: "design.pages.tokens" },
  { to: "/design/components", label: "design.pages.components" },
  { to: "/design/domain", label: "design.pages.domain" },
];

export function GallerySection({ title, children }: { title: MessageKey; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="border-b border-border pb-1 text-xl font-semibold">
        <Bi {...messagePair(title)} />
      </h2>
      {children}
    </section>
  );
}

export function GalleryShell({
  title,
  intro,
  children,
}: {
  title: MessageKey;
  intro: MessageKey;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <LabelsProvider labels={fixtures.labels}>
      <div className="min-h-screen bg-canvas text-ink">
        <header className="sticky top-0 z-(--nz-z-sticky) flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-surface px-6 py-3 shadow-sm">
          <h1 className="text-2xl font-semibold">
            <Bi {...messagePair(title)} />
          </h1>
          <nav aria-label={t("design.galleryNav")}>
            <ul className="flex flex-wrap gap-1">
              {PAGES.map((page) => (
                <li key={page.to}>
                  <NavLink
                    to={page.to}
                    end
                    className={({ isActive }) =>
                      cn(
                        "inline-flex min-h-8 items-center rounded-md px-3 text-sm font-medium",
                        isActive
                          ? "bg-primary-soft text-primary-text"
                          : "text-ink-secondary hover:bg-surface-hover",
                      )
                    }
                  >
                    <Bi {...messagePair(page.label)} />
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <PrefControls className="ms-auto" />
        </header>
        <main className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-8">
          <p className="text-ink-secondary">
            <Bi {...messagePair(intro)} />
          </p>
          {children}
        </main>
      </div>
    </LabelsProvider>
  );
}
