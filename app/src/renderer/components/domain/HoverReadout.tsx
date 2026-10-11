/**
 * What the engine says about the pixel under the cursor (`POST …/depth`): the depth and its basis
 * as the engine words it, the source (direct window median or a KNN snap), the target, the window
 * and neighbour statistics, and the flags — or the rejection reason. With a 2D tool the depth is
 * metadata only (2D values use Z_ref, never per-pixel depth), and the readout says so.
 */
import { Crosshair } from "lucide-react";
import type { ReactNode } from "react";
import type { DepthOut } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Chip } from "@/components/ui/Chip";
import { Ltr, Num } from "@/components/ui/Ltr";
import { Spinner } from "@/components/ui/Spinner";
import { FLAG_TONE } from "@/design";
import { useLanguage } from "@/design/language";
import { messagePair, translate, type MessageKey } from "@/i18n/t";
import { cn } from "@/lib/cn";
import { CodeLabel, useLabels } from "./labels";

function Line({ label, children }: { label: MessageKey; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-secondary">
        <Bi {...messagePair(label)} />
      </dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

export interface HoverReadoutProps {
  depth: DepthOut | null;
  /** the active tool is a 2D kind: per-pixel depth is metadata only */
  tool2d?: boolean;
  /** a newer request is in flight */
  pending?: boolean;
  className?: string;
}

export function HoverReadout({
  depth,
  tool2d = false,
  pending = false,
  className,
}: HoverReadoutProps) {
  const { lang } = useLanguage();
  const labels = useLabels();
  const m = translate(lang, "units.m");
  const px = translate(lang, "units.px");
  return (
    <section
      aria-live="polite"
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm",
        className,
      )}
    >
      <header className="flex items-center gap-2">
        <Crosshair aria-hidden="true" className="size-4 text-ink-muted" />
        <h3 className="font-semibold">
          <Bi {...messagePair("readout.title")} />
        </h3>
        {pending ? <Spinner size="sm" className="ms-auto text-ink-muted" /> : null}
      </header>
      {depth === null ? (
        <p className="text-ink-muted">
          <Bi {...messagePair("readout.idle")} />
        </p>
      ) : (
        <>
          {depth.ok ? (
            <p className="text-base font-semibold">
              <Bi {...depth.basis} />
            </p>
          ) : (
            <p className="font-semibold text-danger-text">
              <CodeLabel group="rejections" code={depth.reason} />
            </p>
          )}
          <dl className="flex flex-col gap-0.5 text-xs">
            {depth.source ? (
              <Line label="readout.source">
                <CodeLabel group="sources" code={depth.source} />
              </Line>
            ) : null}
            <Line label="readout.target">
              <CodeLabel group="targets" code={depth.target} />
            </Line>
            <Line label="readout.insideMask">
              <Bi {...messagePair(depth.inside_mask ? "common.yes" : "common.no")} />
            </Line>
            <Line label="readout.window">
              <Ltr className="whitespace-nowrap">{`${depth.window_n_valid} / ${depth.window_n_total}`}</Ltr>
            </Line>
            {depth.k_used > 0 ? (
              <Line label="readout.neighbours">
                <Ltr className="whitespace-nowrap">{`k = ${depth.k_used}`}</Ltr>
                {depth.nn_dist_px_max !== null ? (
                  <>
                    {" · "}
                    <Num value={depth.nn_dist_px_max} digits={1} unit={px} />
                  </>
                ) : null}
                {depth.nn_dist_m_max !== null ? (
                  <>
                    {" · "}
                    <Num value={depth.nn_dist_m_max} digits={3} unit={m} />
                  </>
                ) : null}
              </Line>
            ) : null}
            {depth.direct_depth_m !== null && depth.direct_depth_m !== depth.depth_m ? (
              <Line label="readout.direct">
                <Num value={depth.direct_depth_m} digits={3} unit={m} />
              </Line>
            ) : null}
          </dl>
          {depth.flags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {depth.flags.map((flag) => (
                <Chip
                  key={flag}
                  tone={labels?.flags[flag]?.severity === "warn" ? FLAG_TONE.warn : FLAG_TONE.info}
                >
                  <CodeLabel group="flags" code={flag} />
                </Chip>
              ))}
            </div>
          ) : null}
          {tool2d ? (
            <p className="text-xs text-ink-muted">
              <Bi {...messagePair("readout.metadata2d")} />
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
