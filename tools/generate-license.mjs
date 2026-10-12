#!/usr/bin/env node
// Nazeer Desktop licence keys (D11). Run on the vendor's machine; never shipped with the app.
//
//   node tools/generate-license.mjs --init [--force]              create the signing key pair
//   node tools/generate-license.mjs --days <N> [--customer <name>] a trial key valid N x 24 h
//   node tools/generate-license.mjs --expires <instant> [...]      a trial key with that expiry
//   node tools/generate-license.mjs --customer <name>              a permanent key
//   options: --key-dir <dir>         default %USERPROFILE%\.nazeer-license
//            --public-key-out <file> default app/src/main/license/publicKey.ts (the baked key)
//
// A key is NZL1.<payload>.<signature> (base64url, no padding): Ed25519 over the ASCII bytes of
// "NZL1.<payload>", payload = {"v":1,"kind","customer","expires","issued"} (app/src/main/license/
// verify.ts checks it). The private key stays in the key folder, which must not be inside any git
// work tree, nor under OneDrive, Desktop or Documents; no private key text is ever printed. Every
// issued key adds a line to issued.log in the key folder (its fingerprint, not the key).
// Exit codes: 0 done, 2 refused or bad arguments, 1 unexpected failure.
import { execFileSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_KEY_DIR = path.join(os.homedir(), ".nazeer-license");
const DEFAULT_PUBLIC_KEY_OUT = path.join(REPO_DIR, "app", "src", "main", "license", "publicKey.ts");
const PRIVATE_FILE = "signing-key.pem";
const PUBLIC_FILE = "public-key.pem";
const LOG_FILE = "issued.log";
const PREFIX = "NZL1";
const MAX_DAYS = 3650;
const MAX_CUSTOMER_CHARS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const FORBIDDEN_SEGMENTS = new Set(["desktop", "documents", "onedrive"]);
const ONEDRIVE_VARS = ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"];
const char = (code) => String.fromCharCode(code);
// control characters and the bidi embedding / override / isolate controls (as verify.ts)
const FORBIDDEN_IN_NAME = new RegExp(
  `[\\p{Cc}${char(0x202a)}-${char(0x202e)}${char(0x2066)}-${char(0x2069)}]`,
  "u",
);

const USAGE = `usage:
  node tools/generate-license.mjs --init [--force] [--key-dir <dir>] [--public-key-out <file>]
  node tools/generate-license.mjs --days <N> [--customer <name>] [--key-dir <dir>]
  node tools/generate-license.mjs --expires <YYYY-MM-DDTHH:MM:SSZ> [--customer <name>]
  node tools/generate-license.mjs --customer <name>          (permanent key)`;

class Refusal extends Error {}

function parseArgs(argv) {
  const opts = {
    init: false,
    force: false,
    keyDir: DEFAULT_KEY_DIR,
    publicKeyOut: DEFAULT_PUBLIC_KEY_OUT,
    days: null,
    expires: null,
    customer: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined) throw new Refusal(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === "--init") opts.init = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--key-dir") opts.keyDir = path.resolve(value());
    else if (arg === "--public-key-out") opts.publicKeyOut = path.resolve(value());
    else if (arg === "--days") opts.days = value();
    else if (arg === "--expires") opts.expires = value();
    else if (arg === "--customer") opts.customer = value();
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Refusal(`unknown argument ${arg}`);
  }
  return opts;
}

function nearestExisting(dir) {
  let current = path.resolve(dir);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

/** The git work tree (a folder holding .git) that contains `dir`, or null. */
function gitWorkTreeOf(dir) {
  let current = realpathSync.native(nearestExisting(dir));
  for (;;) {
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isUnder(child, parent) {
  const relative = path.relative(parent.toLowerCase(), child.toLowerCase());
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Refuse folders where a private key must not live. */
function checkKeyDir(dir) {
  const repo = gitWorkTreeOf(dir);
  if (repo !== null) {
    throw new Refusal(
      `refusing ${dir}: it is inside the git work tree ${repo} (the private key must stay off any repository)`,
    );
  }
  const resolved = realpathSync.native(nearestExisting(dir));
  const segment = resolved.split(/[\\/]+/).find((s) => FORBIDDEN_SEGMENTS.has(s.toLowerCase()));
  if (segment !== undefined) {
    throw new Refusal(`refusing ${dir}: it is under a ${segment} folder (synced or shared)`);
  }
  for (const name of ONEDRIVE_VARS) {
    const root = process.env[name];
    if (root && isUnder(resolved, path.resolve(root))) {
      throw new Refusal(`refusing ${dir}: it is under %${name}% (synced to the cloud)`);
    }
  }
}

/** Owner-only access to the key folder (Windows ACL); best effort, reported. */
function restrictAcl(dir) {
  if (process.platform !== "win32") return "not changed (not Windows)";
  const user = process.env.USERDOMAIN
    ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
    : process.env.USERNAME;
  try {
    execFileSync("icacls", [dir, "/inheritance:r", "/grant:r", `${user}:(OI)(CI)F`], {
      stdio: "ignore",
      windowsHide: true,
    });
    return `owner only (${user})`;
  } catch (error) {
    return `NOT restricted (${error.message.split("\n")[0]})`;
  }
}

function utcStamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function isoSeconds(ms) {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** First 16 hex of the SHA-256 of the DER public key: the key id. */
function publicKeyId(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

function publicKeyModule(pem, keyId) {
  const lines = pem
    .trim()
    .split(/\r?\n/)
    .map((line) => `  "${line}",`);
  return [
    "/**",
    " * The licence public key baked into the app (D11). This file is written by",
    " * `node tools/generate-license.mjs --init`; do not edit it by hand. null = no key yet: packaging",
    " * refuses to build without one, and a development build that requires a licence reports",
    " * `license_not_configured`.",
    " */",
    "export const LICENSE_PUBLIC_KEY_PEM: string | null = [",
    ...lines,
    '].join("\\n");',
    "",
    "/** sha256 of the DER public key (first 16 hex), shown by the generator and About. */",
    `export const LICENSE_KEY_ID: string | null = "${keyId}";`,
    "",
  ].join("\n");
}

/** The PEM baked into the app's public-key module, or null when it has none yet. */
function readBakedPem(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const match =
    /"(-----BEGIN PUBLIC KEY-----)",\s*"([A-Za-z0-9+/=]+)",\s*"(-----END PUBLIC KEY-----)"/.exec(
      text,
    );
  return match === null ? null : `${match[1]}\n${match[2]}\n${match[3]}\n`;
}

function init(opts) {
  checkKeyDir(opts.keyDir);
  mkdirSync(opts.keyDir, { recursive: true });
  const privateFile = path.join(opts.keyDir, PRIVATE_FILE);
  const publicFile = path.join(opts.keyDir, PUBLIC_FILE);
  if (existsSync(privateFile) || existsSync(publicFile)) {
    if (!opts.force) {
      throw new Refusal(
        `a key pair already exists in ${opts.keyDir}. --force keeps it as a timestamped backup and ` +
          "makes a new one; keys issued with the old one stop verifying once the app is rebuilt",
      );
    }
    const stamp = utcStamp();
    for (const file of [privateFile, publicFile]) {
      if (existsSync(file)) renameSync(file, `${file}.backup-${stamp}`);
    }
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(privateFile, privateKey.export({ type: "pkcs8", format: "pem" }), {
    flag: "wx",
    mode: 0o600,
  });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  writeFileSync(publicFile, publicPem, { flag: "wx" });
  const acl = restrictAcl(opts.keyDir);
  const keyId = publicKeyId(publicKey);
  writeFileSync(opts.publicKeyOut, publicKeyModule(publicPem, keyId), "utf8");
  process.stderr.write(
    [
      `key pair created in ${opts.keyDir} (access: ${acl})`,
      `public key written to ${opts.publicKeyOut}`,
      `key id ${keyId}`,
      "back up the key folder: without it no new keys can be issued for installed copies",
      "",
    ].join("\n"),
  );
  process.stdout.write(`${keyId}\n`);
}

function parseExpires(text) {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new Refusal(`--expires needs a time zone (Z or +hh:mm): ${text}`);
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Refusal(`--expires is not a date: ${text}`);
  return ms;
}

function checkCustomer(name) {
  const length = [...name].length;
  if (length === 0 || length > MAX_CUSTOMER_CHARS || name.trim() !== name) {
    throw new Refusal(`--customer must be 1-${MAX_CUSTOMER_CHARS} characters without outer spaces`);
  }
  if (FORBIDDEN_IN_NAME.test(name)) throw new Refusal("--customer contains control characters");
}

function issue(opts) {
  checkKeyDir(opts.keyDir);
  if (opts.days !== null && opts.expires !== null) {
    throw new Refusal("give --days or --expires, not both");
  }
  if (opts.days === null && opts.expires === null && opts.customer === null) {
    throw new Refusal("nothing to issue: give --days, --expires or --customer");
  }
  if (opts.customer !== null) checkCustomer(opts.customer);
  const privateFile = path.join(opts.keyDir, PRIVATE_FILE);
  if (!existsSync(privateFile)) {
    throw new Refusal(`no signing key in ${opts.keyDir}: run --init first`);
  }
  const privateKey = createPrivateKey(readFileSync(privateFile));
  const publicKey = createPublicKey(privateKey);
  const bakedPem = readBakedPem(opts.publicKeyOut);
  if (bakedPem === null) {
    throw new Refusal(`${opts.publicKeyOut} holds no public key: run --init`);
  }
  const baked = createPublicKey(bakedPem).export({ type: "spki", format: "der" });
  if (!baked.equals(publicKey.export({ type: "spki", format: "der" }))) {
    throw new Refusal(
      `the key in ${opts.keyDir} is not the one baked into ${opts.publicKeyOut}: keys signed with ` +
        "it would not verify in the app",
    );
  }

  const now = Date.now();
  let expiresMs = null;
  if (opts.days !== null) {
    if (!/^\d+$/.test(opts.days) || Number(opts.days) < 1 || Number(opts.days) > MAX_DAYS) {
      throw new Refusal(`--days must be a whole number from 1 to ${MAX_DAYS}`);
    }
    expiresMs = now + Number(opts.days) * DAY_MS;
  } else if (opts.expires !== null) {
    expiresMs = parseExpires(opts.expires);
  }
  const payload = {
    v: 1,
    kind: expiresMs === null ? "permanent" : "trial",
    customer: opts.customer,
    expires: expiresMs === null ? null : isoSeconds(expiresMs),
    issued: isoSeconds(now),
  };
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signedText = `${PREFIX}.${payloadPart}`;
  const signature = sign(null, Buffer.from(signedText, "ascii"), privateKey);
  if (!verify(null, Buffer.from(signedText, "ascii"), publicKey, signature)) {
    throw new Error("the new key does not verify with its own public key");
  }
  const key = `${signedText}.${signature.toString("base64url")}`;
  const fingerprint = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 16);
  appendFileSync(
    path.join(opts.keyDir, LOG_FILE),
    `${JSON.stringify({ ...payload, fingerprint, keyId: publicKeyId(publicKey) })}\n`,
    "utf8",
  );
  const lines = [
    `${payload.kind} key ${fingerprint}`,
    `customer: ${payload.customer ?? "-"}`,
    `issued:   ${payload.issued}`,
    `expires:  ${payload.expires ?? "never"}`,
  ];
  if (expiresMs !== null && expiresMs <= now) {
    lines.push("WARNING: this key is already expired (useful only to test the 'expired' message)");
  }
  process.stderr.write(`${lines.join("\n")}\n`);
  process.stdout.write(`${key}\n`);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    if (opts.init) init(opts);
    else issue(opts);
    return 0;
  } catch (error) {
    if (error instanceof Refusal) {
      process.stderr.write(`generate-license: ${error.message}\n${USAGE}\n`);
      return 2;
    }
    process.stderr.write(`generate-license: ${error instanceof Error ? error.stack : error}\n`);
    return 1;
  }
}

process.exitCode = main();
