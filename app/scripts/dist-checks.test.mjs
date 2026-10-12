import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkDistBuild, checkLicenseKey, checkStagedEngine, DistRefusal } from "./dist-checks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(os.tmpdir(), "nazeer-dist-checks-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

let counter = 0;
function file(name, text) {
  counter += 1;
  const target = path.join(work, `${counter}-${name}`);
  writeFileSync(target, text);
  return target;
}

function keyPair() {
  const { publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const der = publicKey.export({ type: "spki", format: "der" });
  return { pem, id: createHash("sha256").update(der).digest("hex").slice(0, 16) };
}

/** The module tools/generate-license.mjs writes. */
function bakedModule(pem, id) {
  const lines = pem
    .trim()
    .split(/\r?\n/)
    .map((line) => `  "${line}",`);
  return [
    "export const LICENSE_PUBLIC_KEY_PEM: string | null = [",
    ...lines,
    '].join("\\n");',
    "",
    `export const LICENSE_KEY_ID: string | null = "${id}";`,
    "",
  ].join("\n");
}

const missing = path.join(work, "no-such-folder", "public-key.pem");

describe("checkLicenseKey", () => {
  it("refuses an app without a baked key", () => {
    const bakedFile = file(
      "publicKey.ts",
      "export const LICENSE_PUBLIC_KEY_PEM: string | null = null;\n" +
        "export const LICENSE_KEY_ID: string | null = null;\n",
    );
    expect(() => checkLicenseKey({ bakedFile, vendorPublicKey: missing })).toThrow(
      /holds no licence public key: run node tools\/generate-license.mjs --init/,
    );
  });

  it("accepts a consistent key, and the vendor's own key folder when present", () => {
    const vendor = keyPair();
    const bakedFile = file("publicKey.ts", bakedModule(vendor.pem, vendor.id));
    expect(checkLicenseKey({ bakedFile, vendorPublicKey: missing })).toEqual({
      id: vendor.id,
      vendor: "not on this machine",
    });
    const vendorPublicKey = file("public-key.pem", vendor.pem);
    expect(checkLicenseKey({ bakedFile, vendorPublicKey })).toEqual({
      id: vendor.id,
      vendor: "matches",
    });
  });

  it("refuses a key that is not the vendor's, or a key id that is not its key's", () => {
    const vendor = keyPair();
    const other = keyPair();
    const bakedFile = file("publicKey.ts", bakedModule(other.pem, other.id));
    const vendorPublicKey = file("public-key.pem", vendor.pem);
    expect(() => checkLicenseKey({ bakedFile, vendorPublicKey })).toThrow(DistRefusal);
    expect(() => checkLicenseKey({ bakedFile, vendorPublicKey })).toThrow(/not the vendor key/);
    const wrongId = file("publicKey.ts", bakedModule(vendor.pem, other.id));
    expect(() => checkLicenseKey({ bakedFile: wrongId, vendorPublicKey: missing })).toThrow(
      /is not its key's id/,
    );
  });

  it("passes on the committed app key (its id is the one it declares)", () => {
    const bakedFile = path.join(here, "..", "src", "main", "license", "publicKey.ts");
    const declared = /LICENSE_KEY_ID: string \| null = "([0-9a-f]{16})"/.exec(
      readFileSync(bakedFile, "utf8"),
    )?.[1];
    expect(declared).toBeDefined();
    expect(checkLicenseKey({ bakedFile, vendorPublicKey: missing }).id).toBe(declared);
  });
});

describe("checkDistBuild", () => {
  it("accepts out\\ built for packaging and refuses a development build", () => {
    expect(() =>
      checkDistBuild(file("index.js", "function isDistBuild() {\n  return true;\n}\n")),
    ).not.toThrow();
    expect(() =>
      checkDistBuild(file("index.js", "function isDistBuild() {\n  return false;\n}\n")),
    ).toThrow(/development build/);
  });

  it("refuses a missing or unrecognisable bundle", () => {
    expect(() => checkDistBuild(path.join(work, "absent.js"))).toThrow(/missing: run npm run dist/);
    expect(() => checkDistBuild(file("index.js", "console.log(1);\n"))).toThrow(/cannot tell/);
  });
});

describe("checkStagedEngine", () => {
  function stage(files) {
    counter += 1;
    const dir = path.join(work, `engine-${counter}`);
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), text);
    }
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  const complete = {
    "bundle-manifest.json": JSON.stringify({
      stagedAt: "2026-10-12T00:00:00Z",
      model: { file: "models/best.pt" },
    }),
    "python/python.exe": "",
    "python/python311._pth": "",
    "nazeer_engine/__main__.py": "",
    "models/best.pt": "",
  };

  it("accepts a staged engine and returns its manifest", () => {
    expect(checkStagedEngine(stage(complete)).stagedAt).toBe("2026-10-12T00:00:00Z");
  });

  it("refuses a folder without a manifest or with a file missing", () => {
    expect(() => checkStagedEngine(stage({ "python/python.exe": "" }))).toThrow(
      /not a staged engine: run npm run stage:engine/,
    );
    const noModel = { ...complete };
    delete noModel["models/best.pt"];
    expect(() => checkStagedEngine(stage(noModel))).toThrow(/best\.pt is missing/);
  });
});
