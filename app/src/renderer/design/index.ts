/**
 * The design system in TypeScript: the token registry the /design gallery and the tests read,
 * the domain → tone mappings components use, and the overlay's marker geometry for the canvas.
 * Colour values live in tokens.css only. Class names are written out in full so Tailwind sees them.
 */
import type { components } from "@shared/api";

export type { ThemeName } from "./contrast";

type Schemas = components["schemas"];
export type SessionStatus = Schemas["SessionView"]["status"];
export type IndexState = NonNullable<Schemas["SessionView"]["index_state"]>;
export type Bucket = NonNullable<Schemas["CandidateItem"]["bucket"]>;
export type DepthSource = NonNullable<Schemas["DepthOut"]["source"]>;

// ----- colour tokens ---------------------------------------------------------------------------

/** Semantic colour tokens by family (the CSS variable is `--nz-<name>`, the utility `*-<name>`). */
export const COLOR_FAMILIES: readonly { family: string; tokens: readonly string[] }[] = [
  {
    family: "surface",
    tokens: ["canvas", "surface", "surface-raised", "surface-sunken", "surface-hover"],
  },
  { family: "border", tokens: ["border", "border-strong", "border-control", "focus"] },
  { family: "ink", tokens: ["ink", "ink-secondary", "ink-muted"] },
  {
    family: "primary",
    tokens: [
      "primary",
      "primary-hover",
      "primary-active",
      "primary-fg",
      "primary-text",
      "primary-soft",
      "primary-border",
    ],
  },
  ...(["success", "warning", "danger", "info"] as const).map((tone) => ({
    family: tone,
    tokens: [tone, `${tone}-fg`, `${tone}-text`, `${tone}-soft`, `${tone}-border`],
  })),
  ...(["side", "end", "quarter"] as const).map((bucket) => ({
    family: `bucket-${bucket}`,
    tokens: [`bucket-${bucket}-text`, `bucket-${bucket}-soft`, `bucket-${bucket}-border`],
  })),
];

/** Raw neutral scales: sand (light theme) and night (dark theme). */
export const NEUTRAL_SCALES = {
  sand: [
    ["50", "bg-sand-50"],
    ["100", "bg-sand-100"],
    ["200", "bg-sand-200"],
    ["300", "bg-sand-300"],
    ["400", "bg-sand-400"],
    ["500", "bg-sand-500"],
    ["600", "bg-sand-600"],
    ["700", "bg-sand-700"],
    ["800", "bg-sand-800"],
    ["900", "bg-sand-900"],
    ["950", "bg-sand-950"],
  ],
  night: [
    ["50", "bg-night-50"],
    ["100", "bg-night-100"],
    ["200", "bg-night-200"],
    ["300", "bg-night-300"],
    ["400", "bg-night-400"],
    ["500", "bg-night-500"],
    ["600", "bg-night-600"],
    ["700", "bg-night-700"],
    ["800", "bg-night-800"],
    ["900", "bg-night-900"],
    ["950", "bg-night-950"],
  ],
} as const;

export interface ContrastPair {
  fg: string;
  bg: string;
  /** WCAG AA: 4.5 for text, 3 for control boundaries and focus indicators */
  min: number;
  use: string;
}

const READING_SURFACES = ["canvas", "surface", "surface-raised", "surface-sunken", "surface-hover"];
const TEXT_TOKENS = [
  "ink",
  "ink-secondary",
  "ink-muted",
  "primary-text",
  "success-text",
  "warning-text",
  "danger-text",
  "info-text",
];

/** Every pair the UI draws text or a control boundary with; checked in both themes. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...TEXT_TOKENS.flatMap((fg) =>
    READING_SURFACES.map((bg) => ({ fg, bg, min: 4.5, use: "text on a surface" })),
  ),
  ...["primary", "primary-hover", "primary-active"].map((bg) => ({
    fg: "primary-fg",
    bg,
    min: 4.5,
    use: "text on the primary fill",
  })),
  ...(["success", "warning", "danger", "info"] as const).map((tone) => ({
    fg: `${tone}-fg`,
    bg: tone,
    min: 4.5,
    use: "text on a status fill",
  })),
  ...(["primary", "success", "warning", "danger", "info"] as const).map((tone) => ({
    fg: `${tone}-text`,
    bg: `${tone}-soft`,
    min: 4.5,
    use: "chip text on its tint",
  })),
  ...(["side", "end", "quarter"] as const).map((bucket) => ({
    fg: `bucket-${bucket}-text`,
    bg: `bucket-${bucket}-soft`,
    min: 4.5,
    use: "bucket badge",
  })),
  ...["canvas", "surface", "surface-raised"].flatMap((bg) => [
    { fg: "border-control", bg, min: 3, use: "control boundary" },
    { fg: "focus", bg, min: 3, use: "focus ring" },
  ]),
];

// ----- measurement palette and overlay conventions ---------------------------------------------

/** The engine's assign_color(0..11) (geometry.py); the canvas always draws row.display_color. */
export const MEASURE_PALETTE = [
  "#be2c2c",
  "#2c57be",
  "#81be2c",
  "#be2cab",
  "#2cbea5",
  "#be7b2c",
  "#502cbe",
  "#32be2c",
  "#be2c5d",
  "#2c87be",
  "#b2be2c",
  "#9f2cbe",
] as const;

/**
 * Marker geometry of the engine overlay (overlay.py), in image pixels at 100 % (matplotlib
 * points × 100/72): direct = filled dot with a white edge; KNN = hollow ring with a dotted leader
 * to the neighbour centroid; rejected = grey cross. The editing canvas reuses it so the judge sees
 * one visual language; it adds a square for Shift-click ground targets (canvas only).
 */
export const OVERLAY_STYLE = {
  directRadius: 3.5,
  directEdge: 1.1,
  knnRadius: 4.9,
  markerStroke: 2.2,
  leaderWidth: 1.4,
  leaderDash: "1.4 2.3",
  centroidRadius: 1.4,
  rejectedHalf: 4.9,
  rejectedStroke: 2.8,
  groundLineWidth: 2.8,
  groundColor: "#ff3333",
  jumpColor: "#ff3333",
  rejectedColor: "#9e9e9e",
  maskContour: "rgb(255 255 255 / 0.6)",
} as const;

/**
 * What the editing canvas adds on top of the photo (theme-independent, like OVERLAY_STYLE): the
 * mask tint, the shade outside the depth-valid box, the selection halo, the crosshair and the
 * in-progress clicks.
 */
export const CANVAS_STYLE = {
  maskTint: "#5ec8ff",
  maskOpacity: 0.32,
  depthShade: "rgb(0 0 0 / 0.38)",
  depthBoxStroke: "#ffd166",
  halo: "rgb(255 255 255 / 0.75)",
  crosshair: "#ffffff",
  crosshairShadow: "rgb(0 0 0 / 0.5)",
  draft: "#ffffff",
  draftShadow: "rgb(0 0 0 / 0.55)",
  markerEdge: "#ffffff",
} as const;

export type DepthMarker = "direct" | "knn" | "rejected";

/** How a point's depth provenance is drawn (C1.6): rejected → cross, KNN → hollow, else filled. */
export function depthMarker(
  source: DepthSource | null | undefined,
  reason?: string | null,
): DepthMarker {
  if (reason) return "rejected";
  if (source?.startsWith("knn_")) return "knn";
  return "direct";
}

// ----- domain tones ----------------------------------------------------------------------------

export type Tone =
  "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "side" | "end" | "quarter";

/** Text + tint + border for chips and badges (all pairs pass AA in both themes). */
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "text-ink-secondary bg-surface-sunken border-border-strong",
  primary: "text-primary-text bg-primary-soft border-primary-border",
  success: "text-success-text bg-success-soft border-success-border",
  warning: "text-warning-text bg-warning-soft border-warning-border",
  danger: "text-danger-text bg-danger-soft border-danger-border",
  info: "text-info-text bg-info-soft border-info-border",
  side: "text-bucket-side-text bg-bucket-side-soft border-bucket-side-border",
  end: "text-bucket-end-text bg-bucket-end-soft border-bucket-end-border",
  quarter: "text-bucket-quarter-text bg-bucket-quarter-soft border-bucket-quarter-border",
};

/** Flag chips: a hard rejection is danger; the engine's soft flags carry warn | info. */
export const FLAG_TONE = {
  hard: "danger",
  warn: "warning",
  info: "info",
} as const satisfies Record<string, Tone>;

export const STATUS_TONE: Record<SessionStatus, Tone> = {
  open: "info",
  finalized: "primary",
  exported: "success",
};

export const INDEX_STATE_TONE: Record<IndexState, Tone> = {
  ok: "neutral",
  missing_files: "warning",
  corrupt: "danger",
  delete_failed: "danger",
  unindexed: "neutral",
};

export const BUCKET_TONE: Record<Bucket, Tone> = { SIDE: "side", END: "end", QUARTER: "quarter" };

// ----- scales shown on /design (full class names: Tailwind only sees literal strings) ----------

export const TEXT_SIZES = [
  ["xs", "text-xs"],
  ["sm", "text-sm"],
  ["base", "text-base"],
  ["lg", "text-lg"],
  ["xl", "text-xl"],
  ["2xl", "text-2xl"],
  ["3xl", "text-3xl"],
  ["4xl", "text-4xl"],
] as const;

export const FONT_WEIGHTS = [
  [400, "font-normal"],
  [500, "font-medium"],
  [600, "font-semibold"],
  [700, "font-bold"],
] as const;

export const SPACING_STEPS = [
  ["1", "w-1"],
  ["2", "w-2"],
  ["3", "w-3"],
  ["4", "w-4"],
  ["6", "w-6"],
  ["8", "w-8"],
  ["12", "w-12"],
  ["16", "w-16"],
] as const;

export const RADII = [
  ["xs", "rounded-xs"],
  ["sm", "rounded-sm"],
  ["md", "rounded-md"],
  ["lg", "rounded-lg"],
  ["xl", "rounded-xl"],
  ["full", "rounded-full"],
] as const;

export const SHADOWS = [
  ["sm", "shadow-sm"],
  ["md", "shadow-md"],
  ["lg", "shadow-lg"],
] as const;

export const Z_LAYERS = ["sticky", "dropdown", "overlay", "dialog", "toast", "tooltip"] as const;
export const DURATIONS = ["fast", "base", "slow"] as const;
