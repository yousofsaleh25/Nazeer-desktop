import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = resolve(__dirname, "../..");

describe("engine error codes", () => {
  it("src/shared/engine-codes.json matches the engine source (npm run gen:codes)", () => {
    const out = execFileSync(process.execPath, ["scripts/gen-engine-codes.mjs", "--check"], {
      cwd: appDir,
      encoding: "utf8",
    });
    expect(out).toContain("up to date");
  }, 30_000);
});
