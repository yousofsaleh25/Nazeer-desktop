import { describe, expect, it } from "vitest";
import engineCodes from "@shared/engine-codes.json";
import { PRINT_ERROR_CODES, SAVE_AS_ERROR_CODES, type AppErrorCode } from "@/api/errors";
import ar from "./ar.json";
import en from "./en.json";
import { errorLabel, indexStateLabel, jobStageLabel, messagePair, translate } from "./t";

function leaves(node: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof node !== "object" || node === null) return out;
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of leaves(value, path)) out.set(k, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

const arLeaves = leaves(ar);
const enLeaves = leaves(en);
/** Native language names are the same in both catalogues on purpose. */
const SAME_IN_BOTH = new Set(["prefs.arabic", "prefs.english"]);

describe("i18n catalogues", () => {
  it("ar.json and en.json have exactly the same keys", () => {
    expect([...arLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
  });

  it("every value is a non-empty, trimmed string", () => {
    for (const [lang, map] of [
      ["ar", arLeaves],
      ["en", enLeaves],
    ] as const) {
      for (const [key, value] of map) {
        expect(typeof value, `${lang} ${key}`).toBe("string");
        expect((value as string).length, `${lang} ${key}`).toBeGreaterThan(0);
        expect(value, `${lang} ${key}`).toBe((value as string).trim());
      }
    }
  });

  it("the Arabic catalogue is translated (Arabic letters, not an English copy)", () => {
    const arabicLetter = /\p{Script=Arabic}/u;
    const untranslated = [...arLeaves].filter(
      ([key, value]) =>
        !SAME_IN_BOTH.has(key) &&
        (value === enLeaves.get(key) || !arabicLetter.test(String(value))),
    );
    expect(untranslated.map(([key]) => key)).toEqual([]);
  });

  it("labels every error code the engine can send, in both languages", () => {
    const missing = engineCodes.errors.filter((code) => errorLabel(code) === null);
    expect(missing).toEqual([]);
  });

  it("has no error label for a code the engine does not send", () => {
    const known = new Set(engineCodes.errors);
    expect(Object.keys(en.errors).filter((code) => !known.has(code))).toEqual([]);
  });

  it("unknown codes have no label (the UI then shows the raw code and the engine message)", () => {
    expect(errorLabel("no_such_code")).toBeNull();
  });

  it("labels the app's own error codes, which never shadow an engine code", () => {
    const appCodes: AppErrorCode[] = [
      "network_error",
      "invalid_response",
      "overlay_hash_mismatch",
      "engine_spawn_failed",
      "engine_start_timeout",
      "engine_exited",
      "engine_restart_limit",
      "engine_protocol_error",
      "bridge_missing",
      "screen_failed",
      ...PRINT_ERROR_CODES,
      ...SAVE_AS_ERROR_CODES,
    ];
    expect(Object.keys(en.appErrors).sort()).toEqual([...appCodes].sort());
    for (const code of appCodes) expect(errorLabel(code), code).not.toBeNull();
    const engine = new Set(engineCodes.errors);
    expect(appCodes.filter((code) => engine.has(code))).toEqual([]);
  });

  it("resolves keys, pairs and the closed unions", () => {
    expect(translate("ar", "app.name")).toBe("نظير");
    expect(translate("en", "app.name")).toBe("Nazeer");
    expect(messagePair("nav.history")).toEqual({ ar: "السجل", en: "History" });
    // lowercase like the engine's own English state labels ("open", "running")
    expect(indexStateLabel("missing_files")).toEqual({ ar: "ملفات مفقودة", en: "files missing" });
    expect(jobStageLabel("walking")).toEqual({ ar: "قراءة الإطارات", en: "reading frames" });
    expect(errorLabel("stale_revision")).toEqual({
      ar: "تغيّرت الجلسة في مكان آخر",
      en: "The session changed elsewhere",
    });
  });
});
