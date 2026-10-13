# Decision records — Nazeer Desktop

Numbering continues the series started in `../../engine/models/MODEL_CARD.md`, which names
only D1 and D6. This directory was empty until 2026-10-10; D1–D10 were drafted in the
`/init` pass from the model card, the operator's decisions of 2026-10-10 and two read-only
research passes (an 8-agent audit / judge panel / fact-check and a 3-skeptic contract
review). Record a decision here before coding against it. Shape: MADR-lite
(Status · Context · Options · Decision · Consequences).

| ID | Title | Status (2026-10-10) | File |
|---|---|---|---|
| D1 | Model checkpoint: `best.pt` vs `last.pt` | proposed — `best.pt` recommended; `engine/models/best.pt` hashes to the pin | `D1-model-checkpoint.md` |
| D2 | (unrecorded) | unrecorded — implied by the numbering gap | `D2.md` |
| D3 | (unrecorded) | unrecorded | `D3.md` |
| D4 | (unrecorded) | unrecorded | `D4.md` |
| D5 | (unrecorded) | unrecorded | `D5.md` |
| D6 | Model licence: Ultralytics AGPL-3.0 | open | `D6-model-licence.md` |
| D7 | Judging report is a PDF produced by Electron printToPDF | accepted 2026-10-13 (operator) · engine half implemented 2026-10-11 (headless Edge); Electron side implemented and integration-tested 2026-10-12 (Stage 7: the UI on bag 006 with the real model, strict probes PASS) · still open, none blocking: signatures, one PDF per language, PDF/A, the scoring-form heading | `D7-report-pdf-route.md` |
| D8 | Measurement types and depth provenance (KNN fallback) | accepted (types) · proposed, reviewed (contract C1) · implemented 2026-10-11 | `D8-measurement-types-and-depth.md` |
| D9 | App stack: Electron + Vite + React + TypeScript + Tailwind CSS | accepted · implemented in Stages 1–9 (2026-10-11 to 2026-10-13) · integration-tested through the UI on bag 006 with the real model (Stage 8) · reviewed in Stage 9 | `D9-app-stack.md` |
| D10 | Frame candidates, session, history and export flow | accepted (flow) · proposed, reviewed (contracts C2/C3) · implemented 2026-10-11 with **C2.4 revised on real bags — operator to confirm** | `D10-frame-candidates-and-session-flow.md` |
| D11 | Offline licence keys (Ed25519) and the Windows installer (NSIS + embedded CPython engine) | accepted 2026-10-12 (operator; an addition outside the 9-stage plan) · licence keys implemented in Stage A, installer in Stage B; the clean-PC check as a Windows Sandbox tool (2026-10-12) passed every checklist item on 2026-10-13, with two findings (the install-mode page's controls not mirrored; the uninstaller in English), fixed with the installer's Arabic wording in the next installer rebuild (operator) | `D11-licensing-and-installer.md` |

Assumptions taken in this pass that the operator has not yet confirmed are marked in the
status lines of the records (angles kept, wet-ink signatures, KNN as an
eroded-mask median of 9, the Shift-click ground modifier, the extra candidate gates,
schema 2.1). The engine implementation (2026-10-11) added one change that needs the
operator: the C2.4 completeness gate (D10 "Engine parameters"). The PDF route (D7) was accepted by
the operator on 2026-10-13.
