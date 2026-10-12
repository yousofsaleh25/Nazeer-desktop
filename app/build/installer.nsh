; Nazeer Desktop installer: Arabic for the strings electron-builder 26.15.3 ships only in English
; (its "Only for me / Anyone who uses this computer" pages and five common messages), and a
; bilingual title for the language dialog (D11). electron-builder includes this file
; (electron-builder.yml, nsis.include) and inserts customHeader after its own message tables, so
; these definitions replace the English fallback it registers for Arabic (1025); makensis then
; warns that each string is set twice (warning 6030), which is expected and silenced only here.
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
  !pragma warning pop
!macroend
