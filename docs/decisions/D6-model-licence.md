# D6 — Model licence: Ultralytics AGPL-3.0

Status: open (named in `MODEL_CARD.md` §1 and §9).

## Context

The body segmenter is a YOLO11n-seg model fine-tuned with Ultralytics 8.4.47, so it
inherits AGPL-3.0. The engine will also depend on python-bidi (LGPL) for Arabic overlay
labels and bundle IBM Plex Sans Arabic (OFL-1.1). The licence and provenance of the 191
training photos are unknown (`MODEL_CARD.md` §4, §9). A closed-source commercial build is
the likely product posture but has not been stated.

## Options

1. Ultralytics Enterprise License — closed-source build allowed; cost and terms to be obtained.
2. Ship under AGPL-3.0 — the app's source must be offered to users; simplest legally, may
   conflict with the business model.
3. Replace the model with a permissively licensed segmenter and retrain — no Ultralytics
   dependency; a new training/validation campaign; the golden-frame oracle and the model
   card are redone.

## Decision

None yet.

## Consequences

- Until decided, nothing in nazeer-desktop may be distributed outside the team.
- One counsel pass should cover Ultralytics (AGPL), python-bidi (LGPL — acceptable as an
  unmodified, replaceable module), IBM Plex (OFL-1.1 — bundling allowed; do not sell the
  font alone) and the training-photo provenance.
