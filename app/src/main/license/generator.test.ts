// The real generator (tools/generate-license.mjs) against the real verifier: --init, --days,
// --expires, --customer, and its refusals. Temp key folder and a temp --public-key-out, so the
// committed app/src/main/license/publicKey.ts is never touched (asserted at the end).
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyLicenseKey } from "./verify";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(here, "..", "..", "..", "..");
const tool = path.join(repoDir, "tools", "generate-license.mjs");
const bakedFile = path.join(here, "publicKey.ts");
const sha = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

let work: string;
let keyDir: string;
let publicKeyOut: string;
let bakedBefore: string;

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [tool, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

function withKeys(...args: string[]) {
  return run(...args, "--key-dir", keyDir, "--public-key-out", publicKeyOut);
}

function publicKey() {
  return createPublicKey(readFileSync(path.join(keyDir, "public-key.pem")));
}

beforeAll(() => {
  bakedBefore = sha(bakedFile);
  work = mkdtempSync(path.join(tmpdir(), "nazeer-generator-"));
  keyDir = path.join(work, "keys");
  publicKeyOut = path.join(work, "publicKey.ts");
  const init = withKeys("--init");
  expect(init.code, init.stderr).toBe(0);
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
  // the committed baked key is never rewritten by the tests
  expect(sha(bakedFile)).toBe(bakedBefore);
});

describe("generate-license.mjs", () => {
  it("--init writes the key pair and the app's public-key module, never key text", () => {
    expect(readdirSync(keyDir).sort()).toEqual(["public-key.pem", "signing-key.pem"]);
    const module = readFileSync(publicKeyOut, "utf8");
    expect(module).toContain('"-----BEGIN PUBLIC KEY-----",');
    expect(module).toMatch(/LICENSE_KEY_ID: string \| null = "[0-9a-f]{16}";/);
    const again = withKeys("--init");
    expect(again.code).toBe(2);
    expect(again.stderr).toContain("already exists");
  });

  it("--days 1 makes a trial that verifies now and is expired after 24 h", () => {
    const issued = withKeys("--days", "1");
    expect(issued.code, issued.stderr).toBe(0);
    expect(issued.stdout).toMatch(/^NZL1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(`${issued.stdout}\n${issued.stderr}`).not.toContain("PRIVATE KEY");
    const now = new Date();
    const ok = verifyLicenseKey(issued.stdout, publicKey(), now);
    expect(ok).toMatchObject({ ok: true, license: { kind: "trial", customer: null } });
    const expires = ok.ok ? Date.parse(ok.license.expires!) : 0;
    expect(Math.abs(expires - now.getTime() - 24 * 3600_000)).toBeLessThan(60_000);
    const tomorrow = new Date(now.getTime() + 24 * 3600_000 + 60_000);
    expect(verifyLicenseKey(issued.stdout, publicKey(), tomorrow)).toMatchObject({
      ok: false,
      reason: "expired",
    });
    const log = readFileSync(path.join(keyDir, "issued.log"), "utf8");
    expect(log).toContain('"kind":"trial"');
    expect(log).not.toContain(issued.stdout);
  });

  it("--expires in the past makes a key that is already expired (the 'tomorrow' case today)", () => {
    const issued = withKeys("--expires", "2026-01-01T00:00:00Z");
    expect(issued.code, issued.stderr).toBe(0);
    expect(issued.stderr).toContain("already expired");
    expect(verifyLicenseKey(issued.stdout, publicKey(), new Date())).toMatchObject({
      ok: false,
      reason: "expired",
      license: { expires: "2026-01-01T00:00:00Z" },
    });
  });

  it("--customer alone makes a permanent key, Arabic names included", () => {
    for (const name of ["Al Dhafra Festival", "مهرجان الظفرة"]) {
      const issued = withKeys("--customer", name);
      expect(issued.code, issued.stderr).toBe(0);
      expect(
        verifyLicenseKey(issued.stdout, publicKey(), new Date("9999-01-01T00:00:00Z")),
      ).toMatchObject({
        ok: true,
        license: { kind: "permanent", customer: name, expires: null },
      });
    }
  });

  it.each([
    [["--days", "0"], "--days"],
    [["--days", "3651"], "--days"],
    [["--days", "1.5"], "--days"],
    [["--days", "1", "--expires", "2027-01-01T00:00:00Z"], "not both"],
    [["--expires", "2027-01-01T00:00:00"], "time zone"],
    [["--expires", "2026-02-30T00:00:00Z"], "not a real date"],
    [["--expires", "2026-10-13T24:00:00+03:00"], "not a real date"],
    [["--expires", "2026-10-13"], "time zone"],
    [["--customer", " padded"], "--customer"],
    [[], "nothing to issue"],
    [["--wat"], "unknown argument"],
  ])("refuses %j", (args, message) => {
    const result = withKeys(...args);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
  });

  it("refuses a key folder inside a git work tree", () => {
    const inside = path.join(repoDir, "app", "nazeer-test-keys");
    const result = run("--init", "--key-dir", inside, "--public-key-out", publicKeyOut);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("git work tree");
    expect(existsSync(inside)).toBe(false);
  });

  it("refuses to issue against an app whose baked key is another one", () => {
    const otherOut = path.join(work, "otherKey.ts");
    const otherKeys = path.join(work, "other-keys");
    expect(run("--init", "--key-dir", otherKeys, "--public-key-out", otherOut).code).toBe(0);
    const result = run("--days", "1", "--key-dir", keyDir, "--public-key-out", otherOut);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("is not the one baked");
    writeFileSync(otherOut, "export const LICENSE_PUBLIC_KEY_PEM: string | null = null;\n");
    const none = run("--days", "1", "--key-dir", keyDir, "--public-key-out", otherOut);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("holds no public key");
  });

  it("--init --force keeps the old pair as a backup", () => {
    const result = withKeys("--init", "--force");
    expect(result.code, result.stderr).toBe(0);
    const files = readdirSync(keyDir);
    expect(files.filter((f) => f.includes(".backup-"))).toHaveLength(2);
    expect(files).toContain("signing-key.pem");
  });
});
