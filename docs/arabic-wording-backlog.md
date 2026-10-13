# Arabic wording review backlog

The operator decided on 2026-10-12 to batch the wording review of the app's Arabic strings at the
end of Stage 6 or in the Stage 9 wrap-up, rather than piecemeal; until then each stage logged the
strings it added here (before this file existed, Stages 1–A, the list lived only in the stage
reports; the counts below are taken from the files). **The batch pass ran in Stage 9 (2026-10-13):
see "Stage 9 batch pass" at the end.** It was a full read by Claude, not a native speaker's review:
the operator decides the items left open there.

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
  wording a reviewer may still want to look at. The installer's wording (NSIS's «تنصيب» beside this
  installer's «تثبيت», and «إختر» / «إضغط») is fixed with the next installer rebuild, not in this
  review (operator, 2026-10-13; D11).

## Strings to review

| Stage | Keys in `ar.json` | Groups (keys) | Elsewhere |
|---|---|---|---|
| 1–3, committed in `df0a86a` | 421 | design 88, errors 66, measure 26, probe 23, bag 18, admin 16, history 15, job 14, candidates 11, approval 11, bagInfo 10, report 10, pdf 10, units 9, common 9, readout 9, zref 9, prefs 8, engine 8, save 8, candidate 8, session 8, jobStages 6, nav 5, indexStates 5, errorPanel 4, appErrors 3, app 2, ground 2 | — |
| 4 (engine supervisor and client) and A (licence keys), not committed yet | 77 | about 30, license 25, engine 13, appErrors 6, placeholder 2, design 1 | `main/dialogs.ts`: 10 strings (the dialogs' title, the file and folder pickers, the quit dialog); the window title in `main/windows.ts` |
| 5 (Redux store) | 0 | — | no screens yet; the store's errors reuse the existing `errors.*` / `appErrors.*` labels |
| B (installer) | 0 | — | `app/build/installer.nsh`: 22 installer messages electron-builder ships only in English (the "Only for me / Anyone who uses this computer" page, the uninstaller's choices, five common messages) and the language dialog's title and prompt (2026-10-12) |
| 6 (operator screens) | 132 added, 2 removed | measure 26 (incl. the drawing hints and the keyboard line), report 20, history 18, finalize 14, bag 12, conflict 10, job 7, save 7, session 7, unsaved 4, nav 2, candidates 2, notFound 2, design 1; removed: placeholder 2 | — (2026-10-12; `ar.json` then held 628 strings). «اعتماد» was used both for finalizing the session and for approving the engine's image: settled by the operator in Stage 7 (next row) |
| 7 (print page, export) | 33 added, 1 removed, 21 changed | appErrors 22 (the export's own codes), report 11 (printing and sealing); removed: report.printLater; **changed by the operator's decision of 2026-10-12:** finalizing a session is «إقفال» (إقفال الجلسة، جارٍ الإقفال…، أقفل الجلسة أولًا، الجلسة مُقفلة), approving the engine's image keeps «اعتماد» — 21 strings, plus the development gallery's «أعراف الصورة المعتمدة», which mistranslated "Overlay conventions" (now «اصطلاحات صورة المحرك») | `ar.json` holds 660 strings. Engine wording added for the printed report (report model 1.1, outside `ar.json`): the frame block's labels and texts, «مرفوض», the provenance labels, the cross-check, lines and counts lines (`engine/nazeer_engine/report_content.py`, `report_model.py`), and the `finalized` status label «مُقفلة» (`labels.py`) |
| 8 (tests, end-to-end proof) | 1 added | errors 1: `stub_mask_needs_stub_model` «القناع التجريبي يتطلب النموذج التجريبي», the engine's refusal of its development-only `--stub-mask` switch without the stub model (never seen in production) | `ar.json` holds 661 strings |
| 9 (wrap-up: the batch pass, then the review's fixes) | 6 added, 11 changed | changed: the corrections listed in "Stage 9 batch pass" below; added afterwards by the review's fixes (D9 "Review and wrap-up"), so not part of the pass: job 2 (`busyElsewhere` «يبحث المحرك الآن في تسجيل آخر، ولا يعمل إلا بحث واحد في كل مرة:», `cancelOther` «إلغاء ذلك البحث»), report 1 (`saveBeforePrint` «احفظ تفاصيل التقرير قبل الطباعة»), license 1 (`continue` «متابعة»), appErrors 2 (`screen_failed` «تعذّر عرض هذه الشاشة», `print_font_unreadable` «تعذّرت قراءة ملف خط التقرير في المحرك») | `main/dialogs.ts`: 3 changed by the pass; 4 added by the fixes (the window that keeps failing: «توقفت نافذة التطبيق ولم تُستعد.», «كل ما حُفظ باقٍ لدى المحرك، وتضيع التعديلات التي لم تُحفظ بعد. التفاصيل في مجلد السجلات:», «إعادة المحاولة», «إنهاء»); `ar.json` holds 667 strings |

The `design` keys label the development-only gallery (`#/design`), which is not in the production
bundle; review them last.

## Stage 9 batch pass (2026-10-13)

Every string in `ar.json` (661, the 90 `design` keys included) and main's 10 strings
(`main/dialogs.ts`, `main/windows.ts`) was read against its English twin. Mechanical checks found
nothing: no Latin comma, semicolon or question mark next to an Arabic letter, no "...", no straight
quotes, no stray spaces, no hamza on a hamzat-al-wasl word, no «الى» for «إلى»; the two tatweels are
«بـ NZL1.» and «مرخّص لـ», the usual form before a Latin word or a blank. Most strings needed
nothing.

### Applied: grammar, spelling, and one concept written two ways

| Key | Was | Now | Why |
|---|---|---|---|
| `approval.imageAlt` | … للإطار المقاس | … للإطار المَقيس | «المقاس» is the noun (a size); the passive participle of قاس is «مَقيس» |
| `errors.text_probe_failed` | لم تُعثر على الأسماء في نص ملف PDF | لم يُعثر على الأسماء في نص ملف PDF | the impersonal passive of «عثر على» is masculine, as in `bag.noneFound` |
| `appErrors.engine_exited` | توقف المحرك أثناء التشغيل | توقف المحرك أثناء بدء تشغيله | it said "while running"; the code means the engine stopped before it was ready |
| `main/dialogs.ts` `unsavedDetail` | إن أغلقت الآن ستُفقد. | إن أغلقت الآن فستُفقد. | the answer of a condition that starts with سـ takes فـ |
| `main/dialogs.ts` `noAnswerDetail` | إن أغلقت الآن قد تُفقد آخر التعديلات. | إن أغلقت الآن فقد تُفقد آخر التعديلات. | the answer of a condition that starts with قد takes فـ |
| `candidates.noneHint` | … على بعد 1.5 م … | … على بُعد 1.5 م … | without the damma, «بعد» reads as "after" |
| `measure.hints.distance3d` | انقر الطرفين، وانقر مع Shift على نقطة في الأرض أو الخلفية. | انقر الطرفين. النقر مع Shift يحدد نقطة على الأرض أو في الخلفية. | «على الأرض», and the same sentence as the other Shift hints |
| `errors.candidate_not_found`, `errors.candidates_not_found`, `errors.invalid_candidate_ref`, `jobStages.persisting` | المرشح / المرشحة / مرشح | المقترح / المقترحة / مقترح | the operator sees «الإطارات المقترحة» everywhere else; the English twins now say "proposed frame…" too |
| `errors.arabic_stack_missing` | مكوّنات النص العربي غير متوفرة … | حزمة النص العربي غير متوفرة … | the engine banner and About call it «حزمة النص العربي» |
| `report.finalizeFirst` | … تأتي استمارة التقرير مع … | … تأتي تفاصيل التقرير مع … | «استمارة» is the scoring form (`report.variant`); the details are «تفاصيل التقرير» everywhere else; the English said "report form" and now says "report details" |
| `main/dialogs.ts` `pickFolderTitle` | اختر مجلد التسجيلات | اختر مجلد تسجيل | the app calls them «مجلدات التسجيل» |

### For the operator to decide: one word, two meanings

1. **«السجل»** means History (`nav.history`, `admin.index`, `admin.backup`, `admin.backups`,
   `admin.rebuild`, `errors.history_error`, `errors.backup_failed`) and, in the plural, the log files
   (`engine.openLogs` «فتح مجلد السجلات», `about.logFolder`, `engine.fatalHint`, shown when the
   engine fails, and `main/dialogs.ts` `rendererLostDetail`, the Stage 9 dialog for a window that
   keeps failing); «مجلد السجلات» also reads close to «مجلدات التسجيل» (`bag.captureFolders`).
   Options: (a) keep; (b) logs become «سجلات التشغيل» (4 strings), History keeps «السجل»;
   (c) History becomes «الجلسات المحفوظة», the History page's title already (7 strings).
   Recommended: (b), the smallest change, on the screens where it matters least.
2. **«نموذج»** means the detection model (`about.model`, `about.modelFile`, `errors.model_*`,
   `engine.waitStarting`) and the report model, the engine's report data (`report.loadingModel`,
   `report.modelFailed`, `report.modelUnreadable`, `report.modelVersion`, `report.modelOutdated`,
   `report.modelOutdatedHint`, `report.finalizeFirst`, `errors.report_model_sha_required`,
   `appErrors.report_model_hash_mismatch`, `appErrors.report_model_outdated`,
   `appErrors.report_model_unreadable`); «نموذج التقرير» can also read as "report template".
   English uses "model" for both too. Options: (a) keep; (b) «بيانات التقرير» for the report model
   in Arabic (11 strings), English unchanged ("report model" is the contract's name); (c) the same
   with "report data" in English. Recommended: (b). The printed report's provenance row
   «نموذج التقرير» is engine wording (below).
3. **«رُفض» / «مرفوض»** means a measurement the engine could not compute (`measure.rejected`,
   `measure.rejectedCount`, `history.rejected`, `finalize.rejectedWarning`; also on the printed
   report) and a PDF the seal refused (`probe.drift` «رُفض ملف PDF», `probe.keptAs`); English
   separates "rejected" and "refused". Options: (a) keep, since the PDF strings name their object;
   (b) the PDF strings become «لم يُقبل ملف PDF» and «حُفظ الملف غير المقبول باسم». Recommended: (a).
4. **«تجريبي»** means the trial licence (`license.kinds.trial`, `license.storedExpired`) and the stub
   model (`engine.stubModel`, `engine.bannerStubModel`, `about.stub`, `errors.stub_model_not_allowed`,
   `errors.stub_mask_needs_stub_model`). The stub strings only appear in development builds, so an
   operator never sees both. Options: (a) keep; (b) the stub strings take another word, e.g.
   «نموذج بديل». Recommended: (a).

### Suggestions: style, apply any you choose

| Key | Now | Suggested | Why |
|---|---|---|---|
| `common.copied` | نُسخ | تم النسخ | without diacritics «نسخ» also reads as "copies" |
| `job.stop` | إيقاف والاحتفاظ | إيقاف مع الاحتفاظ بالنتائج | two bare nouns joined by و read unfinished |
| `bag.scan` | بحث | بحث في المجلدات | the same screen also has «البحث عن أفضل الإطارات» |
| `measure.hints.horizontal` | … زاوية الخط بينهما عن الأفقي. | … زاوية ميل الخط بينهما عن الأفقي. | «عن الأفقي» needs «ميل» |
| `zref.robustMad` | الانحراف المطلق الوسيط (MAD) | وسيط الانحراف المطلق (MAD) | the median of the absolute deviations |
| `report.judge` | الحكم | الحَكَم | without the fatha it reads as «الحُكم», the ruling |
| `report.council` | مجلس الحكام | لجنة التحكيم | the usual name in camel-beauty contests; without the shadda «الحكام» reads as "rulers"; the printed signature well says «امضاء مجلس الحكام» (engine) |
| `report.printExplain` | يُصفّ التقرير … ويُطبع ملف PDF | يُنسَّق التقرير … ويُطبع في ملف PDF | «يُصفّ» is rare in this sense |
| `about.nativeLayout` | تشكيل النص الأصلي (libraqm) | تشكيل النص المدمج (libraqm) | «الأصلي» reads as "the original text" |
| `about.electron` | إطار Electron | Electron | «إطار» is the camera frame everywhere else |
| `finalize.camelIdMissing` | أدخل معرّف الجمل: إنه مطلوب للإقفال. | أدخل معرّف الجمل، فهو مطلوب للإقفال. | «إنه» after a colon is a calque of "it is" |
| `engine.status.starting`, `engine.status.stopping` | المحرك يبدأ التشغيل / المحرك يتوقف | جارٍ تشغيل المحرك / جارٍ إيقاف المحرك | as `engine.waitStarting` and `engine.waitStopping` say |

### Outside this list: engine wording on the printed report (an engine edit, so it waits for approval)

- `report_content.py` `SIGNATURE_WELLS`: «امضاء الحكم», «امضاء مجلس الحكام» are misspelled (the
  masdar of أمضى takes a hamza). Options: (a) «إمضاء الحكم», «إمضاء مجلس الحكام»; (b) «توقيع الحكم»,
  «توقيع مجلس الحكام», the word of the page's heading «التوقيعات». The council's name follows the
  `report.council` suggestion («لجنة التحكيم» would give «توقيع لجنة التحكيم»). Recommended: (b).
- `report_content.py` `FRAME_ROWS["candidate"]`: «الإطار المرشح» → «الإطار المقترح» (English
  "Candidate frame" → "Proposed frame"), as in the app.
- `report_content.py` `SESSION_ROWS["operator"]`: «المستخدم» → «المشغّل», the app's word for the same
  field (`session.operator`, History's search).
- `report_content.py` `PROVENANCE_ROWS["report_model"]`: «نموذج التقرير» → «بيانات التقرير», only if
  decision 2 is (b) or (c).
- The edit changes values only (no key, field or schema; `REPORT_MODEL_VERSION` stays 1.1, the
  print page checks fields, not wording; `openapi.json` unchanged, the report model is a free
  object there); no engine or app test asserts these strings. Report models written after it
  (finalize, a report-details change) carry the new wording; PDFs already sealed keep theirs.
  Process: explained first, then pytest, ruff check and format, `--dump-openapi` (no diff
  expected), plus `tools/real_run.py` on bag 006 and the app's real flow; D7 and this file record it.
