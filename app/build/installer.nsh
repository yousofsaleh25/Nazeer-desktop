; Nazeer Desktop installer (D11). electron-builder includes this file (electron-builder.yml,
; nsis.include) and expands the macros below at its documented hooks:
;   customHeader         after its own and MUI2's message tables, so these definitions replace
;                        theirs; makensis then warns that each string is set twice (warning 6030),
;                        which is expected and silenced only here:
;                        - Arabic for the strings electron-builder ships only in English (its "Only
;                          for me / Anyone who uses this computer" pages and five common messages)
;                          and a bilingual title for the language dialog;
;                        - NSIS's own Arabic (its Arabic.nlf and MUI2's Arabic.nsh) on the pages this
;                          installer and its uninstaller show, with one word for install, «تثبيت»,
;                          and «إلغاء التثبيت» for uninstall (operator, 2026-10-14; NSIS says «تنصيب»
;                          and «إزالة»), and «اختر» / «اضغط» / «الانتظار» / «انتهى» without the hamza
;                          NSIS gives them
;   customWelcomePage,   just before electron-builder's install-mode page (the installer's and the
;   customUnWelcomePage  uninstaller's): mirror that page's controls for Arabic
;   customInstall,       the language chosen in the language dialog is stored with the install and
;   customUnInit         the uninstaller speaks it, not Windows' own language
; Wording review: docs/arabic-wording-backlog.md.

!macro customHeader
  !define MUI_LANGDLL_WINDOWTITLE "لغة المثبّت — Installer language"
  !define MUI_LANGDLL_INFO "اختر لغة المثبّت. — Please select a language."

  !pragma warning push
  !pragma warning disable 6030
  LangString win7Required 1025 "يتطلب البرنامج نظام Windows 7 أو أحدث"
  LangString x64WinRequired 1025 "يتطلب البرنامج نظام Windows بإصدار 64 بت"
  LangString installing 1025 "جارٍ التثبيت، يُرجى الانتظار..."
  LangString areYouSureToUninstall 1025 "هل تريد بالتأكيد إلغاء تثبيت ${PRODUCT_NAME}؟"
  LangString appClosing 1025 "جارٍ إغلاق ${PRODUCT_NAME}..."
  LangString chooseInstallationOptions 1025 "اختر خيارات التثبيت"
  LangString chooseUninstallationOptions 1025 "اختر خيارات إلغاء التثبيت"
  LangString whichInstallationShouldBeRemoved 1025 "أيّ تثبيت تريد إزالته؟"
  LangString whoShouldThisApplicationBeInstalledFor 1025 "لمن تريد تثبيت هذا البرنامج؟"
  LangString selectUserMode 1025 "اختر هل تريد إتاحة هذا البرنامج لجميع مستخدمي هذا الحاسوب أم لك وحدك"
  LangString whichInstallationRemove 1025 "هذا البرنامج مثبّت لجميع المستخدمين ولمستخدم واحد أيضًا.$\r$\nأيّ تثبيت تريد إزالته؟"
  LangString freshInstallForAll 1025 "تثبيت جديد لجميع المستخدمين (يطلب صلاحيات المسؤول)."
  LangString freshInstallForCurrent 1025 "تثبيت جديد للمستخدم الحالي فقط."
  LangString onlyForMe 1025 "لي وحدي"
  LangString forAll 1025 "لكل من يستخدم هذا الحاسوب (جميع المستخدمين)"
  LangString loginWithAdminAccount 1025 "للمتابعة يلزم تسجيل الدخول بحساب عضو في مجموعة المسؤولين..."
  LangString perUserInstallExists 1025 "يوجد تثبيت سابق لهذا المستخدم."
  LangString perUserInstall 1025 "يوجد تثبيت لهذا المستخدم."
  LangString perMachineInstallExists 1025 "يوجد تثبيت سابق لجميع المستخدمين."
  LangString perMachineInstall 1025 "يوجد تثبيت لجميع المستخدمين."
  LangString reinstallUpgrade 1025 "ستُعاد عملية التثبيت أو الترقية."
  LangString uninstall 1025 "سيُلغى التثبيت."

  ; NSIS's built-in strings (Arabic.nlf): the window titles, the buttons and the texts of the folder
  ; page; MUI2 blanks the pages' sub-captions, so those are not shown
  LangString ^SetupCaption 1025 "تثبيت $(^Name)"
  LangString ^UninstallCaption 1025 "إلغاء تثبيت $(^Name)"
  LangString ^InstallBtn 1025 "&تثبيت"
  LangString ^UninstallBtn 1025 "&إلغاء التثبيت"
  LangString ^ClickNext 1025 "اضغط على التالي للمتابعة."
  LangString ^ClickInstall 1025 "اضغط على تثبيت لبدء التثبيت."
  LangString ^ClickUninstall 1025 "اضغط على إلغاء التثبيت للبدء."
  LangString ^DirText 1025 "سيتم تثبيت $(^NameDA) في المجلد التالي. للتثبيت في مجلد آخر، اضغط على عرض واختر مجلدًا آخر. $_CLICK"
  LangString ^DirBrowseText 1025 "اختر المجلد لتثبيت $(^NameDA) فيه:"
  LangString ^Completed 1025 "انتهى"
  LangString ^FileError 1025 "حدث خلل أثناء فتح ملف للكتابة:$\r$\n$\t$\"$0$\"$\r$\nاضغط على إلغاء لإيقاف التثبيت،$\r$\nأو على إعادة المحاولة لكتابة الملف مرة أخرى،$\r$\nأو على تجاهل لتخطي الملف."
  LangString ^FileError_NoIgnore 1025 "حدث خلل أثناء فتح ملف للكتابة:$\r$\n$\t$\"$0$\"$\r$\nاضغط على إعادة المحاولة لكتابة الملف مرة أخرى،$\r$\nأو على إلغاء لإيقاف التثبيت."

  ; MUI2's page strings (Arabic.nsh), only for the pages this build has: MUI2 creates them per page,
  ; and a string set here for one language only would be missing in the other
  !ifdef MUI_DIRECTORYPAGE
    LangString MUI_TEXT_DIRECTORY_TITLE 1025 "اختر موقع التثبيت"
    LangString MUI_TEXT_DIRECTORY_SUBTITLE 1025 "اختر المجلد المراد تثبيت $(^NameDA) فيه."
  !endif
  !ifdef MUI_INSTFILESPAGE
    LangString MUI_TEXT_INSTALLING_TITLE 1025 "جارٍ التثبيت"
    LangString MUI_TEXT_INSTALLING_SUBTITLE 1025 "الرجاء الانتظار أثناء تثبيت $(^NameDA)."
    LangString MUI_TEXT_FINISH_TITLE 1025 "انتهى التثبيت"
    LangString MUI_TEXT_FINISH_SUBTITLE 1025 "انتهت عملية التثبيت بنجاح."
    LangString MUI_TEXT_ABORT_TITLE 1025 "توقف التثبيت"
    LangString MUI_TEXT_ABORT_SUBTITLE 1025 "لم ينتهِ التثبيت بنجاح."
  !endif
  !ifdef MUI_FINISHPAGE
    LangString MUI_TEXT_FINISH_INFO_TEXT 1025 "لقد تم تثبيت $(^NameDA) على الجهاز.$\r$\n$\r$\nاضغط على إنهاء لإغلاق مرشد الإعداد."
    LangString MUI_TEXT_FINISH_INFO_REBOOT 1025 "يجب إعادة تشغيل الجهاز لإنهاء تثبيت $(^NameDA). هل تريد إعادة التشغيل الآن؟"
  !endif
  !ifdef MUI_UNWELCOMEPAGE
    LangString MUI_UNTEXT_WELCOME_INFO_TITLE 1025 "مرحبًا بك في مرشد إلغاء تثبيت $(^NameDA)"
    LangString MUI_UNTEXT_WELCOME_INFO_TEXT 1025 "هذا المرشد سيدلّك أثناء إلغاء تثبيت $(^NameDA).$\r$\n$\r$\nقبل البدء بإلغاء التثبيت، يرجى التأكد من أن $(^NameDA) غير شغّال.$\r$\n$\r$\n$_CLICK"
  !endif
  !ifdef MUI_UNINSTFILESPAGE
    LangString MUI_UNTEXT_UNINSTALLING_TITLE 1025 "جارٍ إلغاء التثبيت"
    LangString MUI_UNTEXT_UNINSTALLING_SUBTITLE 1025 "الرجاء الانتظار أثناء إلغاء تثبيت $(^NameDA)."
    LangString MUI_UNTEXT_FINISH_TITLE 1025 "انتهى إلغاء التثبيت"
    LangString MUI_UNTEXT_FINISH_SUBTITLE 1025 "انتهت عملية إلغاء التثبيت بنجاح."
    LangString MUI_UNTEXT_ABORT_TITLE 1025 "توقف إلغاء التثبيت"
    LangString MUI_UNTEXT_ABORT_SUBTITLE 1025 "لم ينتهِ إلغاء التثبيت بنجاح."
  !endif
  !ifdef MUI_UNFINISHPAGE
    LangString MUI_UNTEXT_FINISH_INFO_TITLE 1025 "إنهاء مرشد إلغاء تثبيت $(^NameDA)"
    LangString MUI_UNTEXT_FINISH_INFO_TEXT 1025 "لقد تم إلغاء تثبيت $(^NameDA) من الجهاز.$\r$\n$\r$\nاضغط على إنهاء لإغلاق المرشد."
    LangString MUI_UNTEXT_FINISH_INFO_REBOOT 1025 "يجب إعادة تشغيل الجهاز لإنهاء إلغاء تثبيت $(^NameDA). هل تريد إعادة التشغيل الآن؟"
  !endif
  !pragma warning pop
!macroend

; electron-builder builds its install-mode page at run time with nsDialogs, which mirrors controls for
; a right-to-left language only after nsDialogs::SetRTL: MUI2's own pages call it, that page does not,
; so its radio buttons and texts stayed left to right in the Arabic installer (Windows Sandbox run,
; 2026-10-13). Called by the page just before it is shown, this mirrors them the way makensis mirrors
; NSIS's own dialogs: each control's x flipped inside the page; a radio button's circle on the right
; and its text right-aligned (BS_LEFTTEXT | BS_RIGHT); a left-aligned label right-aligned (SS_RIGHT);
; right-to-left reading order with any scroll bar on the left (WS_EX_RTLREADING | WS_EX_LEFTSCROLLBAR).
!macro nzMirrorPageControls
  ${If} "$(^RTL)" == "1"
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    Push $R6
    Push $R7
    ; the page: the dialog nsDialogs created inside the installer window
    FindWindow $R0 "#32770" "" $HWNDPARENT
    ${If} $R0 <> 0
      System::Call "*(i 0, i 0, i 0, i 0) p .R7"
      System::Call "user32::GetClientRect(p R0, p R7)"
      System::Call "*$R7(i .R2, i .R3, i .R6, i .R5)"
      FindWindow $R1 "" "" $R0
      ${DoWhile} $R1 <> 0
        ; the control's rectangle in the page (left, top, right, bottom); mirrored left = width - right
        System::Call "user32::GetWindowRect(p R1, p R7)"
        System::Call "user32::MapWindowPoints(p 0, p R0, p R7, i 2)"
        System::Call "*$R7(i .R2, i .R3, i .R4, i .R5)"
        IntOp $R4 $R6 - $R4
        System::Call "user32::GetClassNameW(p R1, w .R2, i ${NSIS_MAX_STRLEN})"
        System::Call "user32::GetWindowLongW(p R1, i -16) i .R5"
        ${If} $R2 == "Button"
          IntOp $R5 $R5 | 0x220
          IntOp $R5 $R5 & 0xFFFFFEFF
        ${ElseIf} $R2 == "Static"
          ; SS_LEFT (0) or SS_LEFTNOWORDWRAP (12) becomes SS_RIGHT (2)
          IntOp $R2 $R5 & 0x1F
          ${If} $R2 = 0
          ${OrIf} $R2 = 12
            IntOp $R5 $R5 & 0xFFFFFFE0
            IntOp $R5 $R5 | 2
          ${EndIf}
        ${EndIf}
        System::Call "user32::SetWindowLongW(p R1, i -16, i R5)"
        System::Call "user32::GetWindowLongW(p R1, i -20) i .R5"
        IntOp $R5 $R5 | 0x6000
        System::Call "user32::SetWindowLongW(p R1, i -20, i R5)"
        ; SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
        System::Call "user32::SetWindowPos(p R1, p 0, i R4, i R3, i 0, i 0, i 0x35)"
        FindWindow $R1 "" "" $R0 $R1
      ${Loop}
      System::Free $R7
    ${EndIf}
    Pop $R7
    Pop $R6
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
  ${EndIf}
!macroend

; The installer: expanded just before electron-builder's install-mode page (assistedInstaller.nsh). It
; adds no page; it hands that page the function above as its show callback.
!macro customWelcomePage
  !ifndef INSTALL_MODE_PER_ALL_USERS
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW nzInstallModePageShow
    Function nzInstallModePageShow
      !insertmacro nzMirrorPageControls
    FunctionEnd
  !endif
!macroend

; The uninstaller: this hook replaces the default welcome page, so it inserts that page first, then
; hands the install-mode page that follows it (shown when both installs exist) the same callback.
!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  !ifndef INSTALL_MODE_PER_ALL_USERS
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.nzInstallModePageShow
    Function un.nzInstallModePageShow
      !insertmacro nzMirrorPageControls
    FunctionEnd
  !endif
!macroend

; Stored beside the install location in the install's own registry key (the current user's or the
; machine's), which the uninstaller deletes with the program.
!macro customInstall
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallerLanguage "$LANGUAGE"
!macroend

; After electron-builder's un.onInit has chosen the install (per user or per machine, so SHELL_CONTEXT
; is that install's): Arabic (1025) or English (1033) as chosen at install; NSIS applies $LANGUAGE once
; un.onInit returns.
!macro customUnInit
  Push $R0
  ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallerLanguage
  ${If} $R0 == "1025"
  ${OrIf} $R0 == "1033"
    StrCpy $LANGUAGE $R0
  ${EndIf}
  Pop $R0
!macroend
