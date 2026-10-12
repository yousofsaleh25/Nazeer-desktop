#!/usr/bin/env node
// Packaging guards (D11). `node scripts/dist-checks.mjs` runs first in `npm run dist` (the licence
// key, before minutes of building); electron-builder runs `beforePack` from electron-builder.yml
// (the key again, out\ built for packaging, the engine staged), so packaging refuses even when
// electron-builder is started by hand. Each refusal names the command that fixes it.
import { createHash, createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BAKED_KEY = path.join(APP_DIR, "src", "main", "license", "publicKey.ts");
const VENDOR_PUBLIC_KEY = path.join(os.homedir(), ".nazeer-license", "public-key.pem");

export class DistRefusal extends Error {}

function keyId(pem) {
  const der = createPublicKey(pem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

/**
 * The licence public key baked into the app: present, consistent with its LICENSE_KEY_ID, and the
 * vendor's own when the vendor key folder is on this machine.
 */
export function checkLicenseKey({
  bakedFile = BAKED_KEY,
  vendorPublicKey = VENDOR_PUBLIC_KEY,
} = {}) {
  const text = readFileSync(bakedFile, "utf8");
  const pem =
    /"(-----BEGIN PUBLIC KEY-----)",\s*"([A-Za-z0-9+/=]+)",\s*"(-----END PUBLIC KEY-----)"/.exec(
      text,
    );
  if (pem === null) {
    throw new DistRefusal(
      `${bakedFile} holds no licence public key: run node tools/generate-license.mjs --init ` +
        "on the vendor's machine",
    );
  }
  const id = keyId(`${pem[1]}\n${pem[2]}\n${pem[3]}\n`);
  const declared = /LICENSE_KEY_ID: string \| null = "([0-9a-f]{16})"/.exec(text)?.[1];
  if (declared !== id) {
    throw new DistRefusal(`${bakedFile}: LICENSE_KEY_ID ${declared} is not its key's id (${id})`);
  }
  if (!existsSync(vendorPublicKey)) return { id, vendor: "not on this machine" };
  const vendor = keyId(readFileSync(vendorPublicKey, "utf8"));
  if (vendor !== id) {
    throw new DistRefusal(
      `the baked licence key ${id} is not the vendor key ${vendor} in ` +
        `${path.dirname(vendorPublicKey)}: keys issued there would not verify in this build`,
    );
  }
  return { id, vendor: "matches" };
}

/** out\ was built for packaging: `isDistBuild()` compiled to `return true` (NAZEER_DIST=1). */
export function checkDistBuild(mainBundle = path.join(APP_DIR, "out", "main", "index.js")) {
  if (!existsSync(mainBundle)) throw new DistRefusal(`${mainBundle} is missing: run npm run dist`);
  const match = /function isDistBuild\(\) \{\s*return (true|false);\s*\}/.exec(
    readFileSync(mainBundle, "utf8"),
  );
  if (match === null) {
    throw new DistRefusal(`cannot tell whether ${mainBundle} was built for packaging`);
  }
  if (match[1] !== "true") {
    throw new DistRefusal(
      `${mainBundle} is a development build (licence optional, development switches honoured ` +
        "when the executable is renamed): package with npm run dist",
    );
  }
}

/** dist-engine\ was staged by scripts/stage-engine.mjs: its manifest and key files exist. */
export function checkStagedEngine(dir = path.join(APP_DIR, "dist-engine")) {
  const manifestFile = path.join(dir, "bundle-manifest.json");
  if (!existsSync(manifestFile)) {
    throw new DistRefusal(`${dir} is not a staged engine: run npm run stage:engine`);
  }
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const required = [
    path.join("python", "python.exe"),
    path.join("python", "python311._pth"),
    path.join("nazeer_engine", "__main__.py"),
    manifest.model?.file ?? path.join("models", "best.pt"),
  ];
  for (const rel of required) {
    if (!existsSync(path.join(dir, rel))) throw new DistRefusal(`${dir}: ${rel} is missing`);
  }
  return manifest;
}

/** electron-builder's beforePack hook (electron-builder.yml). */
export async function beforePack() {
  const key = checkLicenseKey();
  checkDistBuild();
  const manifest = checkStagedEngine();
  console.log(
    `  • dist checks  licence key ${key.id} (vendor key folder: ${key.vendor}); out\\ built ` +
      `for packaging; engine staged ${manifest.stagedAt}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const key = checkLicenseKey();
    console.log(`dist-checks: licence public key ${key.id} (vendor key folder: ${key.vendor})`);
  } catch (error) {
    console.error(`dist-checks: ${error instanceof DistRefusal ? error.message : error}`);
    process.exitCode = 2;
  }
}
