import { describe, expect, it } from "vitest";
import { MAX_COMPARISON_APPROVALS, MAX_OVERLAY_BYTES } from "./ipc";
import {
  isAbsolutePathString,
  MAX_CAPTURE_FOLDERS,
  MAX_LICENSE_INPUT_CHARS,
  MAX_PREFLIGHT_PROBLEMS,
  MAX_SUGGESTED_NAME_CHARS,
  validateCaptureFolders,
  validateComparisonExportRequest,
  validateExportRequest,
  validateLicenseKeyInput,
  validateOpenSavedRequest,
  validatePreflight,
  validateQuitAck,
  validateSaveAsRequest,
  validateSavedCopyQuery,
  preflightOrRefusal,
} from "./ipcValidate";

describe("isAbsolutePathString", () => {
  it("accepts drive and UNC paths, including Arabic folder names", () => {
    expect(isAbsolutePathString(String.raw`D:\captures`)).toBe(true);
    expect(isAbsolutePathString("E:/camel_beauty/data")).toBe(true);
    expect(isAbsolutePathString(String.raw`D:\captures\اختبار`)).toBe(true);
    expect(isAbsolutePathString(String.raw`\\nas\share\bags`)).toBe(true);
  });

  it("refuses relative, drive-relative, empty, oversized, NUL and non-string values", () => {
    for (const value of [
      "captures",
      String.raw`\captures`,
      "/captures",
      "C:captures",
      "",
      `C:\\${"a".repeat(1100)}`,
      "C:\\a\0b",
      42,
      null,
      undefined,
      ["C:\\a"],
    ]) {
      expect(isAbsolutePathString(value), String(value)).toBe(false);
    }
  });
});

describe("validateCaptureFolders", () => {
  it("returns the folders, dropping case-insensitive duplicates in order", () => {
    expect(
      validateCaptureFolders([String.raw`D:\Captures`, String.raw`d:\captures`, "E:\\x"]),
    ).toEqual([String.raw`D:\Captures`, "E:\\x"]);
  });

  it("refuses a non-array, too many folders and any bad entry", () => {
    expect(() => validateCaptureFolders("D:\\captures")).toThrow();
    expect(() =>
      validateCaptureFolders(
        Array.from({ length: MAX_CAPTURE_FOLDERS + 1 }, (_, i) => `D:\\f${i}`),
      ),
    ).toThrow();
    expect(() => validateCaptureFolders(["D:\\ok", "relative"])).toThrow();
  });
});

describe("validateLicenseKeyInput", () => {
  it("accepts a string up to 4096 characters (main normalises and verifies it)", () => {
    const pasted = "  NZL1.a.b\n";
    expect(validateLicenseKeyInput(pasted)).toBe(pasted);
    expect(validateLicenseKeyInput("k".repeat(MAX_LICENSE_INPUT_CHARS))).toHaveLength(4096);
  });

  it("refuses anything else", () => {
    for (const value of [null, 42, ["NZL1"], { key: "NZL1" }, "k".repeat(4097)]) {
      expect(() => validateLicenseKeyInput(value), JSON.stringify(value).slice(0, 20)).toThrow();
    }
  });
});

describe("validateQuitAck", () => {
  it("accepts exactly {requestId, unsaved}", () => {
    expect(validateQuitAck({ requestId: 3, unsaved: false })).toEqual({
      requestId: 3,
      unsaved: false,
    });
  });

  it("refuses anything else", () => {
    for (const value of [
      null,
      [],
      { requestId: 0, unsaved: false },
      { requestId: 1.5, unsaved: false },
      { requestId: "1", unsaved: false },
      { requestId: 1, unsaved: "no" },
      { requestId: 1, unsaved: false, extra: true },
    ]) {
      expect(() => validateQuitAck(value), JSON.stringify(value)).toThrow();
    }
  });
});

describe("validateExportRequest", () => {
  const good = () => ({
    sessionId: "20261011_152956_e20a7c",
    overlay: { version: 1, sha256: "a".repeat(64), bytes: new Uint8Array([137, 80, 78, 71]) },
    reportModel: { version: 2, sha256: "b".repeat(64) },
  });

  it("accepts a session id, the approved overlay bytes and the report model it names", () => {
    const request = validateExportRequest(good());
    expect(request.sessionId).toBe("20261011_152956_e20a7c");
    expect(request.overlay.bytes).toBeInstanceOf(Uint8Array);
    expect(request.reportModel).toEqual({ version: 2, sha256: "b".repeat(64) });
  });

  it("refuses anything else", () => {
    const bad: unknown[] = [
      null,
      "x",
      { ...good(), extra: 1 },
      { ...good(), sessionId: "../../etc" },
      { ...good(), overlay: { ...good().overlay, bytes: new Uint8Array() } },
      { ...good(), overlay: { ...good().overlay, bytes: [1, 2, 3] } },
      { ...good(), overlay: { ...good().overlay, sha256: "A".repeat(64) } },
      { ...good(), overlay: { ...good().overlay, version: 0 } },
      { ...good(), overlay: { ...good().overlay, version: 1.5 } },
      { ...good(), overlay: { ...good().overlay, url: "x" } },
      { ...good(), reportModel: { version: 1 } },
      { ...good(), reportModel: { version: 1, sha256: "b".repeat(63) } },
    ];
    for (const value of bad) expect(() => validateExportRequest(value)).toThrow();
  });

  it("refuses an overlay larger than 32 MiB", () => {
    const big = {
      ...good(),
      overlay: { ...good().overlay, bytes: new Uint8Array(MAX_OVERLAY_BYTES + 1) },
    };
    expect(() => validateExportRequest(big)).toThrow(/larger than/);
  });
});

describe("preflightOrRefusal", () => {
  const checked = { requiredTexts: 600, textNodes: 10, characters: 200, images: 2 };

  it("passes a valid result on as it is", () => {
    const result = { ok: true, problems: [], warnings: [], checked };
    expect(preflightOrRefusal(result)).toEqual(result);
  });

  it("turns a result main refuses into a failed print with the reason, at once", () => {
    const missing = Array.from({ length: MAX_PREFLIGHT_PROBLEMS + 1 }, (_, i) => ({
      code: "print_required_text_missing",
      message: `name ${i} is not on the page`,
      details: {},
    }));
    const refused = preflightOrRefusal({ ok: false, problems: missing, warnings: [], checked });
    expect(refused.ok).toBe(false);
    expect(refused.problems).toHaveLength(1);
    expect(refused.problems[0]?.code).toBe("print_page_failed");
    expect(refused.problems[0]?.message).toContain(`at most ${MAX_PREFLIGHT_PROBLEMS}`);
    expect(preflightOrRefusal(null).problems[0]?.code).toBe("print_page_failed");
  });
});

describe("validatePreflight", () => {
  const checked = { requiredTexts: 3, textNodes: 10, characters: 200, images: 2 };
  const problem = { code: "print_glyph_missing", message: "m", details: { names: [] } };

  it("accepts the print page's result", () => {
    expect(validatePreflight({ ok: true, problems: [], warnings: [problem], checked })).toEqual({
      ok: true,
      problems: [],
      warnings: [problem],
      checked,
    });
    expect(validatePreflight({ ok: false, problems: [problem], warnings: [], checked }).ok).toBe(
      false,
    );
  });

  it("refuses a malformed result, and ok with problems", () => {
    const bad: unknown[] = [
      null,
      { ok: true, problems: [], warnings: [], checked: { ...checked, images: -1 } },
      { ok: true, problems: [problem], warnings: [], checked },
      { ok: "yes", problems: [], warnings: [], checked },
      { ok: false, problems: [{ ...problem, code: "Not A Code" }], warnings: [], checked },
      { ok: false, problems: [{ code: "x", message: "m" }], warnings: [], checked },
      { ok: false, problems: [], warnings: [], checked, extra: true },
      {
        ok: false,
        problems: Array.from({ length: MAX_PREFLIGHT_PROBLEMS + 1 }, () => problem),
        warnings: [],
        checked,
      },
      {
        ok: false,
        problems: [{ ...problem, details: { big: "x".repeat(70 * 1024) } }],
        warnings: [],
        checked,
      },
    ];
    for (const value of bad) expect(() => validatePreflight(value)).toThrow();
  });
});

describe("report save-as payloads (D12)", () => {
  const ref = { kind: "session", id: "20261014_101500_abc123", version: 2 };

  it("accepts a session report, its version and a suggested file name", () => {
    expect(validateSaveAsRequest({ ...ref, suggestedName: "ناقة-7_2026-10-14_v2.pdf" })).toEqual({
      ...ref,
      suggestedName: "ناقة-7_2026-10-14_v2.pdf",
    });
    expect(validateSavedCopyQuery(ref)).toEqual(ref);
    expect(validateOpenSavedRequest({ ...ref, action: "show" })).toEqual({
      ...ref,
      action: "show",
    });
  });

  it("accepts a comparison's report too", () => {
    const comparison = { ...ref, kind: "comparison" };
    expect(validateSaveAsRequest({ ...comparison, suggestedName: "مقارنة_3.pdf" })).toEqual({
      ...comparison,
      suggestedName: "مقارنة_3.pdf",
    });
    expect(validateSavedCopyQuery(comparison)).toEqual(comparison);
  });

  it("refuses another kind, a bad id or version, extra fields and a bad name", () => {
    const name = { suggestedName: "a.pdf" };
    for (const value of [
      null,
      [],
      { ...ref },
      { ...ref, ...name, kind: "candidates" },
      { ...ref, ...name, id: "../../evil" },
      { ...ref, ...name, version: 0 },
      { ...ref, ...name, version: 1.5 },
      { ...ref, ...name, path: "C:\\x.pdf" },
      { ...ref, suggestedName: "" },
      { ...ref, suggestedName: "a".repeat(MAX_SUGGESTED_NAME_CHARS + 1) },
      { ...ref, suggestedName: "a\0b" },
      { ...ref, suggestedName: 7 },
    ]) {
      expect(() => validateSaveAsRequest(value), JSON.stringify(value)).toThrow();
    }
    expect(() => validateSavedCopyQuery({ ...ref, extra: 1 })).toThrow();
    expect(() => validateOpenSavedRequest({ ...ref, action: "delete" })).toThrow();
    expect(() => validateOpenSavedRequest({ ...ref, action: "open", path: "C:\\x" })).toThrow();
  });
});

describe("comparison export payloads (D12)", () => {
  const SHA = "a".repeat(64);
  const request = {
    comparisonId: "20261017_120000_abcdef",
    model: { version: 2, sha256: SHA },
    approvals: [{ sessionId: "20261017_100000_aaaaaa", overlayVersion: 1, sha256: SHA }],
  };

  it("accepts the comparison, its model and the approvals (no bytes)", () => {
    expect(validateComparisonExportRequest(request)).toEqual(request);
    expect(validateComparisonExportRequest({ ...request, approvals: [] }).approvals).toEqual([]);
  });

  it("refuses bad ids, versions, digests, extra fields, duplicates and too many approvals", () => {
    const approval = request.approvals[0];
    const many = Array.from({ length: MAX_COMPARISON_APPROVALS + 1 }, (_, i) => ({
      ...approval,
      sessionId: `20261017_100000_${i.toString(16).padStart(6, "0")}`,
    }));
    for (const value of [
      null,
      { ...request, comparisonId: "../x" },
      { ...request, model: { version: 0, sha256: SHA } },
      { ...request, model: { version: 1, sha256: "ABC" } },
      { ...request, model: { version: 1, sha256: SHA, url: "/x" } },
      { ...request, extra: true },
      { ...request, approvals: "all" },
      { ...request, approvals: [{ ...approval, bytes: new Uint8Array(1) }] },
      { ...request, approvals: [{ ...approval, overlayVersion: -1 }] },
      { ...request, approvals: [{ ...approval, sessionId: "x" }] },
      { ...request, approvals: [approval, approval] },
      { ...request, approvals: many },
    ]) {
      expect(() => validateComparisonExportRequest(value), JSON.stringify(value)).toThrow();
    }
  });
});
