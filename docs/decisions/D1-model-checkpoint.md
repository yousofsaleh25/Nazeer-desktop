# D1 — Model checkpoint: `best.pt` vs `last.pt`

Status: proposed 2026-10-04 (model card), unchanged 2026-10-10 — `best.pt` recommended;
`engine/models/best.pt` already hashes to the pinned value. Not yet confirmed by the operator.

## Context

Body-seg v3 training run `20260507_163616_8ea83a9a` produced two checkpoints: `best.pt`
(epoch 72, chosen by mask mAP50-95) and `last.pt` (epoch 100). Both are 6,008,925 bytes,
YOLO11n-seg, one class `camel`, Ultralytics 8.4.47. The `.pt` files store `epoch = -1`; the
epoch numbers come from `metrics.json`. The engine loads a model only if its sha256 matches
the pin (`MODEL_CARD.md` §1, §8).

## Options

| | `best.pt` | `last.pt` |
|---|---|---|
| Validation mask mAP50-95 (39 images) | 0.895 | 0.879 |
| Golden-frame confidence | 0.959 | 0.965 |
| Golden-frame mask pixels / rows | 269,033 / 9–715 | 269,677 / 11–712 |
| CPU ms per frame (retina masks) | 46.0 (parent venv) · 46.9–47.6 (engine venv, 2026-10-10) | 47.6 · 47.2–49.8 |
| sha256 | `0e9ee2baada7c70531b66e0b98f7e1cf4dcf3ce7971c55bce69a7270ec3a4320` | `3e7a310a1eac2b55b077bd6978787dccee95a44f17a1a13ac29e9e01d46da484` |

5-fold cross-validation with the same hyperparameters gave mask mAP50-95 0.854 ± 0.020 —
the honest generalisation estimate for either file.

## Decision

Pin `best.pt` (higher validation mAP, same architecture, same speed), as the model card
recommends.

## Consequences

- Rename the file to `body_seg_v3_best.pt` and flip the status line at the top of
  `MODEL_CARD.md`; keep `last.pt` only until the decision is confirmed.
- The engine's load path checks the sha256 above and stops with a clear error on mismatch.
- Golden-frame tests use the `best.pt` row (±1 % mask pixels, ±0.01 confidence).
