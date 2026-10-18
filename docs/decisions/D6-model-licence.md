# D6 — Model licence: Ultralytics AGPL-3.0

Status: open (named in `MODEL_CARD.md` §1 and §9) · one evaluation delivery to a client under the
operator's responsibility (2026-10-14, below) · one permanent-key delivery (release 1.1.0) under the
operator's responsibility (2026-10-18, below).

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

**Operator, 2026-10-14 — one delivery, not the licence decision:** the operator ships release 1.0.0
(the Windows installer, which carries Ultralytics and `best.pt` inside its engine) with one 7-day
trial key to one client as an evaluation, under the operator's own responsibility. Before building,
the operator was shown this record's rule below and chose among: an Enterprise licence in hand,
compliance with AGPL-3.0 (licence texts and a written source offer in the installer), recording
the decision as the operator's, or holding the delivery; the operator chose to record it as theirs.
The options above, the counsel pass and the training-photo provenance stay open. The release is
recorded in D11 ("Release 1.0.0").

**Operator, 2026-10-18 — a second delivery, not the licence decision:** the operator ships release
1.1.0 (the same installer posture: Ultralytics and `best.pt` inside its engine) with a **permanent**
licence key for one client, customer name `Nazeer_CEO_Ahmed`, under the operator's own
responsibility. Shown this record's rule and the same four choices (an Enterprise licence in hand,
compliance with AGPL-3.0, recording the decision as the operator's, holding the delivery), the
operator chose to record it as theirs. Unlike the evaluation, a permanent key does not end: the
delivery stays in the client's hands until the operator replaces it. The options above, the counsel
pass and the training-photo provenance stay open. The release is recorded in D11 ("Release 1.1.0").

## Consequences

- Until decided, nothing in nazeer-desktop may be distributed outside the team — except the
  evaluation delivery of 2026-10-14 and the permanent-key delivery of 2026-10-18 above, which the
  operator took on; any further delivery needs
  this record decided, or the operator's decision recorded here again.
- One counsel pass should cover Ultralytics (AGPL), python-bidi (LGPL — acceptable as an
  unmodified, replaceable module), IBM Plex (OFL-1.1 — bundling allowed; do not sell the
  font alone) and the training-photo provenance.
