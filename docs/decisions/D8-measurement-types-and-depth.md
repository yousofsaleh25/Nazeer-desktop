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

## Engine parameters (implemented 2026-10-11)

Status: implemented (`engine/nazeer_engine/depthlookup.py`, `session_compute.py`,
`geometry.py`), unit-tested with adversarial cases, integration-tested on a real bag-004
frame. Every constant is stamped into `session.json` (`CONSTANTS_STAMP`).

- C1 as written: window 5×5, direct when ≥ 30 % of the **nominal** 25 pixels are valid (a
  border-clipped window counts its missing pixels as invalid — conservative, falls to KNN;
  `window_n_clipped` recorded); in-mask restriction when ≥ 30 % of the window is in the
  mask, else `window_unmasked`; `depth_edge` above max(0.10 m, 5 % Z) with the nearer
  cluster taken when the median sits in the far one; KNN k = 9 median over the 2-px-eroded
  mask (raw mask → `knn_raw_boundary`), `k_used` clamped; agreement max(0.05 m, 3 % Z);
  `knn_far` > 0.10 m, `knn_too_far` > 0.30 m (hard); sparse = eroded valid pixels <
  max(9, 2 % of the mask).
- **Cluster size (review 2026-10-11, B42):** C1.2's "nearer cluster" and C1.3's "nearest
  cluster" must hold max(3, 20 %) of the values (`EDGE_CLUSTER_MIN_PX`,
  `EDGE_CLUSTER_MIN_FRAC`). Without it one stray 1.5 m pixel among 24 at 2.0 m set the
  point to 1.5 m; now the median stands and the spread is still flagged.
- When a snapped point's own surface disagrees with the camel (`off_mask_surface`), the
  depth-basis cell prints both depths (C1.4 "the row prints both").
- Sources: `window_median`, `knn_snapped_to_mask` (outside the mask), `knn_fill` (inside,
  window sparse), `knn_no_depth_band` (outside the depth-valid region), `knn_raw_boundary`,
  `direct_off_mask` (ground target). Clicks use half-up pixel rounding, as the canvas does
  (B32).
- The Shift-click is a per-point `targets[i] = "ground"` in the measurement input. A ground
  point with no valid window falls back to KNN, flagged `ground_target_unresolved`, low
  confidence (B9).
- Angles: `angle_4point` resolves to `angle_2d_4point` or `angle_3d_4point` from the two
  referenced lines; one 2D and one 3D line → rejected `mixed_line_kinds` (B8);
  `angle_2d_3point`, `angle_3d_3point`, `angle_2d_from_horizontal` as in the parent.
- Real frame (bag 004): a click 15 px above the back resolved as `knn_no_depth_band`,
  "outside depth coverage, snapped to camel 5.6 cm"; a 3D curve's `cross_check_2d_m`
  equals the 2D curve on the same points; a vertical and a horizontal 2D line measure
  90.0°.
