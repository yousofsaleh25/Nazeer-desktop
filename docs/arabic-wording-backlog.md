# Arabic wording review backlog

The operator decided on 2026-10-12 to batch the wording review of the app's Arabic strings at the
end of Stage 6 or in the Stage 9 wrap-up, rather than piecemeal; until then each stage logged the
strings it added here (before this file existed, Stages 1–A, the list lived only in the stage
reports; the counts below are taken from the files). **The batch pass ran in Stage 9 (2026-10-13):
see "Stage 9 batch pass".** It was a full read by Claude, not a native speaker's review: the
operator decides the items left open there. **The operator decided them for release 1.0.0
(2026-10-14): see "Release 1.0.0" at the end;** the 12 style suggestions stay open.

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
  installer's «تثبيت», and «إختر» / «إضغط») was left to the next installer rebuild (operator,
  2026-10-13; D11): release 1.0.0 replaced NSIS's strings on every page the installer and the
  uninstaller show ("Release 1.0.0" below).

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
| Release 1.0.0 (the operator's decisions, 2026-10-14) | 14 changed | decision 1 (b): 3 log strings; decision 2 (b): 11 report-model strings ("Release 1.0.0" below) | `main/dialogs.ts`: 1 changed (`rendererLostDetail`); `build/installer.nsh`: 33 of NSIS's Arabic strings replaced; the engine's printed wording: 5 values; `ar.json` still holds 667 strings |
| 9 (wrap-up: the batch pass, then the review's fixes) | 6 added, 11 changed | changed: the corrections listed in "Stage 9 batch pass" below; added afterwards by the review's fixes (D9 "Review and wrap-up"), so not part of the pass: job 2 (`busyElsewhere` «يبحث المحرك الآن في تسجيل آخر، ولا يعمل إلا بحث واحد في كل مرة:», `cancelOther` «إلغاء ذلك البحث»), report 1 (`saveBeforePrint` «احفظ تفاصيل التقرير قبل الطباعة»), license 1 (`continue` «متابعة»), appErrors 2 (`screen_failed` «تعذّر عرض هذه الشاشة», `print_font_unreadable` «تعذّرت قراءة ملف خط التقرير في المحرك») | `main/dialogs.ts`: 3 changed by the pass; 4 added by the fixes (the window that keeps failing: «توقفت نافذة التطبيق ولم تُستعد.», «كل ما حُفظ باقٍ لدى المحرك، وتضيع التعديلات التي لم تُحفظ بعد. التفاصيل في مجلد السجلات:», «إعادة المحاولة», «إنهاء»); `ar.json` holds 667 strings |
| D12 Stage 1 ("Save as", 2026-10-17) | 20 added | report 11 (the operator's wording, "D12: Save as" below), appErrors 9 (`save_as_*`, main's own codes) | `main/dialogs.ts`: 14 strings (the Save dialog's title and file type, the Replace question, the data-folder refusal, the three write failures and their buttons); `ar.json` holds 687 strings |
| D12 Stage 2 (the comparison engine, 2026-10-17) | 11 added | errors 11: the engine's new `comparison_*` codes ("D12: the comparison engine" below) | the engine's labels (`labels.py`): 3 groups, 16 strings; the comparison page's wording (`report_content.py`, `comparison_model.py`): 23 strings, 4 of them reused from the single report; `ar.json` holds 698 strings |
| D12 Stage 3 (the comparison seal, 2026-10-17) | 4 added | errors 4: `comparison_stale`, `comparison_model_mismatch`, `comparison_model_sha_required`, `overlay_out_of_place` ("D12: the comparison seal" below) | no engine wording; `ar.json` holds 702 strings |
| D12 Stage 4 (History selection, the Compare dialog, the Comparisons tab, 2026-10-17) | 69 added | compare 23, comparisons 20 (incl. 4 orders), comparison 17, history 9 ("D12: the comparison screens" below) | no engine wording; `ar.json` holds 771 strings; **one word for the operator: «ترتيب»** (below) |
| D12 Stage 5 (the comparison's print, 2026-10-17) | 19 added | comparison 11, probe 2, appErrors 6 ("D12: the comparison's print" below) | no engine wording; `ar.json` holds 790 strings; «ترتيب» avoided in the new strings (still open, Stage 4) |

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

Decided on 2026-10-14 for release 1.0.0: 1 (b), 2 (b), 3 (a), 4 (a), as recommended; applied as
listed under "Release 1.0.0".

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

Approved and applied on 2026-10-14 for release 1.0.0, with (b) for the signature wells and the
council's name unchanged (the `report.council` suggestion stays open): see "Release 1.0.0".

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

## Release 1.0.0 (2026-10-14)

The operator's decisions before the first client release: decisions 1 (b), 2 (b), 3 (a), 4 (a),
the engine's printed wording, and «تثبيت» as the installer's one word for install. The 12 style
suggestions stay open.

### The app (`ar.json`, `main/dialogs.ts`; English unchanged)

| Decision | Keys | Was | Now |
|---|---|---|---|
| 1 (b) | `engine.openLogs` | فتح مجلد السجلات | فتح مجلد سجلات التشغيل |
| 1 (b) | `about.logFolder` | مجلد السجلات | مجلد سجلات التشغيل |
| 1 (b) | `engine.fatalHint`, `main/dialogs.ts` `rendererLostDetail` | … في مجلد السجلات | … في مجلد سجلات التشغيل |
| 2 (b) | `report.loadingModel`, `report.modelFailed`, `report.modelVersion`, `report.modelOutdated`, `errors.report_model_sha_required`, `appErrors.report_model_outdated`, `appErrors.report_model_unreadable` | نموذج التقرير / نموذج تقرير | بيانات التقرير / بيانات تقرير |
| 2 (b) | `report.finalizeFirst` | … مع نموذج التقرير الذي يكتبه المحرك … | … مع بيانات التقرير التي يكتبها المحرك … |
| 2 (b) | `report.modelUnreadable` | نموذج التقرير ليس بالشكل المتوقع | بيانات التقرير ليست بالشكل المتوقع |
| 2 (b) | `report.modelOutdatedHint` | … نموذج التقرير الحالي … | … بيانات التقرير الحالية … |
| 2 (b) | `appErrors.report_model_hash_mismatch` | نموذج التقرير لا يطابق بصمة المحرك | بيانات التقرير لا تطابق بصمة المحرك |

«بيانات» is a feminine plural, so the words that agree with it changed too (التي يكتبها، ليست،
الحالية، لا تطابق).

### The printed report (`engine/nazeer_engine/report_content.py`, D7 "Printed wording")

| Row | Was | Now |
|---|---|---|
| `SIGNATURE_WELLS` judge | امضاء الحكم | توقيع الحكم |
| `SIGNATURE_WELLS` council | امضاء مجلس الحكام | توقيع مجلس الحكام |
| `FRAME_ROWS["candidate"]` | الإطار المرشح / Candidate frame | الإطار المقترح / Proposed frame |
| `SESSION_ROWS["operator"]` | المستخدم | المشغّل |
| `PROVENANCE_ROWS["report_model"]` | نموذج التقرير | بيانات التقرير (English "Report model" kept) |

### The installer (`build/installer.nsh`)

One word for install, «تثبيت», and «إلغاء التثبيت» for uninstall, on every page the installer and
the uninstaller show: 33 of NSIS's own Arabic strings are replaced (12 built-in strings from its
`Arabic.nlf`, 21 page strings from MUI2's `Arabic.nsh`; the 22 strings this file already gave
electron-builder's pages are unchanged). The same strings drop the hamza NSIS writes on hamzat
al-wasl («اختر», «اضغط», «الانتظار», «انتهى»). NSIS's own texts are otherwise kept, «عرض» for the
Browse button included; electron-builder's four Arabic messages already said «التثبيت».

| String | NSIS's Arabic | Now |
|---|---|---|
| `^SetupCaption` (the installer's title) | تنصيب Nazeer Desktop | تثبيت Nazeer Desktop |
| `^UninstallCaption` (the uninstaller's title) | إزالة Nazeer Desktop | إلغاء تثبيت Nazeer Desktop |
| `^InstallBtn`, `^UninstallBtn` | تنصيب / إزالة | تثبيت / إلغاء التثبيت |
| `^ClickNext` | إضغط على التالي للمتابعة. | اضغط على التالي للمتابعة. |
| `^ClickInstall` | إضغط على تنصيب لتشغيل التنصيب. | اضغط على تثبيت لبدء التثبيت. |
| `^ClickUninstall` | إضغط على إزالة لتشغيل الإزالة. | اضغط على إلغاء التثبيت للبدء. |
| `^DirText` (the folder page) | سيتم تنصيب … في المجلد التالي. للتنصيب في مجلد آخر، إضغط عرض وإختر مجلد آخر. | سيتم تثبيت … في المجلد التالي. للتثبيت في مجلد آخر، اضغط على عرض واختر مجلدًا آخر. |
| `^DirBrowseText` | إختر المجلد لتنصيب … فيه: | اختر المجلد لتثبيت … فيه: |
| `^Completed` | إنتهى | انتهى |
| `^FileError`, `^FileError_NoIgnore` (a file that cannot be written) | … إضغط إلغاء لإلغاء التنصيب … | … اضغط على إلغاء لإيقاف التثبيت … |
| `MUI_TEXT_DIRECTORY_TITLE` / `_SUBTITLE` | إختر موقع التنصيب / إختر المجلد المراد تنصيب … فيه. | اختر موقع التثبيت / اختر المجلد المراد تثبيت … فيه. |
| `MUI_TEXT_INSTALLING_TITLE` / `_SUBTITLE` | تنصيب / الرجاء الإنتظار أثناء تنصيب … | جارٍ التثبيت / الرجاء الانتظار أثناء تثبيت … |
| `MUI_TEXT_FINISH_TITLE` / `_SUBTITLE` | إنتهى التنصيب / إنتهت عملية التنصيب بنجاح. | انتهى التثبيت / انتهت عملية التثبيت بنجاح. |
| `MUI_TEXT_ABORT_TITLE` / `_SUBTITLE` | إلغاء التنصيب / لم ينتهي التنصيب بنجاح. | توقف التثبيت / لم ينتهِ التثبيت بنجاح. («إلغاء التثبيت» now means uninstall) |
| `MUI_TEXT_FINISH_INFO_TEXT` / `_REBOOT` | لقد تم تنصيب … إضغط إنهاء … / … لإنهاء تنصيب … | لقد تم تثبيت … اضغط على إنهاء … / … لإنهاء تثبيت … |
| `MUI_UNTEXT_WELCOME_INFO_TITLE` / `_TEXT` | مرحبا بك في مرشد إزالة … / … أثناء إزالة … قبل البدء بالإزالة … | مرحبًا بك في مرشد إلغاء تثبيت … / … أثناء إلغاء تثبيت … قبل البدء بإلغاء التثبيت … |
| `MUI_UNTEXT_UNINSTALLING_TITLE` / `_SUBTITLE` | إزالة / الرجاء الإنتظار أثناء إزالة … | جارٍ إلغاء التثبيت / الرجاء الانتظار أثناء إلغاء تثبيت … |
| `MUI_UNTEXT_FINISH_TITLE` / `_SUBTITLE` | إنتهى / إنتهت عملية الإزالة بنجاح. | انتهى إلغاء التثبيت / انتهت عملية إلغاء التثبيت بنجاح. |
| `MUI_UNTEXT_ABORT_TITLE` / `_SUBTITLE` | إلغاء الإزالة / لم تنتهي الإزالة بنجاح. | توقف إلغاء التثبيت / لم ينتهِ إلغاء التثبيت بنجاح. |
| `MUI_UNTEXT_FINISH_INFO_TITLE` / `_TEXT` / `_REBOOT` | إنهاء مرشد إزالة … / لقد تم إزالة … إضغط إنهاء … / … لإنهاء إزالة … | إنهاء مرشد إلغاء تثبيت … / لقد تم إلغاء تثبيت … اضغط على إنهاء … / … لإنهاء إلغاء تثبيت … |

Left for a reviewer, not changed: NSIS's «عرض...» for Browse (Windows says «استعراض»), electron-builder's
Arabic messages (one reads «لقد فشل إلغاء التثبيت ملفات التطبيق»), and «أيّ تثبيت تريد إزالته؟» on the
uninstaller's install-mode page, where «إزالة» names removing one of two installs.

## D12: "Save as" (2026-10-17)

«حفظ» already meant saving to the engine (autosave, the report details), and «نسخة» already names a
version (the conflict dialog), the backup and the development build. The operator chose the
wording for saving a copy of a sealed PDF (D12, Q3): «نسخة» says it is a copy, the sealed original
staying in the app.

### The operator's decision (`ar.json`, `report.*`)

| Key | Arabic | English |
|---|---|---|
| `report.saveAs` | حفظ نسخة PDF باسم… | Save PDF as… |
| `report.notSavedToFile` | لم تُحفظ نسخة منه في ملف بعد | Not saved to a file yet |
| `report.savedTo` | حُفظت نسخة في: | Saved to: |
| `report.openFile` | فتح الملف | Open file |
| `report.showInFolder` | إظهار في المجلد | Show in folder |

### Added with them, to review in the next batch

| Key | Arabic | English |
|---|---|---|
| `report.savingCopy` | جارٍ حفظ النسخة… | Saving the copy… |
| `report.copyMissing`, `appErrors.save_as_copy_missing` | لم تعد النسخة المحفوظة في مكانها | The saved copy is no longer there |
| `report.copyChanged` | تغيّرت النسخة المحفوظة بعد حفظها | The saved copy changed after it was saved |
| `report.copyNotRecorded` | حُفظت النسخة، لكن تعذّر تذكّر مكانها | The copy was saved, but its place could not be remembered |
| `report.saveCopyFailed` | تعذّر حفظ نسخة PDF | The PDF copy could not be saved |
| `report.openCopyFailed` | تعذّر فتح النسخة المحفوظة | The saved copy could not be opened |
| `appErrors.save_as_busy` | نافذة حفظ نسخة أخرى مفتوحة | Another Save dialog is open |
| `appErrors.save_as_no_report` | لا يوجد تقرير مختوم لهذه الجلسة | This session has no sealed report |
| `appErrors.save_as_report_changed` | تغيّر التقرير المختوم: اعرضه من جديد ثم احفظ نسخة منه | The sealed report changed: show it again, then save a copy |
| `appErrors.save_as_report_mismatch` | التقرير المختوم لا يطابق بصمته لدى المحرك | The sealed report does not match the engine's fingerprint |
| `appErrors.save_as_write_failed` | تعذّرت كتابة النسخة | The copy could not be written |
| `appErrors.save_as_copy_mismatch` | النسخة المكتوبة لا تطابق التقرير المختوم، فحُذفت | The written copy did not match the sealed report and was removed |
| `appErrors.save_as_no_copy` | لا توجد نسخة محفوظة مسجّلة لهذا التقرير | No saved copy of this report is recorded |
| `appErrors.save_as_open_failed` | تعذّر فتح النسخة | The copy could not be opened |

### Main's dialogs (`main/dialogs.ts`, Arabic line first)

| String | Arabic |
|---|---|
| `saveCopyTitle` (the Save dialog's title) | حفظ نسخة PDF باسم |
| `pdfFilter` (its file type) | مستند PDF |
| `replaceMessage`, `replaceDetail`, `replace` | يوجد ملف بهذا الاسم. / هل تستبدله بالنسخة الجديدة؟ / استبدال |
| `dataRootMessage`, `dataRootDetail`, `chooseAnother` | لا تُحفظ النسخة في مجلد بيانات التطبيق. / يحتفظ المحرك بهذا المجلد لنفسه. اختر مجلدًا آخر. / اختيار مكان آخر |
| `writeBusyMessage`, `writeBusyDetail` | الملف مفتوح في برنامج آخر. / أغلقه ثم أعد المحاولة، أو احفظ النسخة في مكان آخر. |
| `writeDeniedMessage`, `writeDeniedDetail` | تعذّرت الكتابة في هذا المكان. / قد يكون الملف مفتوحًا في برنامج آخر، أو المجلد للقراءة فقط، أو تحجزه خدمة مزامنة سحابية. |
| `writeOtherMessage` | تعذّرت كتابة النسخة. |
| `saveElsewhere` | حفظ النسخة في مكان آخر… |

The existing «إعادة المحاولة» (Try again) and «إلغاء» (Cancel) are reused.

## D12: the comparison engine (Stage 2, 2026-10-17)

The engine's words for comparisons. A comparison is «مقارنة» (the plan's file name «مقارنة_<n>_<date>.pdf»);
finalizing stays «إقفال» and sealing «ختم», as for a session. The judge and council keep the single
report's «الحكم» / «مجلس الحكام» (their open style suggestions above apply here too).

### A word for the operator to decide: «مراجعة»

«مراجعة» already carries two meanings: the session's **revision** number (`errors.invalid_revision`
«رقم مراجعة غير صالح») and the final **review** of the PDF (`report.printExplain` «… للمراجعة
النهائية», `design.d.pdf` (the development gallery) «عارض ملف PDF للمراجعة النهائية»). The comparison's per-camel provenance line
prints the revision: «<session id> · رقم المراجعة 9» (`comparison_model.member_block`), matching
`errors.invalid_revision` for now. Options:

| Option | Revision | Review |
|---|---|---|
| A (as now) | رقم المراجعة 9 | المراجعة النهائية |
| B | رقم التعديل 9 | المراجعة النهائية |
| C | رقم المراجعة 9 | التدقيق النهائي |

### The engine's labels (`labels.py`, `/meta/labels`)

| Group, code | Arabic | English |
|---|---|---|
| `comparison_ineligible.not_finalized` | لم تُقفل بعد: أقفلها أولًا | not finalized yet: finalize it first |
| `comparison_ineligible.reopened` | أُعيد فتحها بعد الإقفال: أقفلها من جديد | reopened after finalizing: finalize it again |
| `comparison_ineligible.model_outdated` | بيانات تقريرها من إصدار أقدم: أعد فتحها ثم أقفلها | its report data is from an older version: reopen and finalize it |
| `comparison_ineligible.files_missing` | ملفات الجلسة مفقودة | the session's files are missing |
| `comparison_ineligible.file_corrupt` | ملف الجلسة تالف | the session file is damaged |
| `comparison_ineligible.files_changed` | تغيّرت ملفات الجلسة بعد إقفالها | the session's files changed after it was finalized |
| `comparison_ineligible.delete_failed` | لم يكتمل حذفها | its deletion did not complete |
| `comparison_stale.member_deleted` | حُذفت جلسة هذا الجمل | this camel's session was deleted |
| `comparison_stale.member_unreadable` | تعذّرت قراءة جلسة هذا الجمل | this camel's session could not be read |
| `comparison_stale.member_reopened` | أُعيد فتح جلسة هذا الجمل | this camel's session was reopened |
| `comparison_stale.member_edited` | تغيّرت قياسات هذا الجمل أو بياناته | this camel's measurements or details changed |
| `comparison_stale.member_refinalized` | أُقفلت جلسة هذا الجمل من جديد بصورة أخرى | this camel's session was finalized again with a new image |
| `comparison_stale.member_session_changed` (a note) | تغيّر ملف الجلسة دون أن تتغيّر قياساتها | the session file changed; its measurements did not |
| `comparison_statuses.created` | لم تُختم بعد | not sealed yet |
| `comparison_statuses.sealed` | مختومة | sealed |

### The comparison page's wording (`report_content.py`, `comparison_model.py`; printed in Stage 5)

| Where | Arabic | English |
|---|---|---|
| `COMPARISON_TITLE` (when the operator gives no title) | مقارنة قياسات الإبل | Camel Measurement Comparison |
| `COMPARISON_DISCLAIMERS[1]` | تظهر الإبل بالترتيب الذي اختاره المشغّل، وتُعرض القيم جنبًا إلى جنب دون ترتيب أو مفاضلة. | The camels appear in the order the operator chose; the values are shown side by side, not ranked. |
| `COMPARISON_DISCLAIMERS[2]` | يُطابَق القياس بين الإبل بالاسم كما كُتب وبنوع القياس، ولا يُجمع قياس ثنائي الأبعاد مع ثلاثي الأبعاد. | Measurements are matched across camels by their name as written and by their kind; a 2D measurement never shares a row with a 3D one. |
| headings `cover`, `members`, `table`, `member`, `member_provenance` | بيانات المقارنة · الإبل في هذه المقارنة · جدول المقارنة · الجمل · مصدر بيانات هذا الجمل | Comparison details · Camels in this comparison · Comparison table · Camel · This camel's sources |
| columns `position`, `status` | # · الحالة | # · Status |
| cover rows `title`, `judge`, `council`, `created`, `n_camels`, `comparison_id` | العنوان · الحكم · مجلس الحكام · تاريخ الإنشاء · عدد الإبل · معرّف المقارنة | Title · Judge · Council of Judges · Created · Camels · Comparison ID |
| provenance row `comparison_model` | بيانات المقارنة | Comparison model |
| `UNNAMED` (+ the measurement number) | قياس بلا اسم #4 | Unnamed measurement #4 |
| a member's heading | الجمل #1: A001 | Camel #1: A001 |
| a member's provenance line | <session id> · رقم المراجعة 9 | <session id> · revision 9 |

Reused from the single report: the first disclaimer, «معرّف الجمل», «المعرّف», «المصدر», «الفعالية», the
measurement table's columns, the frame rows, «مرفوض», the signature wells and fields.

### Error labels (`ar.json`, `errors.*`)

| Key | Arabic | English |
|---|---|---|
| `errors.comparison_assets_changed` | تغيّرت ملفات المقارنة على القرص | The comparison's files changed on disk |
| `errors.comparison_busy` | المقارنة مشغولة: حاول مجددًا | The comparison is busy: try again |
| `errors.comparison_duplicate_members` | اختيرت الجلسة نفسها مرتين | The same session was picked twice |
| `errors.comparison_id_collision` | تعذّر تخصيص معرّف للمقارنة | A comparison ID could not be allocated |
| `errors.comparison_member_model_outdated` | بيانات تقرير أحد الإبل المختارة من إصدار أقدم | A chosen camel's report data is from an older version |
| `errors.comparison_member_not_final` | جلسة أحد الإبل المختارة لم تُقفل | A chosen camel's session is not finalized |
| `errors.comparison_member_not_found` | جلسة أحد الإبل المختارة غير موجودة | A chosen camel's session was not found |
| `errors.comparison_member_unavailable` | تعذّرت قراءة جلسة أحد الإبل المختارة | A chosen camel's session cannot be read |
| `errors.comparison_no_members` | اختر جملًا واحدًا على الأقل للمقارنة | Pick at least one camel to compare |
| `errors.comparison_not_found` | المقارنة غير موجودة | Comparison not found |
| `errors.comparison_too_many_members` | عدد الإبل أكبر مما تتسع له مقارنة واحدة | More camels than one comparison holds |

## D12: the comparison seal (Stage 3, 2026-10-17)

Four error labels for the engine's new seal codes (`ar.json` / `en.json`, `errors.*`). «أنشئ مقارنة
جديدة» stands for the "Compare again" action of Stage 4; when that button gets its Arabic wording,
this label should use the same verb.

| Key | Arabic | English |
|---|---|---|
| `errors.comparison_stale` | تغيّرت جلسة أحد الإبل بعد إنشاء المقارنة: أنشئ مقارنة جديدة | A camel's session changed after the comparison was made: compare again |
| `errors.comparison_model_mismatch` | تغيّر غلاف المقارنة أو لغتها بعد الطباعة: أعد الطباعة | The comparison's cover or language changed after printing: print again |
| `errors.comparison_model_sha_required` | بصمة بيانات المقارنة مفقودة | The comparison model fingerprint is missing |
| `errors.overlay_out_of_place` | صورة أحد الإبل في غير موضعها من ملف PDF | A camel's image is out of place in the PDF |

## D12: the comparison screens (Stage 4, 2026-10-17)

The History tabs, the selection column and its bar, the Compare dialog (order, approval, cover), the
Comparisons tab and the comparison screen. The fields "Event", "Judge", "Council of judges", the
language and its options, "Approved", "Delete", "Open" and the pages reuse existing keys
(`report.*`, `approval.*`, `history.*`). Labels of the engine's codes (why a camel cannot join,
why a comparison is out of date, its status) come from `/meta/labels`, as before.

- **"Compare again"** is «إنشاء مقارنة جديدة», the verb of `errors.comparison_stale` «… أنشئ مقارنة
  جديدة» (Stage 3), as that row asked.
- **"Out of date"** for a comparison is «قديمة», as History's «المخرجات قديمة» / «التقرير قديم».
- **«نسخة» avoided:** the cover hint says «بيانات مقارنة جديدة» for a new comparison model version, since
  «نسخة» is the saved copy of "Save as" (Q3) and already a version elsewhere (fact 9).

### A word for the operator to decide: «ترتيب»

«ترتيب» can mean the **order** the operator chose (the print order) and a **ranking** of camels,
which the comparison must never imply (D12 F2.4). Where it stands now:

- the engine's printed disclaimer (Stage 2, `report_content.py`, printed on every comparison):
  «تظهر الإبل بالترتيب الذي اختاره المشغّل، وتُعرض القيم جنبًا إلى جنب دون ترتيب أو مفاضلة.» — the
  word carries **both** meanings in one sentence;
- the app (Stage 4): «ترتيب الطباعة» (`compare.order`), «اسحب لتغيير الترتيب» (`compare.drag`),
  `compare.description` «تُطبع الإبل بالترتيب أدناه، وتُعرض القيم جنبًا إلى جنب دون مفاضلة بينها.»
  (ranking said only with «مفاضلة»); History's existing sort field «الترتيب» (`history.sort`) is a
  list order.

Options:

- **A (the app now):** «ترتيب» only for order, «مفاضلة» for ranking; the engine disclaimer becomes
  «… وتُعرض القيم جنبًا إلى جنب دون مفاضلة بينها.» (one engine string changed).
- **B:** «تسلسل» for the print order (`compare.order` «تسلسل الطباعة», the disclaimer «تظهر الإبل
  بالتسلسل الذي اختاره المشغّل…»), «ترتيب» and «مفاضلة» kept for ranking.
- **C:** keep everything as it is.

| Key | Arabic | English |
|---|---|---|
| `history.tabSessions` | الجلسات | Sessions |
| `history.tabComparisons` | المقارنات | Comparisons |
| `history.createdFrom` | تاريخ القياس من | Measured from |
| `history.createdTo` | إلى | to |
| `history.select` | اختيار للمقارنة | Select for a comparison |
| `history.selectColumn` | المقارنة | Comparison |
| `history.cannotCompare` | لا يمكن ضمّها إلى مقارنة: | Cannot join a comparison: |
| `history.selectAllShown` | اختيار كل المعروض | Select all shown |
| `history.inComparisons` | المقارنات التي تضمّها (ستصبح قديمة): | Comparisons that include it (they will be out of date): |
| `compare.selected` | الإبل المختارة | Camels selected |
| `compare.clear` | إلغاء الاختيار | Clear |
| `compare.open` | مقارنة | Compare |
| `compare.full` | بلغ الاختيار الحد الأقصى | The selection is full |
| `compare.title` | مقارنة الإبل | Compare camels |
| `compare.description` | تُطبع الإبل بالترتيب أدناه، وتُعرض القيم جنبًا إلى جنب دون مفاضلة بينها. | The camels print in the order below; the values are shown side by side, never ranked. |
| `compare.order` | ترتيب الطباعة | Print order |
| `compare.drag` | اسحب لتغيير الترتيب | Drag to change the order |
| `compare.moveUp` | نقل إلى الأعلى | Move up |
| `compare.moveDown` | نقل إلى الأسفل | Move down |
| `compare.remove` | إزالة من المقارنة | Remove from the comparison |
| `compare.approvedBySeal` | معتمدة: في تقرير مختوم | Approved: in a sealed report |
| `compare.approveImage` | اعتماد الصورة | Approve the image |
| `compare.approveTitle` | اعتماد صورة هذا الجمل | Approve this camel's image |
| `compare.needsApproval` | اعتمد كل صورة لا يُظهرها بعد تقرير مختوم. | Approve every image that no sealed report shows yet. |
| `compare.cover` | الغلاف | Cover |
| `compare.coverTitle` | العنوان | Title |
| `compare.coverHint` | تُطبع على الغلاف كما كُتبت تمامًا؛ وإن تُرك العنوان فارغًا طُبع العنوان الافتراضي. | Printed on the cover exactly as typed; an empty title prints the default title. |
| `compare.create` | إنشاء المقارنة | Create the comparison |
| `compare.createFailed` | تعذّر إنشاء المقارنة | The comparison could not be created |
| `compare.refused` | إبل رفضها المحرك | Camels the engine refused |
| `compare.dropped` | إبل لم تُضمّ إلى المقارنة الجديدة | Camels left out of the new comparison |
| `compare.noneLeft` | لا يمكن ضمّ أي جمل من هذه المقارنة إلى مقارنة جديدة. | No camel of this comparison can join a new one. |
| `comparisons.search` | بحث (العنوان، الفعالية، الحكم، مجلس الحكام، معرّف الجمل) | Search (title, event, judge, council, camel ID) |
| `comparisons.staleFilter` | مطابقة الجلسات | Sessions match |
| `comparisons.staleOnly` | قديمة | Out of date |
| `comparisons.currentOnly` | محدّثة | Up to date |
| `comparisons.sorts.created_desc` | الأحدث إنشاءً أولًا | Newest first |
| `comparisons.sorts.created_asc` | الأقدم أولًا | Oldest first |
| `comparisons.sorts.updated_desc` | الأحدث تعديلًا أولًا | Last changed first |
| `comparisons.sorts.title_asc` | حسب العنوان | By title |
| `comparisons.loading` | جارٍ تحميل المقارنات… | Loading the comparisons… |
| `comparisons.empty` | لا توجد مقارنات بعد: اختر الإبل في تبويب الجلسات | No comparisons yet: select camels under Sessions |
| `comparisons.noMatch` | لا توجد مقارنة مطابقة | No comparison matches |
| `comparisons.titleColumn` | العنوان | Title |
| `comparisons.camels` | الإبل | Camels |
| `comparisons.created` | تاريخ الإنشاء | Created |
| `comparisons.stale` | قديمة | Out of date |
| `comparisons.reportStale` | التقرير المختوم قديم | Sealed report out of date |
| `comparisons.untitled` | مقارنة بلا عنوان | Untitled comparison |
| `comparisons.deleteTitle` | حذف المقارنة؟ | Delete the comparison? |
| `comparisons.deleteDescription` | تُنقل إلى سلة المحذوفات وتُزال نهائيًا عند التشغيل التالي. تبقى جلسات الإبل كما هي. | It moves to the trash and is removed for good at the next start. The camels' sessions stay. |
| `comparisons.actionFailed` | فشل الإجراء على المقارنة | The action on the comparison failed |
| `comparison.loading` | جارٍ تحميل المقارنة… | Loading the comparison… |
| `comparison.loadFailed` | تعذّر تحميل المقارنة | The comparison could not be loaded |
| `comparison.members` | الإبل بترتيب الطباعة | The camels, in print order |
| `comparison.image` | الصورة | Image |
| `comparison.atCreation` | عند المقارنة | When compared |
| `comparison.now` | الآن | Now |
| `comparison.deleted` | محذوفة | deleted |
| `comparison.openSession` | فتح الجلسة | Open the session |
| `comparison.staleTitle` | هذه المقارنة قديمة | This comparison is out of date |
| `comparison.staleExplain` | تغيّرت جلسة جمل أو أكثر بعد إنشاء هذه المقارنة. يبقى ملف PDF المختوم كما هو؛ ولمقارنة الإبل بحالها الآن أنشئ مقارنة جديدة. | One or more camels' sessions changed after this comparison was made. Its sealed PDF stays as it was; to compare the camels as they are now, compare again. |
| `comparison.compareAgain` | إنشاء مقارنة جديدة | Compare again |
| `comparison.saveCover` | حفظ الغلاف | Save the cover |
| `comparison.coverHint` | كل تغيير يكتب بيانات مقارنة جديدة، ويلزم عندها طباعة ملف PDF المختوم من جديد. | Each change writes new comparison data; a sealed PDF then needs printing again. |
| `comparison.coverFailed` | فشل حفظ الغلاف | Saving the cover failed |
| `comparison.modelVersion` | بيانات المقارنة | Comparison data |
| `comparison.sealedReport` | التقرير المختوم | Sealed report |
| `comparison.backToList` | كل المقارنات | All comparisons |

## D12: the comparison's print (Stage 5, 2026-10-17)

The "Print and seal" card of a comparison, its sealed PDF, the probe's table of camels, and the app's
six new codes. The card's title, "Print again", "Printing and sealing…", "Printing failed", the print
page's problems and warnings, "No report yet" and the PDF errors reuse the single report's strings
(`report.*`, `pdf.*`). The printed comparison's wording is the engine's (Stage 2).

- **«ترتيب» avoided:** `print_overlay_order` says «ليست في موضعها» (out of place) rather than «ليست
  بترتيب المقارنة»; the word stays the operator's decision (Stage 4, options A/B/C).
- **"Out of date"** for the sealed file: «هذا الملف لم يعد يطابق المقارنة», as the single report's
  «هذا التقرير لم يعد يطابق الجلسة».

| Key | Arabic | English |
|---|---|---|
| `comparison.print` | طباعة المقارنة | Print the comparison |
| `comparison.printExplain` | تُصفّ المقارنة من بياناتها ومن الصورة المعتمدة لكل جمل وتُطبع ملف PDF، ثم يتحقق المحرك من صورة كل جمل وأسمائه في صفحاته ويرفق ملفات الإثبات ويختمه. يظهر الملف المختوم أدناه للمراجعة النهائية. | The comparison is laid out from its data and each camel's approved image and printed to PDF; the engine then checks each camel's image and names on its own pages, attaches the evidence files and seals it. The sealed file appears below for sign-off. |
| `comparison.printStale` | هذه المقارنة قديمة: أنشئ مقارنة جديدة لطباعتها | This comparison is out of date: compare again to print it |
| `comparison.approveAll` | اعتمد صورة كل جمل قبل الطباعة | Approve each camel's image before printing |
| `comparison.saveCoverFirst` | احفظ الغلاف قبل الطباعة | Save the cover before printing |
| `comparison.sealed` | خُتمت المقارنة | The comparison is sealed |
| `comparison.sealedExplain` | نجحت فحوص المحرك كلها: صورة كل جمل في صفحتها، وأسماء كل جمل في صفحاته، والخط، وملفات الإثبات المرفقة. | Every engine check passed: each camel's image on its own page, each camel's names on its pages, the font, the attached evidence files. |
| `comparison.pdfTitle` | المقارنة المختومة | Sealed comparison |
| `comparison.pdfStale` | هذا الملف لم يعد يطابق المقارنة | This file no longer matches the comparison |
| `comparison.pdfStaleMembers` | تغيّرت جلسة جمل أو أكثر بعد ختمه. يبقى الملف كما خُتم؛ ولمقارنة الإبل بحالها الآن أنشئ مقارنة جديدة. | One or more camels' sessions changed after it was sealed. The file stays as sealed; to compare the camels as they are now, compare again. |
| `comparison.pdfStaleCover` | تغيّر الغلاف أو اللغة بعد ختمه: اطبعه من جديد. | The cover or language changed after it was sealed: print it again. |
| `probe.members` | كل جمل في صفحاته | Each camel on its pages |
| `probe.memberNames` | أسماؤه في صفحاته | Its names on its pages |
| `appErrors.comparison_approval_required` | اعتمد صورة كل جمل قبل طباعة المقارنة | Approve each camel's image before printing the comparison |
| `appErrors.comparison_model_hash_mismatch` | بيانات المقارنة لا تطابق بصمة المحرك | The comparison model does not match the engine's fingerprint |
| `appErrors.comparison_model_outdated` | بيانات المقارنة أقدم من صفحة الطباعة | The comparison model is older than the print page |
| `appErrors.comparison_model_unreadable` | لا تستطيع صفحة الطباعة قراءة بيانات المقارنة | The print page cannot read the comparison model |
| `appErrors.print_overlay_order` | صورة أحد الإبل ليست في موضعها من صفحة الطباعة | A camel's image is out of place on the print page |
| `appErrors.print_overflow` | خلية في جدول أعرض من عمودها وستُقصّ عند الطباعة | A table cell is wider than its column and would be cut when printed |

## D12: end to end, the review's fixes and release 1.1.0 (Stage 6, 2026-10-18)

No new UI string. The Arabic in `e2e/comparison-fast.spec.ts` and `e2e/helpers/comparison.ts`
(camel ids «ناقة-مقارنة-أ» / «ناقة-مقارنة-ب», the cover «مقارنة اختبار سريع», the save folder
«اختبار مقارنة») is test data, not app wording; the specs read every label from the i18n tables by
key. The two words still open for the operator are unchanged: «مراجعة» (Stage 2) and «ترتيب»
(Stage 4).
