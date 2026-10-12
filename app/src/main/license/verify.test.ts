import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isIsoSeconds,
  KEY_PREFIX,
  keyFingerprint,
  loadPublicKey,
  MAX_KEY_CHARS,
  normalizeKey,
  verifyLicenseKey,
} from "./verify";

// the tests sign with their own minimal signer (independent of tools/generate-license.mjs, whose
// round trip with this verifier is tested in generator.test.ts)
const vendor = generateKeyPairSync("ed25519");
const stranger = generateKeyPairSync("ed25519");
const NOW = new Date("2026-10-12T12:00:00Z");
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const char = (code: number): string => String.fromCharCode(code);

function signText(text: string, key: KeyObject = vendor.privateKey): string {
  return sign(null, Buffer.from(text, "ascii"), key).toString("base64url");
}

function keyFor(payload: unknown, signer: KeyObject = vendor.privateKey): string {
  const signed = `${KEY_PREFIX}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  return `${signed}.${signText(signed, signer)}`;
}

function rawKey(payloadBytes: Buffer, prefix = KEY_PREFIX): string {
  const signed = `${prefix}.${payloadBytes.toString("base64url")}`;
  return `${signed}.${signText(signed)}`;
}

const trial = (expires = "2026-10-13T12:00:00Z", change: Record<string, unknown> = {}) => ({
  v: 1,
  kind: "trial",
  customer: null,
  expires,
  issued: "2026-10-12T11:00:00Z",
  ...change,
});

const permanent = (customer: unknown = "Al Dhafra Festival") => ({
  v: 1,
  kind: "permanent",
  customer,
  expires: null,
  issued: "2026-10-12T11:00:00Z",
});

const check = (key: string, now: Date = NOW) => verifyLicenseKey(key, vendor.publicKey, now);
const reason = (key: string, now: Date = NOW) => {
  const result = check(key, now);
  return result.ok ? "ok" : result.reason;
};

/** Replace one character inside one part of a key. */
function changeAt(key: string, part: 1 | 2, index: number, to: string): string {
  const parts = key.split(".");
  const segment = parts[part]!;
  parts[part] = segment.slice(0, index) + to + segment.slice(index + 1);
  return parts.join(".");
}

describe("a valid key", () => {
  it("a trial verifies until its expiry instant, then is expired with its date", () => {
    const key = keyFor(trial("2026-10-13T12:00:00Z"));
    const ok = check(key);
    expect(ok).toEqual({
      ok: true,
      license: {
        kind: "trial",
        customer: null,
        expires: "2026-10-13T12:00:00Z",
        issued: "2026-10-12T11:00:00Z",
        fingerprint: keyFingerprint(key),
      },
    });
    expect(reason(key, new Date("2026-10-13T11:59:59Z"))).toBe("ok");
    const late = check(key, new Date("2026-10-13T12:00:00Z"));
    expect(late).toMatchObject({ ok: false, reason: "expired" });
    expect(late.ok ? null : late.license?.expires).toBe("2026-10-13T12:00:00Z");
  });

  it("a --days 1 key works today and is rejected tomorrow", () => {
    const key = keyFor(
      trial(new Date(NOW.getTime() + 24 * 3600_000).toISOString().slice(0, 19) + "Z"),
    );
    expect(reason(key, NOW)).toBe("ok");
    expect(reason(key, new Date(NOW.getTime() + 24 * 3600_000 + 1000))).toBe("expired");
  });

  it("a key generated with an already-past date is expired, not malformed", () => {
    // the acceptance check's "rejected tomorrow": issued now, expiry yesterday
    const key = keyFor(trial("2026-10-11T12:00:00Z", { issued: "2026-10-12T11:59:00Z" }));
    expect(reason(key)).toBe("expired");
  });

  it("a permanent key never expires, Arabic customer names included", () => {
    const key = keyFor(permanent());
    expect(reason(key, NOW)).toBe("ok");
    expect(reason(key, new Date("9999-12-31T23:59:59Z"))).toBe("ok");
    const arabic = keyFor(permanent("مهرجان الظفرة"));
    expect(check(arabic)).toMatchObject({ ok: true, license: { customer: "مهرجان الظفرة" } });
  });

  it("whitespace, line breaks and the marks chat apps add when copying are ignored", () => {
    const key = keyFor(permanent());
    const marks = [0x200e, 0x200f, 0x061c, 0x200b, 0xfeff].map(char).join("");
    const pasted = `  ${key.slice(0, 40)}\r\n${key.slice(40, 90)}${marks}\t${key.slice(90)}\n`;
    expect(normalizeKey(pasted)).toBe(key);
    expect(reason(pasted)).toBe("ok");
  });
});

describe("a tampered key", () => {
  const key = keyFor(trial());
  const [, payloadPart, signaturePart] = key.split(".") as [string, string, string];

  it("one changed character in the payload is a bad signature", () => {
    const i = Math.floor(payloadPart.length / 2);
    const to = payloadPart[i] === "A" ? "B" : "A";
    expect(reason(changeAt(key, 1, i, to))).toBe("bad_signature");
  });

  it("one changed character in the middle of the signature is a bad signature", () => {
    const i = Math.floor(signaturePart.length / 2);
    const to = signaturePart[i] === "A" ? "B" : "A";
    expect(reason(changeAt(key, 2, i, to))).toBe("bad_signature");
  });

  it("a last character changed only in its padding bits is malformed (never accepted)", () => {
    const last = signaturePart.length - 1;
    const value = ALPHABET.indexOf(signaturePart[last]!);
    const samePrefixBits = ALPHABET[(value & 0b110000) | ((value & 0b001111) ^ 0b0001)]!;
    const changed = changeAt(key, 2, last, samePrefixBits);
    // Node's lenient decoder gives the same 64 bytes; only the canonical check notices
    expect(Buffer.from(changed.split(".")[2]!, "base64url")).toEqual(
      Buffer.from(signaturePart, "base64url"),
    );
    expect(reason(changed)).toBe("malformed");
  });

  it("every single-character substitution at every position is rejected", () => {
    const candidates = `${ALPHABET}.=+/!`;
    let tried = 0;
    for (let i = 0; i < key.length; i += 1) {
      for (const to of candidates) {
        if (to === key[i]) continue;
        const changed = key.slice(0, i) + to + key.slice(i + 1);
        const result = check(changed);
        expect(result.ok, `position ${i} -> ${to}`).toBe(false);
        tried += 1;
      }
    }
    expect(tried).toBeGreaterThan(key.length * 60);
  });

  it("a key signed by another key pair is a bad signature", () => {
    expect(reason(keyFor(trial(), stranger.privateKey))).toBe("bad_signature");
    expect(reason(keyFor(permanent(), stranger.privateKey))).toBe("bad_signature");
  });
});

describe("a malformed key", () => {
  const good = keyFor(trial());
  const [, payloadPart, signaturePart] = good.split(".") as [string, string, string];

  it.each([
    ["empty", ""],
    ["only spaces", "   \n "],
    ["junk", "hello"],
    ["the prefix alone", "NZL1"],
    ["two parts", `NZL1.${payloadPart}`],
    ["four parts", `${good}.AAAA`],
    ["another prefix", `NZL2.${payloadPart}.${signaturePart}`],
    ["empty parts", "NZL1.."],
    ["base64 padding", `${good}=`],
    [
      "a character outside base64url",
      `NZL1.${payloadPart}.${signaturePart.slice(0, 10)}*${signaturePart.slice(11)}`,
    ],
    [
      "standard base64 characters",
      `NZL1.${payloadPart}.${signaturePart.slice(0, 10)}+${signaturePart.slice(11)}`,
    ],
    ["a short signature", `NZL1.${payloadPart}.${signaturePart.slice(0, 40)}`],
    ["an oversized key", `NZL1.${"A".repeat(MAX_KEY_CHARS)}.${signaturePart}`],
  ])("%s", (_name, key) => {
    expect(reason(key)).toBe("malformed");
  });

  it("a validly signed payload that is not JSON, or not UTF-8, is malformed", () => {
    expect(reason(rawKey(Buffer.from("not json", "utf8")))).toBe("malformed");
    expect(reason(rawKey(Buffer.from([0xff, 0xfe, 0x7b, 0x7d])))).toBe("malformed");
  });

  it.each([
    ["an array", [1, 2]],
    ["a missing field", { v: 1, kind: "trial", customer: null, expires: "2026-10-13T12:00:00Z" }],
    ["an extra field", { ...trial(), hardware: "x" }],
    ["another version", trial(undefined, { v: 2 })],
    ["another kind", trial(undefined, { kind: "beta" })],
    ["a permanent key with an expiry", { ...permanent(), expires: "2026-10-13T12:00:00Z" }],
    ["a permanent key without a customer", permanent(null)],
    ["a trial without an expiry", trial(undefined, { expires: null })],
    ["an empty customer", permanent("")],
    ["a customer with outer spaces", permanent(" Al Dhafra")],
    ["a customer of 201 characters", permanent("x".repeat(201))],
    ["a customer with a control character", permanent(`Al${char(7)}Dhafra`)],
    ["a customer with a bidi override", permanent(`Al${char(0x202e)}Dhafra`)],
    ["a non-string customer", permanent(42)],
    ["30 February", trial("2026-02-30T00:00:00Z")],
    ["hour 24", trial("2026-10-13T24:00:00Z")],
    ["no time zone", trial("2026-10-13T12:00:00")],
    ["milliseconds", trial("2026-10-13T12:00:00.000Z")],
    ["a date without a time", trial("2026-10-13")],
    ["a bad issued date", trial(undefined, { issued: "yesterday" })],
  ])("a signed payload with %s is malformed", (_name, payload) => {
    expect(reason(keyFor(payload))).toBe("malformed");
  });
});

describe("helpers", () => {
  it("isIsoSeconds accepts real instants only", () => {
    expect(isIsoSeconds("2026-10-12T12:00:00Z")).toBe(true);
    expect(isIsoSeconds("2028-02-29T00:00:00Z")).toBe(true);
    for (const bad of ["2027-02-29T00:00:00Z", "2026-13-01T00:00:00Z", "2026-10-12 12:00:00Z", 5]) {
      expect(isIsoSeconds(bad), String(bad)).toBe(false);
    }
  });

  it("loadPublicKey takes an Ed25519 SPKI PEM and refuses other keys", () => {
    const pem = vendor.publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(loadPublicKey(pem).asymmetricKeyType).toBe("ed25519");
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    expect(() =>
      loadPublicKey(ec.publicKey.export({ type: "spki", format: "pem" }).toString()),
    ).toThrow(/not ed25519/);
    expect(() => loadPublicKey("not a key")).toThrow();
  });

  it("the fingerprint is the first 16 hex of the key's SHA-256", () => {
    expect(keyFingerprint("NZL1.a.b")).toMatch(/^[0-9a-f]{16}$/);
    expect(keyFingerprint("NZL1.a.b")).not.toBe(keyFingerprint("NZL1.a.c"));
  });
});
