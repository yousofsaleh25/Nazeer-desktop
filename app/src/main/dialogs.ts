/**
 * OS dialogs owned by main: the .bag file picker, the capture-folder picker and the "quit anyway?"
 * question. Main has no i18n catalogue, so its few strings are bilingual (Arabic line first).
 */
import { dialog, type BrowserWindow } from "electron";

const TITLE = "نظير — Nazeer";

export const MAIN_STRINGS = {
  openBagTitle: "اختر ملف تسجيل — Choose a .bag recording",
  bagFilter: "تسجيل RealSense — RealSense recording (.bag)",
  pickFolderTitle: "اختر مجلد التسجيلات — Choose a capture folder",
  quitAnyway: "إغلاق دون حفظ — Quit anyway",
  cancel: "إلغاء — Cancel",
  unsavedMessage: "توجد تغييرات غير محفوظة.\nThere are unsaved changes.",
  unsavedDetail:
    "تعذّر حفظ آخر التعديلات في المحرك. إن أغلقت الآن ستُفقد.\n" +
    "The latest edits could not be saved to the engine. Quitting now loses them.",
  noAnswerMessage: "تعذّر التأكد من حفظ العمل.\nThe app could not confirm that your work is saved.",
  noAnswerDetail:
    "لم تستجب نافذة التطبيق. إن أغلقت الآن قد تُفقد آخر التعديلات.\n" +
    "The app window did not answer. Quitting now may lose the latest edits.",
} as const;

export async function openBagDialog(win: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: MAIN_STRINGS.openBagTitle,
    properties: ["openFile", "dontAddToRecent"],
    filters: [{ name: MAIN_STRINGS.bagFilter, extensions: ["bag"] }],
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  const file = result.canceled ? undefined : result.filePaths[0];
  return file !== undefined && file.toLowerCase().endsWith(".bag") ? file : null;
}

export async function pickFolderDialog(win: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: MAIN_STRINGS.pickFolderTitle,
    properties: ["openDirectory", "dontAddToRecent"],
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export async function confirmQuitDialog(
  win: BrowserWindow | null,
  reason: "unsaved" | "no_answer",
): Promise<boolean> {
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    title: TITLE,
    message: reason === "unsaved" ? MAIN_STRINGS.unsavedMessage : MAIN_STRINGS.noAnswerMessage,
    detail: reason === "unsaved" ? MAIN_STRINGS.unsavedDetail : MAIN_STRINGS.noAnswerDetail,
    buttons: [MAIN_STRINGS.quitAnyway, MAIN_STRINGS.cancel],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const { response } =
    win && !win.isDestroyed()
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
  return response === 0;
}
