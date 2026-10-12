import { describe, expect, it } from "vitest";
import { ITEMS, verdicts, wsbConfig } from "./sandbox-check.mjs";

const base = {
  io: String.raw`E:\repo\runs\sandbox_check_x\full\io`,
  installer: String.raw`E:\repo\app\release\Nazeer Desktop Setup 0.1.0.exe`,
  node: String.raw`C:\Program Files\nodejs`,
  playwright: String.raw`E:\repo\app\node_modules\playwright-core`,
  scripts: String.raw`E:\repo\app\scripts\sandbox`,
  bag: String.raw`E:\repo\data\.bag\20260414_180708-004.bag`,
};

describe("the Windows Sandbox configuration", () => {
  it("maps the run's io folder read-write and everything else read-only", () => {
    const config = wsbConfig({ ...base, mode: "full" });
    expect(config).toContain(
      String.raw`<HostFolder>E:\repo\runs\sandbox_check_x\full\io</HostFolder><SandboxFolder>C:\nz\io</SandboxFolder><ReadOnly>false</ReadOnly>`,
    );
    for (const inside of ["installer", "node", "pw", "scripts", "bags"]) {
      expect(config).toMatch(
        new RegExp(
          String.raw`<SandboxFolder>C:\\nz\\${inside}</SandboxFolder><ReadOnly>true</ReadOnly>`,
        ),
      );
    }
    expect(config).toContain("<Networking>Enable</Networking>");
    expect(config).toContain("<ClipboardRedirection>Disable</ClipboardRedirection>");
    expect(config).toContain(
      "-Mode full -InstallerName &quot;Nazeer Desktop Setup 0.1.0.exe&quot; -BagName &quot;20260414_180708-004.bag&quot;",
    );
  });

  it("the offline run has no network; no bag means no bag folder", () => {
    const config = wsbConfig({ ...base, mode: "offline", bag: null });
    expect(config).toContain("<Networking>Disable</Networking>");
    expect(config).not.toContain("C:\\nz\\bags");
    expect(config).not.toContain("-BagName");
  });

  it("escapes what XML would misread in a path", () => {
    const config = wsbConfig({ ...base, mode: "full", io: String.raw`E:\a&b<c>\io` });
    expect(config).toContain(String.raw`E:\a&amp;b&lt;c&gt;\io`);
  });
});

describe("the verdict per D11 item", () => {
  it("fails an item when any of its checks failed, passes it when all passed", () => {
    const out = verdicts([
      { item: "3", ok: true, name: "Activate", mode: "full", source: "peruser" },
      { item: "4", ok: true, name: "tampered", mode: "full", source: "peruser" },
      { item: "4", ok: false, name: "expired", mode: "offline", source: "peruser" },
      { item: "10", ok: null, name: "Windows N", mode: "full", source: "sandbox" },
      { item: "run", ok: false, name: "the run ended", mode: "full", source: "sandbox" },
    ]);
    expect(out["3"]?.status).toBe("pass");
    expect(out["4"]?.status).toBe("FAIL");
    expect(out["10"]?.status).toBe("noted");
    expect(out["9"]?.status).toBe("not run");
    expect(out["run"]?.status).toBe("FAIL");
    expect(Object.keys(ITEMS)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "bag",
    ]);
  });
});
