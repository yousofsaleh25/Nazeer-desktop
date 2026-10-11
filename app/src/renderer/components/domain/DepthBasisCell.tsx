/**
 * Where each point's depth came from, as the engine words it ("direct 2.153 m", "snapped to camel
 * 9.0 cm", "Z_ref 2.329 m"). Consecutive points with the same basis are grouped ("P1–P5"), so a
 * 2D curve reads as one line instead of five.
 */
import type { DepthBasis } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Ltr } from "@/components/ui/Ltr";
import { cn } from "@/lib/cn";

export interface BasisGroup {
  /** first and last point number (1-based), null for a row-level basis (4-point angles) */
  from: number | null;
  to: number | null;
  ar: string;
  en: string;
}

/** Runs of consecutive points whose basis text is identical in both languages. */
export function groupBasis(basis: readonly DepthBasis[]): BasisGroup[] {
  const groups: BasisGroup[] = [];
  for (const entry of basis) {
    const last = groups[groups.length - 1];
    if (
      last &&
      entry.point !== null &&
      last.to !== null &&
      entry.point === last.to + 1 &&
      entry.ar === last.ar &&
      entry.en === last.en
    ) {
      last.to = entry.point;
    } else {
      groups.push({ from: entry.point, to: entry.point, ar: entry.ar, en: entry.en });
    }
  }
  return groups;
}

export function groupTag(group: BasisGroup): string | null {
  if (group.from === null) return null;
  return group.to !== null && group.to !== group.from
    ? `P${group.from}–P${group.to}`
    : `P${group.from}`;
}

export function DepthBasisCell({
  basis,
  className,
}: {
  basis: readonly DepthBasis[];
  className?: string;
}) {
  if (basis.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-0.5 text-xs text-ink-secondary", className)}>
      {groupBasis(basis).map((group) => {
        const tag = groupTag(group);
        return (
          <li key={`${group.from}-${group.to}-${group.en}`} className="flex gap-1.5">
            {tag ? <Ltr className="shrink-0 font-semibold text-ink-muted">{tag}</Ltr> : null}
            <Bi ar={group.ar} en={group.en} />
          </li>
        );
      })}
    </ul>
  );
}
