/**
 * The frame's reference depth and ground line, frozen when the session was created (C1 / C2):
 * Z_ref = the median valid depth over the eroded mask, with the statistics behind it, and the
 * near-plane ground row. Every number is the engine's; a missing one shows "--".
 */
import type { ReactNode } from "react";
import type { FrameInfo, SessionSummary } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { Card } from "@/components/ui/Card";
import { Ltr, Num } from "@/components/ui/Ltr";
import { useLanguage } from "@/design/language";
import { messagePair, translate, type MessageKey } from "@/i18n/t";
import { readArray, readNumber, readString } from "@/lib/read";
import { GroundLineBadge } from "./GroundLineBadge";

function Row({ label, children }: { label: MessageKey; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-secondary">
        <Bi {...messagePair(label)} />
      </dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

export function ZRefCard({
  frame,
  summary = null,
}: {
  frame: Pick<FrameInfo, "z_ref" | "ground" | "width">;
  summary?: SessionSummary | null;
}) {
  const { lang } = useLanguage();
  const m = translate(lang, "units.m");
  const px = translate(lang, "units.px");
  const z = frame.z_ref;
  const fraction = readNumber(z, "valid_fraction");
  const relDisp = readNumber(z, "rel_disp");
  const band = (readArray(z, "band") ?? []).filter((v): v is number => typeof v === "number");
  const statistic = readString(z, "statistic");
  return (
    <Card title={messagePair("zref.title")}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <Ltr className="text-sm text-ink-secondary">Z_ref</Ltr>
        <Num
          value={readNumber(z, "z_ref_m")}
          digits={3}
          unit={m}
          className="text-2xl font-semibold"
        />
        {statistic ? (
          <span className="text-xs text-ink-muted">
            (<Bi {...messagePair(statistic === "median" ? "zref.median" : "zref.statistic")} />)
          </span>
        ) : null}
      </p>
      <dl className="flex flex-col gap-0.5 text-sm">
        <Row label="zref.validPixels">
          <Num value={readNumber(z, "n_valid")} grouping /> /{" "}
          <Num value={readNumber(z, "n_total")} grouping />
          {fraction !== null ? (
            <span className="text-ink-muted">
              {" "}
              (<Num value={fraction * 100} digits={1} unit="%" />)
            </span>
          ) : null}
        </Row>
        {/* rel_disp is the mean absolute deviation over the median (engine), so they share a row */}
        <Row label="zref.meanAbsDev">
          <Num value={readNumber(z, "z_mad_mean_abs_dev_m")} digits={3} unit={m} />
          {relDisp !== null ? (
            <span className="text-ink-muted">
              {" "}
              (<Num value={relDisp * 100} digits={1} unit="%" />)
            </span>
          ) : null}
        </Row>
        <Row label="zref.robustMad">
          <Num value={readNumber(z, "z_mad_robust_m")} digits={3} unit={m} />
        </Row>
        <Row label="zref.range">
          <Num value={readNumber(z, "z_min_m")} digits={3} /> –{" "}
          <Num value={readNumber(z, "z_max_m")} digits={3} unit={m} />
        </Row>
        {band.length === 2 ? (
          <Row label="zref.band">
            <Num value={band[0]} digits={1} /> – <Num value={band[1]} digits={1} unit={m} />
          </Row>
        ) : null}
        <Row label="zref.erosion">
          <Num value={readNumber(z, "erosion_px")} unit={px} />
        </Row>
      </dl>
      <GroundLineBadge ground={frame.ground} />
      {summary && summary.n_points > 0 ? (
        <p className="text-xs text-ink-secondary">
          <Bi {...summary.snapped_text} />
        </p>
      ) : null}
    </Card>
  );
}
