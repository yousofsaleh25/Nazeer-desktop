/**
 * The ground line the engine drew: its image row, and its badge when the far-side legs put the
 * raw lowest row elsewhere (`far_side_row_differs`) or no row could be resolved.
 */
import { Footprints } from "lucide-react";
import type { FrameInfo } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Chip } from "@/components/ui/Chip";
import { Ltr } from "@/components/ui/Ltr";
import { messagePair } from "@/i18n/t";
import { readNumber, readString } from "@/lib/read";
import { CodeLabel } from "./labels";

export function GroundLineBadge({ ground }: { ground: FrameInfo["ground"] }) {
  const row = readNumber(ground, "drawn_row");
  const raw = readNumber(ground, "raw_row");
  const badge = readString(ground, "badge");
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Footprints aria-hidden="true" className="size-4 text-overlay-ground" />
      <span className="text-ink-secondary">
        <Bi {...messagePair("ground.title")} />:
      </span>
      {row !== null ? (
        <span>
          <Bi {...messagePair("ground.row")} /> <Ltr className="font-medium">{row}</Ltr>
        </span>
      ) : (
        <Chip tone="danger">
          <CodeLabel group="ground_badges" code="ground_row_unresolved" />
        </Chip>
      )}
      {badge ? (
        <Chip tone="warning">
          <CodeLabel group="ground_badges" code={badge} />
          {badge === "far_side_row_differs" && raw !== null ? (
            <>
              {" "}
              (<Ltr>{raw}</Ltr>)
            </>
          ) : null}
        </Chip>
      ) : null}
    </div>
  );
}
