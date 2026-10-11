import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = resolve(__dirname, "../..");

describe("generated API types", () => {
  it("src/shared/api.d.ts matches engine/openapi.json (npm run gen:api)", () => {
    const out = execFileSync(process.execPath, ["scripts/gen-api.mjs", "--check"], {
      cwd: appDir,
      encoding: "utf8",
    });
    expect(out).toContain("up to date");
  }, 30_000);
});
