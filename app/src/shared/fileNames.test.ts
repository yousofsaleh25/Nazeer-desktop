import { describe, expect, it } from "vitest";
import {
  comparisonReportFileName,
  ensurePdfExtension,
  localDateStamp,
  MAX_BASE_CODE_POINTS,
  sanitizeBaseName,
  sanitizeSuggestedName,
  sessionReportFileName,
} from "./fileNames";

// invisible and special characters are built from code points, never typed (no-invisible-chars)
const RLO = String.fromCharCode(0x202e);
const LRM = String.fromCharCode(0x200e);
const ZWSP = String.fromCharCode(0x200b);
const SUPERSCRIPT_ONE = String.fromCharCode(0x00b9);
const NUL = String.fromCharCode(0);
const BELL = String.fromCharCode(7);
/** U+1F42A (a dromedary camel): one code point, two UTF-16 units */
const CAMEL = String.fromCodePoint(0x1f42a);

/** An ISO instant for a local wall-clock time (the date stamp is local, whatever the zone). */
const localIso = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h).toISOString();

describe("sanitizeBaseName", () => {
  it("keeps Arabic letters, digits and spaces", () => {
    expect(sanitizeBaseName("ناقة الاختبار 7")).toBe("ناقة الاختبار 7");
  });

  it("replaces the characters Windows forbids and control characters with _", () => {
    expect(sanitizeBaseName('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(sanitizeBaseName(`x${NUL}y${BELL}z`)).toBe("x_y_z");
    expect(sanitizeBaseName("a//b")).toBe("a_b");
  });

  it("removes format characters, so an override cannot fake an extension", () => {
    expect(sanitizeBaseName(`report${RLO}fdp.exe`)).toBe("reportfdp.exe");
    expect(sanitizeBaseName(`جمل${LRM}-7${ZWSP}`)).toBe("جمل-7");
  });

  it("prefixes reserved device names, also with an extension or a superscript digit", () => {
    expect(sanitizeBaseName("CON")).toBe("_CON");
    expect(sanitizeBaseName("nul")).toBe("_nul");
    expect(sanitizeBaseName("com1")).toBe("_com1");
    expect(sanitizeBaseName("LPT9.backup")).toBe("_LPT9.backup");
    expect(sanitizeBaseName(`COM${SUPERSCRIPT_ONE}`)).toBe(`_COM${SUPERSCRIPT_ONE}`);
    // a longer name that only starts like a device is fine
    expect(sanitizeBaseName("CON_2026-10-17")).toBe("CON_2026-10-17");
    expect(sanitizeBaseName("console")).toBe("console");
  });

  it("drops trailing dots and spaces, and never returns an empty name", () => {
    expect(sanitizeBaseName("name. . .")).toBe("name");
    expect(sanitizeBaseName("...")).toBe("report");
    expect(sanitizeBaseName("   ")).toBe("report");
    expect(sanitizeBaseName("")).toBe("report");
  });

  it("cuts to 120 code points without splitting a surrogate pair", () => {
    const long = CAMEL.repeat(200);
    const cut = sanitizeBaseName(long);
    expect(Array.from(cut)).toHaveLength(MAX_BASE_CODE_POINTS);
    expect(cut).toBe(CAMEL.repeat(MAX_BASE_CODE_POINTS));
    expect(Array.from(sanitizeBaseName("ب".repeat(500)))).toHaveLength(MAX_BASE_CODE_POINTS);
  });
});

describe("ensurePdfExtension / sanitizeSuggestedName", () => {
  it("adds .pdf unless the name already ends with it", () => {
    expect(ensurePdfExtension("a")).toBe("a.pdf");
    expect(ensurePdfExtension("a.PDF")).toBe("a.PDF");
    expect(ensurePdfExtension("a.txt")).toBe("a.txt.pdf");
  });

  it("keeps only a file name: folders from the renderer are dropped", () => {
    expect(sanitizeSuggestedName("C:\\Users\\x\\تقرير.pdf")).toBe("تقرير.pdf");
    expect(sanitizeSuggestedName("..\\..\\evil")).toBe("evil.pdf");
    expect(sanitizeSuggestedName("a/b/c.PDF")).toBe("c.pdf");
    expect(sanitizeSuggestedName("")).toBe("report.pdf");
    expect(sanitizeSuggestedName("CON.pdf")).toBe("_CON.pdf");
  });
});

describe("localDateStamp", () => {
  it("is the local calendar day of the instant", () => {
    expect(localDateStamp(localIso(2026, 10, 17, 23))).toBe("2026-10-17");
    expect(localDateStamp(localIso(2026, 1, 2, 0))).toBe("2026-01-02");
  });

  it("falls back to now when the instant does not parse", () => {
    const now = new Date(2026, 9, 17, 9);
    expect(localDateStamp("not a date", now)).toBe("2026-10-17");
    expect(localDateStamp(null, now)).toBe("2026-10-17");
  });
});

describe("default names", () => {
  it("a session: the camel id, the measuring day, and _vN after the first report", () => {
    const created = localIso(2026, 10, 14);
    const base = { sessionId: "20261014_101500_abc123", createdAt: created };
    expect(sessionReportFileName({ ...base, camelId: "ناقة-7", version: 1 })).toBe(
      "ناقة-7_2026-10-14.pdf",
    );
    expect(sessionReportFileName({ ...base, camelId: "ناقة-7", version: 3 })).toBe(
      "ناقة-7_2026-10-14_v3.pdf",
    );
    expect(sessionReportFileName({ ...base, camelId: "  ", version: 1 })).toBe(
      "20261014_101500_abc123_2026-10-14.pdf",
    );
    // "A/B: 7?" → "A_B_ 7_" and the date: runs of _ collapse to one
    expect(sessionReportFileName({ ...base, camelId: "A/B: 7?", version: 1 })).toBe(
      "A_B_ 7_2026-10-14.pdf",
    );
  });

  it("a comparison: by UI language, with the number of camels", () => {
    const createdAt = localIso(2026, 10, 17);
    expect(comparisonReportFileName({ members: 3, createdAt, version: 1, lang: "ar" })).toBe(
      "مقارنة_3_2026-10-17.pdf",
    );
    expect(comparisonReportFileName({ members: 3, createdAt, version: 1, lang: "en" })).toBe(
      "comparison_3_camels_2026-10-17.pdf",
    );
    expect(comparisonReportFileName({ members: 12, createdAt, version: 2, lang: "en" })).toBe(
      "comparison_12_camels_2026-10-17_v2.pdf",
    );
  });
});
