# Nazeer design system

Tokens and foundations for the operator UI (Tailwind CSS v4). The gallery at `#/design`
(development builds only) shows every token in both themes and both directions.

## Files

| File              | What it holds                                                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens.css`      | Every colour, type, radius, shadow, layer and motion token. Theme values are `--nz-*` custom properties on `[data-theme]` scopes; `@theme inline` maps them to utilities (`bg-surface`, `text-ink`, `border-border-control`, …). |
| `fonts.css`       | IBM Plex Sans Arabic 400/500/600/700 from `@fontsource` (OFL-1.1), bundled.                                                                                                                                                      |
| `index.ts`        | The token registry the gallery and the tests read, the domain → tone maps, the overlay's marker geometry.                                                                                                                        |
| `contrast.ts`     | WCAG 2.x maths over the values parsed from `tokens.css`.                                                                                                                                                                         |
| `language.tsx`    | The UI language context (`lang`, bilingual mode).                                                                                                                                                                                |
| `DesignRoute.tsx` | The `#/design` gallery page of the tokens; `ComponentsGallery.tsx` (`#/design/components`) and `DomainGallery.tsx` (`#/design/domain`) show the components; `GalleryShell.tsx` frames all three.                                 |
| `fixtures.ts`     | The engine payloads in `app/fixtures/`, typed (gallery and tests only).                                                                                                                                                          |
| `samples.ts`      | Hand-made states the fixtures lack (a walk in progress, a DRIFT probe, History rows in every index state).                                                                                                                       |
| `devAssets.ts`    | Engine asset paths → the dev data root's files (`runs/dev_root`) through the Vite dev server (`/@fs/`).                                                                                                                          |

## Rules

- **Tokens only.** Tailwind's default palette is removed (`--color-*: initial`); use the semantic
  utilities. Colour values live in `tokens.css` and nowhere else, except what is drawn on the camel
  photo (theme-independent): `OVERLAY_STYLE` (the engine overlay's conventions) and `CANVAS_STYLE`
  (the editing canvas's mask tint, depth box, halo, crosshair) in `index.ts`.
- **Themes.** `light` (the parent report's sand and terracotta) and `dark`. `<html data-theme>`
  follows the `ui.theme` preference (`system` follows Windows). Because utilities read the
  variables at the element, any subtree can carry its own `data-theme`.
- **Contrast.** Every text/surface pair the UI uses is listed in `CONTRAST_PAIRS` and must reach
  WCAG AA (4.5:1 for text, 3:1 for control boundaries and the focus ring) in both themes:
  `contrast.test.ts` fails otherwise, and the gallery shows the same check. `ink-muted` is
  the lightest text colour allowed; `border` and `border-strong` are decorative,
  `border-control` outlines inputs and other controls.
- **Tones for the domain** (chips, badges): `TONE_CLASSES[tone]` gives text + tint + border.
  Flag chips: a hard rejection is `danger`, the engine's `warn` flags `warning`, `info` flags
  `info` (`FLAG_TONE`). Session status: open `info`, finalized `primary`, exported `success`.
  History index states: missing files `warning`, corrupt and delete failed `danger`, unindexed
  and ok `neutral`. Candidate buckets have their own hues (`side`, `end`, `quarter`).
- **Measurement colours** come from the engine: the canvas draws `row.display_color`.
  `--color-measure-0…11` repeat the engine's `assign_color` palette for legends and swatches.
- **Depth markers** follow the engine overlay (`OVERLAY_STYLE`, image pixels): direct depth is a
  filled dot with a white edge, a KNN-snapped point a hollow ring with a dotted leader to its
  neighbour centroid, a rejected point a grey cross, the ground line red. The editing canvas adds
  a square for Shift-click ground targets (the overlay does not draw one).
- **Type.** IBM Plex Sans Arabic for Arabic and Latin, with taller line heights than Tailwind's
  defaults. Every weight used is bundled, and `font-synthesis: none` forbids synthesized bold.
  The print page does not use these files: it receives the engine's pinned Regular TTF from
  Electron main and prints everything at weight 400 (D9, B38).
- **RTL first.** Arabic is the default. `<html lang dir>` follows `ui.lang`; Radix gets the same
  direction. Use logical utilities only (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`,
  `text-start`, `border-s`, `rounded-s`, …); `rtl-classes.test.ts` fails on physical ones
  (`ml-`, `pr-`, `left-`, `text-right`, …). A line that must stay physical (image space on the
  measuring canvas, which is always left-to-right) carries a `physical-ok` comment.
- **Icons** that point somewhere (arrows, chevrons) go through `DirectionalIcon`, which mirrors
  them in RTL; neutral icons are used as they are. The `rtl:` / `ltr:` variants are redefined from
  the computed direction (`:dir()`): Tailwind's built-in ones also match anything inside a
  `[dir="rtl"]` element, which mirrored arrows inside LTR islands.
- **Numbers, ids and paths** sit in left-to-right isolates: `<Num value digits unit />` (ASCII
  digits in both languages, as the engine and the PDF print them) and `<Ltr>`. A unit follows the
  number outside its isolate, in the surrounding direction, joined by a no-break space: inside the
  isolate an Arabic unit would read before the number ("م 1.842"). File paths go through
  `<PathText>`, which isolates every folder: an Arabic folder name otherwise turns the digits after
  it into an Arabic run and the path reads in the wrong order.
- **Engine codes** render through `<CodeLabel group code />` (`components/domain/labels.tsx`), which
  shows the raw code when `/meta/labels` has none; measurement rows render their `presentation`
  verbatim. Components never compute a value, a depth, a flag or a rejection.
- **Canvas and PDF are image space**: the measuring canvas is `dir="ltr"`, and so is the pdf.js page
  canvas (pdf.js draws glyphs with canvas text, whose direction follows the element; in the Arabic
  page every glyph shifted by its own width).
- **Bilingual labels** render through `<Bi ar en />`: each half in its own `lang` + `dir`
  isolate. The mode follows the UI (the selected language, or both when "show both languages"
  is on). Latin runs inside the Arabic half ("Z_ref (> 10 %)", "KNN", numbers) get their own LTR
  isolates (`lib/bidi.tsx`), so the bidi algorithm cannot move or mirror their brackets; the
  characters themselves never change. Engine codes are labelled from `/meta/labels`; chrome
  strings and the codes that endpoint does not label (API errors, index states, job stages) come
  from `i18n/ar.json` and `i18n/en.json`.
- **No invisible characters in source**: bidi controls, zero-width marks and no-break spaces are
  built with `String.fromCharCode` (`NBSP` in `components/ui/Ltr.tsx`);
  `src/shared/no-invisible-chars.test.ts` fails otherwise.
- **Accessibility.** The focus ring (`--nz-focus`, 2 px, 2 px offset) is global for
  `:focus-visible`; controls are at least 32 px (`min-h-8`, `--nz-hit-min`); motion durations
  drop to zero under `prefers-reduced-motion`.
- **Layers and motion** use the `--nz-z-*` and `--nz-duration-*` variables
  (`z-(--nz-z-dialog)`, `duration-(--nz-duration-base)`), and `ease-standard`.
