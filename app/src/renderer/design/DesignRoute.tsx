/**
 * /design (development builds only): every token in both themes and both directions; the domain
 * tokens labelled with the engine's real /meta/labels payload (app/fixtures/labels.json); and the
 * WCAG AA check of tokens.css that design/contrast.test.ts also runs. The component pages are
 * /design/components and /design/domain.
 */
import { ArrowRight, ChevronRight, Search } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { CodeLabel } from "@/components/domain/labels";
import { Bi } from "@/components/ui/Bi";
import { Chip } from "@/components/ui/Chip";
import { DirectionalIcon } from "@/components/ui/DirectionalIcon";
import { Ltr, Num } from "@/components/ui/Ltr";
import { cn } from "@/lib/cn";
import { indexStateLabel, messagePair, translate } from "@/i18n/t";
import { contrastRatio, parseThemeTokens, type ThemeName } from "./contrast";
import { fixtures } from "./fixtures";
import { GallerySection as Section, GalleryShell } from "./GalleryShell";
import {
  BUCKET_TONE,
  COLOR_FAMILIES,
  CONTRAST_PAIRS,
  depthMarker,
  DURATIONS,
  FLAG_TONE,
  FONT_WEIGHTS,
  INDEX_STATE_TONE,
  MEASURE_PALETTE,
  NEUTRAL_SCALES,
  OVERLAY_STYLE,
  RADII,
  SHADOWS,
  SPACING_STEPS,
  STATUS_TONE,
  TEXT_SIZES,
  Z_LAYERS,
  type DepthSource,
} from "./index";
import tokensCss from "./tokens.css?raw";

const labels = fixtures.labels;

const THEMES: readonly ThemeName[] = ["light", "dark"];
const LANGS = ["ar", "en"] as const;

function rootVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function ThemePanel({ theme, values }: { theme: ThemeName; values: Record<string, string> }) {
  return (
    <div
      data-theme={theme}
      className="flex flex-col gap-3 rounded-lg border border-border bg-canvas p-4 text-ink"
    >
      <h3 className="font-semibold">
        <Ltr>{theme}</Ltr>
      </h3>
      {COLOR_FAMILIES.map(({ family, tokens }) => (
        <div key={family}>
          <div className="mb-1 text-xs text-ink-muted">
            <Ltr>{family}</Ltr>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
            {tokens.map((token) => (
              <figure key={token} className="flex flex-col gap-1">
                <div
                  className="h-9 rounded-md border border-border"
                  style={{ background: `var(--nz-${token})` }}
                />
                <figcaption className="flex flex-col text-xs leading-tight">
                  <Ltr className="font-medium">{token}</Ltr>
                  <Ltr className="text-ink-muted">{values[`--nz-${token}`] ?? "--"}</Ltr>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ContrastReport({ values }: { values: Record<ThemeName, Record<string, string>> }) {
  const results = useMemo(
    () =>
      THEMES.flatMap((theme) =>
        CONTRAST_PAIRS.map((pair) => {
          const fg = values[theme][`--nz-${pair.fg}`];
          const bg = values[theme][`--nz-${pair.bg}`];
          const ratio = fg && bg ? contrastRatio(fg, bg) : 0;
          return { ...pair, theme, ratio };
        }),
      ),
    [values],
  );
  const failing = results.filter((r) => r.ratio < r.min);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        <Bi {...messagePair("design.pairs")} />: <Num value={results.length} /> ·{" "}
        {failing.length === 0 ? (
          <span className="text-success-text">
            <Bi {...messagePair("design.allPass")} />
          </span>
        ) : (
          <span className="text-danger-text">
            <Bi {...messagePair("design.failing")} />: <Num value={failing.length} />
          </span>
        )}
      </p>
      <details>
        <summary className="cursor-pointer text-ink-secondary">
          <Bi {...messagePair("design.contrast")} />
        </summary>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {results.map((r) => (
            <div
              key={`${r.theme}-${r.fg}-${r.bg}`}
              data-theme={r.theme}
              className={cn(
                "flex items-center justify-between gap-2 rounded-sm px-2 py-1",
                r.ratio < r.min && "outline-2 outline-danger",
              )}
              style={{ background: `var(--nz-${r.bg})`, color: `var(--nz-${r.fg})` }}
            >
              <Ltr className="text-xs">
                {r.theme}: {r.fg} / {r.bg}
              </Ltr>
              <Ltr className="text-xs tabular-nums">
                {r.ratio.toFixed(2)} ≥ {r.min}
              </Ltr>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function DepthMarkers({ color }: { color: string }) {
  const s = OVERLAY_STYLE;
  return (
    <svg
      viewBox="0 0 240 60"
      className="h-24 w-full max-w-xl rounded-md border border-border"
      style={{ background: "#8a7560" }}
      role="img"
      aria-hidden="true"
    >
      <line
        x1={8}
        y1={52}
        x2={232}
        y2={52}
        stroke={s.groundColor}
        strokeWidth={s.groundLineWidth}
      />
      <circle
        cx={30}
        cy={28}
        r={s.directRadius}
        fill={color}
        stroke="#ffffff"
        strokeWidth={s.directEdge}
      />
      <line
        x1={80}
        y1={28}
        x2={98}
        y2={38}
        stroke={color}
        strokeWidth={s.leaderWidth}
        strokeDasharray={s.leaderDash}
        strokeLinecap="round"
      />
      <circle cx={98} cy={38} r={s.centroidRadius} fill={color} />
      <circle
        cx={80}
        cy={28}
        r={s.knnRadius}
        fill="none"
        stroke={color}
        strokeWidth={s.markerStroke}
      />
      <path
        d={`M ${150 - s.rejectedHalf} ${28 - s.rejectedHalf} L ${150 + s.rejectedHalf} ${28 + s.rejectedHalf} M ${150 + s.rejectedHalf} ${28 - s.rejectedHalf} L ${150 - s.rejectedHalf} ${28 + s.rejectedHalf}`}
        stroke={s.rejectedColor}
        strokeWidth={s.rejectedStroke}
      />
      <rect
        x={195.5}
        y={23.5}
        width={9}
        height={9}
        fill={color}
        stroke="#ffffff"
        strokeWidth={s.directEdge}
      />
    </svg>
  );
}

function DirectionBox({ lang, children }: { lang: "ar" | "en"; children: ReactNode }) {
  return (
    <div
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
    >
      <Ltr className="text-xs text-ink-muted">{lang === "ar" ? "dir=rtl" : "dir=ltr"}</Ltr>
      {children}
    </div>
  );
}

export default function DesignRoute() {
  const values = useMemo(() => parseThemeTokens(tokensCss), []);
  const sources = Object.entries(labels.sources) as [DepthSource, { ar: string; en: string }][];
  return (
    <GalleryShell title="design.title" intro="design.intro">
      <Section title="design.sections.colours">
        <div className="grid gap-4 lg:grid-cols-2">
          {THEMES.map((theme) => (
            <ThemePanel key={theme} theme={theme} values={values[theme]} />
          ))}
        </div>
        <ContrastReport values={values} />
      </Section>

      <Section title="design.sections.scales">
        {Object.entries(NEUTRAL_SCALES).map(([scale, steps]) => (
          <div key={scale} className="flex flex-col gap-1">
            <Ltr className="text-xs text-ink-muted">{scale}</Ltr>
            <div className="flex overflow-hidden rounded-md border border-border">
              {steps.map(([step, cls]) => (
                <div key={step} className={cn("flex h-12 flex-1 items-end p-1", cls)}>
                  <Ltr className="rounded-xs bg-surface/80 px-1 text-[0.65rem] text-ink">
                    {step}
                  </Ltr>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section title="design.sections.measure">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2">
          {MEASURE_PALETTE.map((hex, index) => (
            <figure key={hex} className="flex flex-col gap-1">
              <div className="h-9 rounded-md border border-border" style={{ background: hex }} />
              <figcaption className="text-xs">
                <Ltr>
                  {index} · {hex}
                </Ltr>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section title="design.sections.depth">
        <DepthMarkers color={MEASURE_PALETTE[1]} />
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {(["direct", "knn", "rejected", "ground", "groundLine"] as const).map((key) => (
            <li key={key}>
              <Bi {...messagePair(`design.depth.${key}`)} />
            </li>
          ))}
        </ul>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {sources.map(([source, label]) => (
            <li key={source} className="flex items-center gap-2">
              <Chip tone={depthMarker(source) === "knn" ? "info" : "neutral"}>
                <Ltr>{depthMarker(source)}</Ltr>
              </Chip>
              <Bi {...label} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="design.sections.flags">
        <div className="flex flex-wrap gap-2">
          {Object.entries(labels.rejections).map(([code, label]) => (
            <Chip key={code} tone={FLAG_TONE.hard}>
              <Bi {...label} />
            </Chip>
          ))}
          {Object.entries(labels.flags).map(([code, label]) => (
            <Chip key={code} tone={label.severity === "warn" ? FLAG_TONE.warn : FLAG_TONE.info}>
              <Bi ar={label.ar} en={label.en} />
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="design.sections.states">
        <div className="flex flex-wrap gap-2">
          {(["open", "finalized", "exported"] as const).map((status) => (
            <Chip key={status} tone={STATUS_TONE[status]}>
              <CodeLabel group="statuses" code={status} />
            </Chip>
          ))}
          {(["ok", "missing_files", "corrupt", "delete_failed", "unindexed"] as const).map(
            (state) => (
              <Chip key={state} tone={INDEX_STATE_TONE[state]}>
                <Bi {...indexStateLabel(state)} />
              </Chip>
            ),
          )}
        </div>
      </Section>

      <Section title="design.sections.buckets">
        <div className="flex flex-wrap gap-2">
          {(["SIDE", "END", "QUARTER"] as const).map((bucket) => (
            <Chip key={bucket} tone={BUCKET_TONE[bucket]}>
              <Ltr>{bucket}</Ltr>&nbsp;
              <CodeLabel group="buckets" code={bucket} />
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="design.sections.type">
        <div className="grid gap-4 lg:grid-cols-2">
          {LANGS.map((lang) => (
            <DirectionBox key={lang} lang={lang}>
              {TEXT_SIZES.map(([name, cls]) => (
                <div key={name} className="flex items-baseline gap-3">
                  <Ltr className="w-10 shrink-0 text-xs text-ink-muted">{name}</Ltr>
                  <span className={cls}>{translate(lang, "design.sample.heading")}</span>
                </div>
              ))}
              <div className="flex flex-wrap gap-4 pt-2">
                {FONT_WEIGHTS.map(([weight, cls]) => (
                  <span key={weight} className={cls}>
                    <Ltr>{weight}</Ltr> {translate(lang, "app.name")}
                  </span>
                ))}
              </div>
              <p className="text-ink-secondary">{translate(lang, "design.sample.body")}</p>
            </DirectionBox>
          ))}
        </div>
      </Section>

      <Section title="design.sections.bidi">
        <div className="grid gap-4 lg:grid-cols-2">
          {LANGS.map((lang) => (
            <DirectionBox key={lang} lang={lang}>
              {(["ar", "en", "both"] as const).map((mode) => (
                <p key={mode}>
                  <Ltr className="text-xs text-ink-muted">{`mode=${mode}`}</Ltr>{" "}
                  <Bi {...messagePair("design.sample.withersHeight")} mode={mode} />
                </p>
              ))}
              <Bi {...messagePair("design.sample.withersHeight")} mode="both" block />
              <p>
                {translate(lang, "design.sample.withersHeight")}{" "}
                <Num value={1.84236} digits={3} unit={translate(lang, "units.m")} />{" "}
                {translate(lang, "design.sample.fromFrame")} <Ltr>c03_000180</Ltr>
              </p>
            </DirectionBox>
          ))}
        </div>
      </Section>

      <Section title="design.sections.space">
        <div className="flex flex-col gap-1">
          {SPACING_STEPS.map(([step, cls]) => (
            <div key={step} className="flex items-center gap-3">
              <Ltr className="w-24 text-xs text-ink-muted">{`spacing × ${step}`}</Ltr>
              <div className={cn("h-3 rounded-xs bg-primary", cls)} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="design.sections.radius">
        <div className="flex flex-wrap gap-4">
          {RADII.map(([name, cls]) => (
            <div
              key={name}
              className={cn(
                "flex size-20 items-center justify-center border border-border-strong bg-surface",
                cls,
              )}
            >
              <Ltr className="text-xs">{name}</Ltr>
            </div>
          ))}
        </div>
      </Section>

      <Section title="design.sections.shadow">
        <div className="flex flex-wrap gap-6">
          {SHADOWS.map(([name, cls]) => (
            <div
              key={name}
              className={cn(
                "flex h-20 w-32 items-center justify-center rounded-lg bg-surface-raised",
                cls,
              )}
            >
              <Ltr className="text-xs">{name}</Ltr>
            </div>
          ))}
        </div>
      </Section>

      <Section title="design.sections.layers">
        <ul className="grid gap-1 text-sm sm:grid-cols-3">
          {Z_LAYERS.map((layer) => (
            <li key={layer}>
              <Ltr>
                --nz-z-{layer}: {rootVar(`--nz-z-${layer}`)}
              </Ltr>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="design.sections.motion">
        <p className="text-sm text-ink-secondary">
          <Bi {...messagePair("design.motion")} />
        </p>
        <div className="flex flex-wrap gap-8">
          {DURATIONS.map((name) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <div
                tabIndex={0}
                className={cn(
                  "size-12 rounded-md bg-primary transition-transform ease-standard hover:scale-125 focus-visible:scale-125",
                  name === "fast" && "duration-(--nz-duration-fast)",
                  name === "base" && "duration-(--nz-duration-base)",
                  name === "slow" && "duration-(--nz-duration-slow)",
                )}
              />
              <Ltr className="text-xs">
                {name}: {rootVar(`--nz-duration-${name}`)}
              </Ltr>
            </div>
          ))}
        </div>
      </Section>

      <Section title="design.sections.icons">
        <p className="text-sm text-ink-secondary">
          <Bi {...messagePair("design.icons")} />
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {LANGS.map((lang) => (
            <DirectionBox key={lang} lang={lang}>
              <div className="flex items-center gap-4 text-ink">
                <DirectionalIcon icon={ChevronRight} className="size-6" />
                <DirectionalIcon icon={ArrowRight} className="size-6" />
                <Search aria-hidden="true" className="size-6" />
                <span className="text-xs text-ink-muted">
                  <Bi {...messagePair("design.unchanged")} />
                </span>
              </div>
            </DirectionBox>
          ))}
        </div>
      </Section>

      <Section title="design.sections.focus">
        <p className="text-sm text-ink-secondary">
          <Bi {...messagePair("design.focus")} />
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="min-h-8 rounded-md bg-primary px-4 text-primary-fg hover:bg-primary-hover active:bg-primary-active"
          >
            <Bi {...messagePair("design.button")} />
          </button>
          <button
            type="button"
            className="min-h-8 rounded-md border border-border-control bg-surface px-4 hover:bg-surface-hover"
          >
            <Bi {...messagePair("design.button")} />
          </button>
          <button type="button" className="min-h-8 rounded-md bg-danger px-4 text-danger-fg">
            <Bi {...messagePair("design.button")} />
          </button>
          <input
            aria-label={translate("en", "design.button")}
            className="min-h-8 rounded-sm border border-border-control bg-surface-raised px-2"
            defaultValue="جمل-تجربة-1"
          />
        </div>
      </Section>
    </GalleryShell>
  );
}
