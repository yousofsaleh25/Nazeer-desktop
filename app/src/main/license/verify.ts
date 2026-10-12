/**
 * Offline licence keys (D11). A key is `NZL1.<payload>.<signature>`, both parts base64url without
 * padding; the signature is Ed25519 over the ASCII bytes of `NZL1.<payload>` — the exact text
 * that travels, so no JSON canonicalisation question exists. Pure; `now` is injected.
 *
 * Order (each step names the reason a key fails):
 *   normalise: drop whitespace and Unicode format characters (chat apps add LRM / RLM / ALM /
 *     zero-width spaces when a key is copied)
 *   malformed      length, three parts, the prefix, the base64url alphabet, canonical encoding
 *                  (Node's decoder is lenient: without the re-encode check a changed last
 *                  character can decode to the same bytes), a 64-byte signature
 *   bad_signature  Ed25519 verification fails
 *   malformed      the payload is not UTF-8 JSON with exactly the expected fields and dates
 *   expired        a trial whose expiry is now or earlier (the payload is returned for the date)
 * With the canonical check, any single changed character is rejected.
 */
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import type { LicenseInfo, LicenseKind, LicenseReason } from "@shared/ipc";

export const KEY_PREFIX = "NZL1";
export const MAX_KEY_CHARS = 2048;
export const MAX_CUSTOMER_CHARS = 200;
const SIGNATURE_BYTES = 64;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PAYLOAD_KEYS = ["customer", "expires", "issued", "kind", "v"];
// control characters and the bidi embedding / override / isolate controls (they could make a
// customer name display as something else)
const char = (code: number): string => String.fromCharCode(code);
const FORBIDDEN_IN_NAME = new RegExp(
  `[\\p{Cc}${char(0x202a)}-${char(0x202e)}${char(0x2066)}-${char(0x2069)}]`,
  "u",
);

export interface LicensePayload {
  v: 1;
  kind: LicenseKind;
  customer: string | null;
  expires: string | null;
  issued: string;
}

export type LicenseCheck =
  | { ok: true; license: LicenseInfo }
  | { ok: false; reason: LicenseReason; detail: string; license: LicenseInfo | null };

/** The key as the operator pasted it, without whitespace and invisible format characters. */
export function normalizeKey(raw: string): string {
  return raw.replace(/[\s\p{Cf}]/gu, "");
}

/** The SHA-256 of the normalised key, first 16 hex: a support reference that is not the key. */
export function keyFingerprint(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}

/** `YYYY-MM-DDTHH:MM:SSZ` that names a real instant (V8 silently rolls `2026-02-30` over). */
export function isIsoSeconds(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_SECONDS.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && `${new Date(time).toISOString().slice(0, 19)}Z` === value;
}

function decodeCanonical(segment: string): Buffer | null {
  if (!BASE64URL.test(segment)) return null;
  const bytes = Buffer.from(segment, "base64url");
  return bytes.toString("base64url") === segment ? bytes : null;
}

/** The payload's fields, or the reason it is not a licence payload. */
export function parsePayload(value: unknown): LicensePayload | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "payload is not an object";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== PAYLOAD_KEYS.length || keys.some((k, i) => k !== PAYLOAD_KEYS[i])) {
    return `payload fields must be exactly ${PAYLOAD_KEYS.join(", ")}`;
  }
  const { v, kind, customer, expires, issued } = record;
  if (v !== 1) return "unsupported payload version";
  if (kind !== "trial" && kind !== "permanent") return "kind must be trial or permanent";
  if (customer !== null) {
    if (typeof customer !== "string") return "customer must be a string or null";
    const length = [...customer].length;
    if (length === 0 || length > MAX_CUSTOMER_CHARS || customer.trim() !== customer) {
      return `customer must be 1-${MAX_CUSTOMER_CHARS} characters without outer spaces`;
    }
    if (FORBIDDEN_IN_NAME.test(customer)) return "customer contains control characters";
  }
  if (!isIsoSeconds(issued)) return "issued must be YYYY-MM-DDTHH:MM:SSZ";
  if (kind === "permanent") {
    if (expires !== null) return "a permanent key has no expiry";
    if (customer === null) return "a permanent key names its customer";
  } else if (!isIsoSeconds(expires)) {
    return "a trial key needs expires as YYYY-MM-DDTHH:MM:SSZ";
  }
  return {
    v: 1,
    kind,
    customer,
    expires,
    issued,
  };
}

/** Load the baked (or test) public key; throws unless it is an Ed25519 SPKI PEM. */
export function loadPublicKey(pem: string): KeyObject {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`the licence public key is ${key.asymmetricKeyType ?? "unknown"}, not ed25519`);
  }
  return key;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

export function verifyLicenseKey(raw: string, publicKey: KeyObject, now: Date): LicenseCheck {
  const malformed = (detail: string): LicenseCheck => ({
    ok: false,
    reason: "malformed",
    detail,
    license: null,
  });
  const key = normalizeKey(raw);
  if (key.length === 0) return malformed("the key is empty");
  if (key.length > MAX_KEY_CHARS) return malformed(`the key is longer than ${MAX_KEY_CHARS}`);
  const parts = key.split(".");
  if (parts.length !== 3) return malformed("a key has three parts separated by dots");
  const [prefix, payloadPart, signaturePart] = parts as [string, string, string];
  if (prefix !== KEY_PREFIX) return malformed(`the key does not start with ${KEY_PREFIX}.`);
  const payloadBytes = decodeCanonical(payloadPart);
  const signature = decodeCanonical(signaturePart);
  if (payloadBytes === null || signature === null) {
    return malformed("the key contains characters outside base64url, or a non-canonical part");
  }
  if (signature.length !== SIGNATURE_BYTES) {
    return malformed(`the signature is ${signature.length} bytes, not ${SIGNATURE_BYTES}`);
  }
  const signedText = Buffer.from(`${prefix}.${payloadPart}`, "ascii");
  if (!verify(null, signedText, publicKey, signature)) {
    return {
      ok: false,
      reason: "bad_signature",
      detail: "the signature does not verify",
      license: null,
    };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(utf8.decode(payloadBytes));
  } catch {
    return malformed("the signed payload is not UTF-8 JSON");
  }
  const payload = parsePayload(decoded);
  if (typeof payload === "string") return malformed(payload);
  const license: LicenseInfo = {
    kind: payload.kind,
    customer: payload.customer,
    expires: payload.expires,
    issued: payload.issued,
    fingerprint: keyFingerprint(key),
  };
  if (payload.expires !== null && Date.parse(payload.expires) <= now.getTime()) {
    return { ok: false, reason: "expired", detail: `expired at ${payload.expires}`, license };
  }
  return { ok: true, license };
}
