# Reuse map — vendor from the parent, do not import it

Moved from `CLAUDE.md` on 2026-10-24. The vendoring it describes was done on 2026-10-11; keep this
for any further code taken from the parent repository.

The engine venv has no `camel_beauty`; copy what you need with its tests. Sources in
`E:\camel_beauty\`:

| Need | Copy from | Tests to port |
|---|---|---|
| `Intrinsics`, `backproject_pixel`, `distance_3d`, `distance_2d_image_plane`, `curve_length_2d`, `compute_mask_depth_stats`, `build_ground_band_mask`, `propagate_distance_uncertainty`, `angle_between_lines`, `angle_3point`, `angle_from_horizontal_2d`, `format_distance`, `generate_unique_colors` / `assign_color`, `_draw_ground_reference_cv2` (the live-view ground line — keep byte-equivalent), `find_arabic_font_path` (re-root: it resolves `parents[3]` = parent repo root) | `src/camel_beauty/four_view/measure.py` | `tests/test_phase21_v2_measure.py`, `tests/test_measure_2d_extensions.py`, `tests/test_mask_depth_stats.py`, `tests/test_measure_helpers.py` (also imports the report + overlay modules — split it) |
| `MeasurementSession`, `LineMeasurement`, `AngleMeasurement`, `CurveMeasurement`, `save_session` / `load_session` (atomic write) — extended per contract C3.6 | same file | same |
| History helpers: frozen-path resolution, unique ids, list query with count subquery, orphan finder, `delete_session` with counts, `Connection.backup()` | `src/camel_beauty/desktop/db.py`, `widgets/backup.py` | — (the parent History **page** is not a template: it has no reopen and its delete bypasses the cascade) |
| Overlay PNG: `render_session_overlay_figure`, `canonical_overlay_path` (operator-tuned label style: alpha 0.50 box, white stroke; ground line in red) | `src/camel_beauty/desktop/reporting/overlay_renderer.py` | `tests/test_measure_helpers.py`: `test_render_session_overlay_figure_metadata_counts`, `_empty_session`, `test_canonical_overlay_path_deterministic`, `test_overlay_figure_renders_curve_branch` |
| Candidate-walk precedent: cooperative cancel polled every frame, `pipe.stop()` in `finally`, MAF bounds, completeness margin, bucket thresholds, 1.5 s greedy guard | `src/camel_beauty/four_view/extractor.py` | `tests/test_phase21_v2_extractor.py` (stub-injected) |
| Report **content spec only** (sections: header/seal, session rows, measurements table, camel view, Mjaheem + Maghateer rubric, 27 regions, observations, Judge + Council wells, footer stamp) | `src/camel_beauty/desktop/reporting/templates/notebook_report_template.html` (1,745 lines; lines 1200–1203 are ≈ 2.9 MB of sample camel PNGs — drop them; the four Plex woff2 faces are ≈ 94 KB) | `tests/test_phase21_v2_report.py` shows the row assertions but does not collect (stale `measure_app` import) |
| SHA-256 PNG↔embed probe (pattern to restate for PDF) | `runs/html_iterations/export_cell_v3_replacement.py:393-409` (also `_patch_v4.py:568-578`, `COWORK.md` §6d) — an export-cell step, not library code | — |
| Arabic font / logos | `src/camel_beauty/desktop/assets/fonts/IBMPlexSansArabic-Regular.ttf` (236,708 B, OFL-1.1), `Nazeer/assets/logos/` | — |
| Judges' rubric | `docs/references/كتاب الابل.pdf` (+ `كتاب_الإبل_2.md`) | — |

Vendoring hazards (all verified): `overlay_renderer._ensure_locale_stack` runs
`pip install` at render time (lines 23–50) — delete it and pin `arabic-reshaper` (MIT) +
`python-bidi` (LGPL) + `pypdf` (BSD-3) in `requirements.txt`; the renderer imports
`format_distance` from `camel_beauty.four_view.measure` (line 112) — rewire;
`canonical_overlay_path` defaults to a CWD-relative path — make it absolute; add
`curve_3d`, KNN-marker and flag-chip branches. Do **not** vendor
`extractor._build_default_yolo_callable` (no `retina_masks`, nearest-resized low-res
mask — the exact path the model card rejects), the parent's `runs/`-relative output
paths, the 3D reconstruction, or anything PyQt.
