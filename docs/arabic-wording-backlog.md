# Arabic wording review backlog

None of the app's Arabic strings has had a native-speaker wording review yet. The operator decided
on 2026-10-12 to batch that review at the end of Stage 6 or in the Stage 9 wrap-up, rather than
piecemeal. Until then, each stage logs the strings it adds here. Before this file existed (Stages
1–A), the list lived only in the stage reports; the counts below are taken from the files.

## Where the strings are

- `app/src/renderer/i18n/ar.json`: every renderer string. The English twin is `en.json`; a test keeps
  the two key sets equal and requires both labels for every engine error code.
- `app/src/main/dialogs.ts` and `app/src/main/windows.ts`: the few strings main owns (the window
  title, the file and folder dialogs, the "quit anyway?" dialog), Arabic first, then English.
- `app/build/installer.nsh`: the installer's Arabic strings that electron-builder lacks.
- Not in this list: the engine's own wording (`engine/nazeer_engine/labels.py`, served by
  `/meta/labels`, the report headings in `report_content.py` and, since report model 1.1, the
  printed frame-block, cross-check and count texts in `report_model.py`); the scoring-form heading,
  which is an open operator question (plan, "Still open"); and the installer's other Arabic text,
  which comes with NSIS (its Arabic language file) and electron-builder (4 messages), third-party
  wording a reviewer may still want to look at.

## Strings to review

| Stage | Keys in `ar.json` | Groups (keys) | Elsewhere |
|---|---|---|---|
| 1–3, committed in `df0a86a` | 421 | design 88, errors 66, measure 26, probe 23, bag 18, admin 16, history 15, job 14, candidates 11, approval 11, bagInfo 10, report 10, pdf 10, units 9, common 9, readout 9, zref 9, prefs 8, engine 8, save 8, candidate 8, session 8, jobStages 6, nav 5, indexStates 5, errorPanel 4, appErrors 3, app 2, ground 2 | — |
| 4 (engine supervisor and client) and A (licence keys), not committed yet | 77 | about 30, license 25, engine 13, appErrors 6, placeholder 2, design 1 | `main/dialogs.ts`: 10 strings (the dialogs' title, the file and folder pickers, the quit dialog); the window title in `main/windows.ts` |
| 5 (Redux store) | 0 | — | no screens yet; the store's errors reuse the existing `errors.*` / `appErrors.*` labels |
| B (installer) | 0 | — | `app/build/installer.nsh`: 22 installer messages electron-builder ships only in English (the "Only for me / Anyone who uses this computer" page, the uninstaller's choices, five common messages) and the language dialog's title and prompt (2026-10-12) |
| 6 (operator screens) | 132 added, 2 removed | measure 26 (incl. the drawing hints and the keyboard line), report 20, history 18, finalize 14, bag 12, conflict 10, job 7, save 7, session 7, unsaved 4, nav 2, candidates 2, notFound 2, design 1; removed: placeholder 2 | — (2026-10-12; `ar.json` then held 628 strings). «اعتماد» was used both for finalizing the session and for approving the engine's image: settled by the operator in Stage 7 (next row) |
| 7 (print page, export) | 33 added, 1 removed, 21 changed | appErrors 22 (the export's own codes), report 11 (printing and sealing); removed: report.printLater; **changed by the operator's decision of 2026-10-12:** finalizing a session is «إقفال» (إقفال الجلسة، جارٍ الإقفال…، أقفل الجلسة أولًا، الجلسة مُقفلة), approving the engine's image keeps «اعتماد» — 21 strings, plus the development gallery's «أعراف الصورة المعتمدة», which mistranslated "Overlay conventions" (now «اصطلاحات صورة المحرك») | `ar.json` holds 660 strings. Engine wording added for the printed report (report model 1.1, outside `ar.json`): the frame block's labels and texts, «مرفوض», the provenance labels, the cross-check, lines and counts lines (`engine/nazeer_engine/report_content.py`, `report_model.py`), and the `finalized` status label «مُقفلة» (`labels.py`) |

The `design` keys label the development-only gallery (`#/design`), which is not in the production
bundle; review them last.
