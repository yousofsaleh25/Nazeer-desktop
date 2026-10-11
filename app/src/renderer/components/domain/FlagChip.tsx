/**
 * The engine's verdicts on a row, rendered exactly as `presentation` sends them: soft flags
 * (warn → warning, info → info), hard rejections (danger, with the point they concern), and the
 * confidence. Nothing here decides a flag or a rejection.
 */
import { Ban, Info, TriangleAlert } from "lucide-react";
import type { FlagChipData, Presentation, RejectionPart } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Chip } from "@/components/ui/Chip";
import { Ltr } from "@/components/ui/Ltr";
import { FLAG_TONE } from "@/design";

export function FlagChip({ flag }: { flag: FlagChipData }) {
  const warn = flag.severity === "warn";
  return (
    <Chip tone={warn ? FLAG_TONE.warn : FLAG_TONE.info} icon={warn ? TriangleAlert : Info}>
      <Bi ar={flag.ar} en={flag.en} />
    </Chip>
  );
}

/** "p1" → "P1"; a part without a point (a whole-row rejection) shows no prefix. */
export function pointTag(point: string | number | null | undefined): string | null {
  if (point === null || point === undefined || point === "") return null;
  return typeof point === "number" ? `P${point}` : point.toUpperCase();
}

export function RejectionChip({ part }: { part: RejectionPart }) {
  const tag = pointTag(part.point);
  return (
    <Chip tone={FLAG_TONE.hard} icon={Ban}>
      <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
        {tag ? <Ltr className="font-semibold">{tag}</Ltr> : null}
        <Bi ar={part.ar} en={part.en} />
      </span>
    </Chip>
  );
}

export function ConfidenceChip({ confidence }: { confidence: Presentation["confidence"] }) {
  if (!confidence) return null;
  const ar = confidence["ar"];
  const en = confidence["en"];
  if (ar === undefined || en === undefined) return null;
  return (
    <Chip tone={confidence["code"] === "low" ? "warning" : "neutral"}>
      <Bi ar={ar} en={en} />
    </Chip>
  );
}
