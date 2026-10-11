/**
 * The frame around every operator screen: the brand, the main sections (Open a bag, History,
 * About), the engine's status and the UI preferences; banners (e.g. a missing Arabic text stack)
 * sit under the header, above the screen.
 */
import { History, Info, FolderOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import type { EngineConnection, EngineStatusName } from "@shared/ipc";
import { Bi } from "@/components/ui/Bi";
import { messagePair, useT, type MessageKey } from "@/i18n/t";
import { cn } from "@/lib/cn";
import { EngineStatusPill } from "./EngineStatusPill";
import { PrefControls } from "./PrefControls";

const NAV: readonly { to: string; label: MessageKey; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "nav.home", icon: FolderOpen, end: true },
  { to: "/history", label: "nav.history", icon: History },
  { to: "/about", label: "nav.about", icon: Info },
];

export interface AppShellProps {
  engine: { status: EngineStatusName; connection: EngineConnection | null; restarts: number };
  banner?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AppShell({ engine, banner, children, className }: AppShellProps) {
  const t = useT();
  return (
    <div className={cn("flex min-h-screen flex-col bg-canvas text-ink", className)}>
      <header className="sticky top-0 z-(--nz-z-sticky) border-b border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2">
          <p className="text-xl font-bold text-primary-text">
            <Bi {...messagePair("app.name")} />
          </p>
          <nav aria-label={t("nav.label")}>
            <ul className="flex items-center gap-1">
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        "inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium",
                        isActive
                          ? "bg-primary-soft text-primary-text"
                          : "text-ink-secondary hover:bg-surface-hover hover:text-ink",
                      )
                    }
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    <Bi {...messagePair(label)} />
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ms-auto flex flex-wrap items-center gap-3">
            <EngineStatusPill
              status={engine.status}
              connection={engine.connection}
              restarts={engine.restarts}
            />
            <PrefControls />
          </div>
        </div>
      </header>
      {banner ? <div className="flex flex-col gap-2 px-5 pt-3">{banner}</div> : null}
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
