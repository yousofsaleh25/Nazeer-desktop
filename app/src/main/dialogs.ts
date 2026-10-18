/**
 * OS dialogs owned by main: the .bag file picker, the capture-folder picker, the "quit anyway?"
 * question, and "Save as" for a sealed PDF (D12: the Save dialog and its three questions). Main has
 * no i18n catalogue, so its few strings are bilingual (Arabic line first).
 */
import { dialog, type BrowserWindow } from "electron";
import type { AfterWriteFailure, WriteProblem } from "./report/saveAs";

const TITLE = "نظير — Nazeer";

export const MAIN_STRINGS = {
  openBagTitle: "اختر ملف تسجيل — Choose a .bag recording",
  bagFilter: "تسجيل RealSense — RealSense recording (.bag)",
  pickFolderTitle: "اختر مجلد تسجيل — Choose a capture folder",
  quitAnyway: "إغلاق دون حفظ — Quit anyway",
  cancel: "إلغاء — Cancel",
  unsavedMessage: "توجد تغييرات غير محفوظة.\nThere are unsaved changes.",
  unsavedDetail:
    "تعذّر حفظ آخر التعديلات في المحرك. إن أغلقت الآن فستُفقد.\n" +
    "The latest edits could not be saved to the engine. Quitting now loses them.",
  noAnswerMessage: "تعذّر التأكد من حفظ العمل.\nThe app could not confirm that your work is saved.",
  noAnswerDetail:
    "لم تستجب نافذة التطبيق. إن أغلقت الآن فقد تُفقد آخر التعديلات.\n" +
    "The app window did not answer. Quitting now may lose the latest edits.",
  rendererLostMessage:
    "توقفت نافذة التطبيق ولم تُستعد.\nThe app window stopped and was not restored.",
  rendererLostDetail:
    "كل ما حُفظ باقٍ لدى المحرك، وتضيع التعديلات التي لم تُحفظ بعد. التفاصيل في مجلد سجلات التشغيل:\n" +
    "Everything saved is kept by the engine; edits not saved yet are lost. The details are in the log folder:",
  tryAgain: "إعادة المحاولة — Try again",
  quit: "إنهاء — Quit",
  // "Save as" (D12; the operator chose «حفظ نسخة PDF باسم…», 2026-10-17)
  saveCopyTitle: "حفظ نسخة PDF باسم — Save PDF as",
  pdfFilter: "مستند PDF — PDF document",
  replaceMessage: "يوجد ملف بهذا الاسم.\nA file with this name already exists.",
  replaceDetail: "هل تستبدله بالنسخة الجديدة؟\nReplace it with the new copy?",
  replace: "استبدال — Replace",
  dataRootMessage:
    "لا تُحفظ النسخة في مجلد بيانات التطبيق.\nA copy cannot be saved in the app's data folder.",
  dataRootDetail:
    "يحتفظ المحرك بهذا المجلد لنفسه. اختر مجلدًا آخر.\n" +
    "The engine keeps this folder for itself. Choose another folder.",
  chooseAnother: "اختيار مكان آخر — Choose another place",
  writeBusyMessage: "الملف مفتوح في برنامج آخر.\nThe file is open in another program.",
  writeBusyDetail:
    "أغلقه ثم أعد المحاولة، أو احفظ النسخة في مكان آخر.\n" +
    "Close it and try again, or save the copy elsewhere.",
  writeDeniedMessage: "تعذّرت الكتابة في هذا المكان.\nThis place cannot be written to.",
  writeDeniedDetail:
    "قد يكون الملف مفتوحًا في برنامج آخر، أو المجلد للقراءة فقط، أو تحجزه خدمة مزامنة سحابية.\n" +
    "The file may be open in another program, the folder may be read-only, or a cloud-sync " +
    "service may be holding it.",
  writeOtherMessage: "تعذّرت كتابة النسخة.\nThe copy could not be written.",
  saveElsewhere: "حفظ النسخة في مكان آخر… — Save elsewhere…",
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

function attached(win: BrowserWindow | null): BrowserWindow | null {
  return win !== null && !win.isDestroyed() ? win : null;
}

async function ask(
  win: BrowserWindow | null,
  options: Electron.MessageBoxOptions,
): Promise<number> {
  const parent = attached(win);
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return response;
}

/** The Save dialog for a copy of a sealed PDF; null when cancelled (D12). */
export async function saveCopyDialog(
  win: BrowserWindow | null,
  defaultPath: string,
): Promise<string | null> {
  const options: Electron.SaveDialogOptions = {
    title: MAIN_STRINGS.saveCopyTitle,
    defaultPath,
    filters: [{ name: MAIN_STRINGS.pdfFilter, extensions: ["pdf"] }],
  };
  const parent = attached(win);
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  return result.canceled || result.filePath === "" ? null : result.filePath;
}

/** Main added ".pdf" to the name, and a file of that name exists: replace it? */
export async function confirmReplaceDialog(
  win: BrowserWindow | null,
  file: string,
): Promise<boolean> {
  const response = await ask(win, {
    type: "warning",
    title: TITLE,
    message: MAIN_STRINGS.replaceMessage,
    detail: `${file}\n\n${MAIN_STRINGS.replaceDetail}`,
    buttons: [MAIN_STRINGS.replace, MAIN_STRINGS.cancel],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
}

/** The chosen folder is the engine's data root (or inside it). */
export async function dataRootDialog(
  win: BrowserWindow | null,
  file: string,
): Promise<"elsewhere" | "cancel"> {
  const response = await ask(win, {
    type: "warning",
    title: TITLE,
    message: MAIN_STRINGS.dataRootMessage,
    detail: `${MAIN_STRINGS.dataRootDetail}\n\n${file}`,
    buttons: [MAIN_STRINGS.chooseAnother, MAIN_STRINGS.cancel],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return response === 0 ? "elsewhere" : "cancel";
}

/** The copy could not be written, even after the retries: try again, elsewhere, or cancel. */
export async function writeFailedDialog(
  win: BrowserWindow | null,
  problem: WriteProblem,
  file: string,
  detail: string,
): Promise<AfterWriteFailure> {
  const message =
    problem === "busy"
      ? MAIN_STRINGS.writeBusyMessage
      : problem === "denied"
        ? MAIN_STRINGS.writeDeniedMessage
        : MAIN_STRINGS.writeOtherMessage;
  const hint =
    problem === "busy"
      ? MAIN_STRINGS.writeBusyDetail
      : problem === "denied"
        ? MAIN_STRINGS.writeDeniedDetail
        : "";
  const response = await ask(win, {
    type: "error",
    title: TITLE,
    message,
    detail: `${hint === "" ? "" : `${hint}\n\n`}${file}\n(${detail})`,
    buttons: [MAIN_STRINGS.tryAgain, MAIN_STRINGS.saveElsewhere, MAIN_STRINGS.cancel],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  return response === 0 ? "retry" : response === 1 ? "elsewhere" : "cancel";
}

/**
 * The operator window's renderer keeps failing or cannot start (windows.ts): try again, or quit.
 * The window may never have shown, so the box only attaches to a visible one.
 */
export async function rendererLostDialog(
  win: BrowserWindow | null,
  logDir: string,
  reason: string,
): Promise<boolean> {
  const options: Electron.MessageBoxOptions = {
    type: "error",
    title: TITLE,
    message: MAIN_STRINGS.rendererLostMessage,
    detail: `${MAIN_STRINGS.rendererLostDetail}\n${logDir}\n(${reason})`,
    buttons: [MAIN_STRINGS.tryAgain, MAIN_STRINGS.quit],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const { response } =
    win && !win.isDestroyed() && win.isVisible()
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
  return response === 0;
}
