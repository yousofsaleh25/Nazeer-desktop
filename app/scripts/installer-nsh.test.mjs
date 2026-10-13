import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nsh = readFileSync(path.join(APP_DIR, "build", "installer.nsh"), "utf8");
const lines = nsh.split(/\r?\n/).map((line) => line.trim());

const word = (...codes) => String.fromCharCode(...codes);
// the operator's word for install (2026-10-14), and what the installer must no longer show: NSIS's
// own word, and "choose" / "press" written with a hamza that hamzat al-wasl does not take
const INSTALL = word(0x062a, 0x062b, 0x0628, 0x064a, 0x062a);
const BANNED = [
  word(0x062a, 0x0646, 0x0635, 0x064a, 0x0628),
  word(0x0625, 0x062e, 0x062a, 0x0631),
  word(0x0625, 0x0636, 0x063a, 0x0637),
];

/** The Arabic value build/installer.nsh gives a language string, or undefined. */
function arabic(name) {
  const prefix = `LangString ${name} 1025 "`;
  const line = lines.find((l) => l.startsWith(prefix));
  return line?.slice(prefix.length, -1);
}

/** The body of one macro, line by line. */
function macro(name) {
  const start = lines.indexOf(`!macro ${name}`);
  const end = lines.indexOf("!macroend", start);
  expect(start, `!macro ${name}`).toBeGreaterThanOrEqual(0);
  return lines.slice(start + 1, end);
}

describe("the installer's Arabic (build/installer.nsh)", () => {
  it("says install with one word, and none of NSIS's own words or misspellings", () => {
    // the comments may name the words they replace; what the installer shows may not
    const code = lines.filter((l) => !l.startsWith(";")).join("\n");
    for (const banned of BANNED) expect(code).not.toContain(banned);
    for (const name of [
      "^SetupCaption",
      "^UninstallCaption",
      "^InstallBtn",
      "^UninstallBtn",
      "^ClickInstall",
      "MUI_TEXT_INSTALLING_TITLE",
      "MUI_UNTEXT_UNINSTALLING_TITLE",
    ]) {
      expect(arabic(name), name).toContain(INSTALL);
    }
  });

  it("replaces only the Arabic strings, and MUI2's only on the pages this build has", () => {
    const strings = lines.filter((l) => l.startsWith("LangString "));
    expect(strings.length).toBeGreaterThan(40);
    for (const line of strings) expect(line).toMatch(/^LangString \^?\w+ 1025 "/);
    // MUI2 creates its page strings per page: one set for Arabic alone would leave English without it
    let guard = null;
    for (const line of lines) {
      if (line.startsWith("!ifdef MUI_")) guard = line;
      else if (line === "!endif") guard = null;
      else if (line.startsWith("LangString MUI_"))
        expect(guard, line).toMatch(/^!ifdef MUI_\w*PAGE$/);
    }
  });

  it("stores the language chosen at install, and the uninstaller speaks it", () => {
    expect(macro("customInstall")).toContain(
      'WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallerLanguage "$LANGUAGE"',
    );
    const unInit = macro("customUnInit");
    expect(unInit).toContain(
      'ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallerLanguage',
    );
    expect(unInit).toContain('${If} $R0 == "1025"');
    expect(unInit).toContain('${OrIf} $R0 == "1033"');
    expect(unInit).toContain("StrCpy $LANGUAGE $R0");
  });

  it("mirrors electron-builder's install-mode page, for a right-to-left language only", () => {
    const mirror = macro("nzMirrorPageControls");
    expect(mirror[0]).toBe('${If} "$(^RTL)" == "1"');
    // BS_LEFTTEXT | BS_RIGHT on buttons, SS_RIGHT on labels, WS_EX_RTLREADING | WS_EX_LEFTSCROLLBAR
    expect(mirror).toContain("IntOp $R5 $R5 | 0x220");
    expect(mirror).toContain("IntOp $R5 $R5 | 2");
    expect(mirror).toContain("IntOp $R5 $R5 | 0x6000");
    expect(macro("customWelcomePage")).toEqual([
      "!ifndef INSTALL_MODE_PER_ALL_USERS",
      "!define MUI_PAGE_CUSTOMFUNCTION_SHOW nzInstallModePageShow",
      "Function nzInstallModePageShow",
      "!insertmacro nzMirrorPageControls",
      "FunctionEnd",
      "!endif",
    ]);
    // the uninstaller's hook replaces the default welcome page: it inserts that page before it hands
    // the show callback on, or the welcome page would take it
    const unWelcome = macro("customUnWelcomePage");
    expect(unWelcome.indexOf("!insertmacro MUI_UNPAGE_WELCOME")).toBe(0);
    expect(unWelcome).toContain("!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.nzInstallModePageShow");
    expect(unWelcome).toContain("!insertmacro nzMirrorPageControls");
  });
});
