import { describe, expect, it } from "vitest";
import { checkDataRoot, chooseDataRoot, samePath } from "./dataRoot";

const base = {
  argv: [] as string[],
  env: {} as Record<string, string | undefined>,
  userData: String.raw`C:\Users\op\AppData\Roaming\Nazeer Desktop`,
  repoDir: String.raw`E:\camel_beauty\nazeer-desktop`,
};

describe("chooseDataRoot", () => {
  it("packaged: always userData, whatever the arguments or environment say", () => {
    expect(
      chooseDataRoot({
        ...base,
        production: true,
        argv: ["--data-root", "D:\\elsewhere"],
        env: { NAZEER_DATA_ROOT: "D:\\env" },
      }),
    ).toEqual({ path: base.userData, source: "userData" });
  });

  it("dev: --data-root (both spellings), then NAZEER_DATA_ROOT, then <repo>\\runs\\dev_root", () => {
    expect(
      chooseDataRoot({
        ...base,
        production: false,
        argv: ["electron", ".", "--data-root", "D:\\a"],
      }),
    ).toEqual({ path: "D:\\a", source: "argument" });
    expect(chooseDataRoot({ ...base, production: false, argv: ["--data-root=D:\\b"] })).toEqual({
      path: "D:\\b",
      source: "argument",
    });
    expect(
      chooseDataRoot({ ...base, production: false, env: { NAZEER_DATA_ROOT: "D:\\env" } }),
    ).toEqual({ path: "D:\\env", source: "env" });
    expect(chooseDataRoot({ ...base, production: false })).toEqual({
      path: String.raw`E:\camel_beauty\nazeer-desktop\runs\dev_root`,
      source: "default",
    });
  });
});

describe("checkDataRoot (mirrors engine settings.validate_data_root)", () => {
  it("accepts an absolute folder outside the forbidden places, Arabic names included", () => {
    expect(checkDataRoot(String.raw`E:\camel_beauty\nazeer-desktop\runs\dev_root`, {})).toBeNull();
    expect(checkDataRoot(String.raw`D:\بيانات\نظير`, {})).toBeNull();
    expect(checkDataRoot(String.raw`\\nas\share\nazeer`, {})).toBeNull();
  });

  it("refuses a relative or drive-relative path", () => {
    expect(checkDataRoot("runs\\dev_root", {})?.code).toBe("data_root_invalid");
    expect(checkDataRoot("\\runs\\dev_root", {})?.code).toBe("data_root_invalid");
  });

  it("refuses Desktop / Documents / OneDrive segments in any case", () => {
    for (const p of [
      String.raw`C:\Users\op\Desktop\nazeer`,
      String.raw`C:\Users\op\documents\nazeer`,
      String.raw`C:\Users\op\OneDrive\x`,
    ]) {
      const problem = checkDataRoot(p, {});
      expect(problem?.code, p).toBe("data_root_invalid");
      expect(problem?.details["segment"], p).toBeDefined();
    }
  });

  it("refuses a folder under %OneDrive% / %OneDriveCommercial%, even with another name", () => {
    const env = { OneDriveCommercial: String.raw`C:\Users\op\Contoso Files` };
    const problem = checkDataRoot(String.raw`c:\users\op\contoso files\nazeer`, env);
    expect(problem).toMatchObject({
      code: "data_root_invalid",
      details: { env: "OneDriveCommercial" },
    });
    expect(checkDataRoot(String.raw`C:\Users\op\Contoso`, env)).toBeNull();
  });
});

describe("samePath", () => {
  it("ignores case, separators and a trailing slash", () => {
    expect(samePath("E:\\Camel\\Runs\\", "e:/camel/runs")).toBe(true);
    expect(samePath("E:\\camel\\runs", "E:\\camel\\runs2")).toBe(false);
  });
});
