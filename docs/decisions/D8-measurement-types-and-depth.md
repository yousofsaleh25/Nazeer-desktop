# D8 — Measurement types and depth provenance (KNN fallback)

Status: accepted 2026-10-10 (measurement types, operator) · proposed 2026-10-10, reviewed
by a 3-skeptic read-only pass (contract C1 parameters: k, erosion, thresholds, Shift-click
modifier). Angles are kept by assumption — the operator listed only distances and curves.

## Context

The operator measures freely on one chosen frame and names each measurement: 2D distance,
3D distance, 2D curve, 3D curve with depth considered. Rule given verbatim: "when user input
a point unvalid outside the mask pick the k nearest neighbours to pick the closest points
depth average; if the point outside the mask use KNN."

The parent code has 2D distance, 3D distance, 2D curve and four angle kinds, but no 3D
curve (`grep curve_3d|curve_length_3d|points_3d` → 0 hits; `CurveMeasurement.measurement_type`
is hard-coded `curve_2d`). The parent's `backproject_pixel` rejects a click when fewer than
30 % of its 5×5 window has valid depth; on real frames 24–49 % of silhouette pixels fail that
rule, so a fallback is genuinely needed.

Review evidence (four real bundles under
`E:\camel_beauty\runs\frame_quality_sweep\v2_2026_05_14\frames\`): a plain mean over the k
nearest raw-mask pixels was 0.26–0.30 m wrong 20 px under a hoof (the mask boundary ring
carries misaligned background depth); the median over the mask eroded by 2 px was within
1–6 cm; a ground click 30 px below a hoof differs by 27 cm between "camel plane" and
"measured ground surface" (11.7 cm vs 29.2 cm for the hoof-to-ground 3D line); one far
control point inflates a 45 cm 3D curve to 5.16 m if unflagged; a far-side leg puts the raw
lowest mask row 37 px (10 cm) below the near-plane ground.

## Options

- Aggregate: mean (the operator's word) vs median (the parent's estimator; tolerates ⌊k/2⌋
  bad neighbours). Pixel set: raw mask vs mask eroded by 2–3 px. k: 7 vs 9.
- Outside-mask clicks: always snap to the camel (operator's rule) vs always keep the
  pixel's own depth vs snap by default with an explicit modifier for ground/background points.
- 3D-curve failures: reject the whole curve vs flag segments and keep the row.

## Decision

Contract C1 as written in `CLAUDE.md`:

- Direct value = 5×5 window median (in-mask pixels when inside the mask; spread flag).
- KNN fallback = **median** of k = 9 nearest valid pixels of the **2-px-eroded** mask
  (cKDTree built at frame load).
- Agreement test; the default Line/Curve tool follows the operator's rule (camel depth) with
  both depths stored and printed when they disagree; Shift-click "ground / background point"
  keeps the direct depth.
- Hard rejections: `pixel_out_of_image`, `no_valid_depth_in_mask`, `mask_valid_too_sparse`,
  `knn_too_far` (> 0.30 m). Soft flags: `knn_far` (> 0.10 m), `knn_spread`, `depth_edge`,
  `off_mask_surface`.
- Per-point typed, finite-only provenance; KNN endpoints get
  `uncertainty = sqrt(σ_d² + nn_dist_m_max²)`; 2D rows get
  `uncertainty = distance · z_mad / z_median`; 3D curves carry per-segment dz with
  `segment_depth_jump` flags and a Z_ref 2D cross-check.
- Z_ref = median over the 2-px-eroded mask, one frozen block per session. Ground row =
  near-plane lowest row (columns whose bottom-8-px depth is within 12 % of Z_ref).
- The operator picks the kind explicitly; nothing falls back from 3D to 2D.
- Constants (`DEPTH_WINDOW` 5, `KNN_K` 9, `KNN_RING_EXCLUDE_PX` 2, thresholds) are stamped
  into `session.json`.

## Consequences

- `curve_length_3d` and `depth_for_pixel` are new engine code with their own adversarial
  tests; `CurveMeasurement` gains `points_3d`, `point_depth[]`, `segment_dz_m[]`;
  `LineMeasurement` gains per-endpoint provenance — hence schema 2.1 (D10).
- The overlay and the PDF must render provenance (hollow markers + leader lines, a bilingual
  "Depth basis" column, flag chips, "N of M points snapped").
- Parameters k = 9, erosion 2 px, the 0.10 / 0.30 m distances and the Shift-click modifier
  are defaults to confirm with the operator; the operator's "average" became "median" for
  the evidence above.
