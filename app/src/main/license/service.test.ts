import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LicenseService } from "./service";
import type { LicenseMarker, LicenseMarkerStore } from "./store";
import { KEY_PREFIX } from "./verify";

const vendor = generateKeyPairSync("ed25519");
const PEM = vendor.publicKey.export({ type: "spki", format: "pem" }).toString();
const T0 = new Date("2026-10-12T12:00:00Z");

function keyFor(payload: Record<string, unknown>): string {
  const signed = `${KEY_PREFIX}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  return `${signed}.${sign(null, Buffer.from(signed, "ascii"), vendor.privateKey).toString("base64url")}`;
}

const TRIAL = keyFor({
  v: 1,
  kind: "trial",
  customer: null,
  expires: "2026-10-13T12:00:00Z",
  issued: "2026-10-12T11:00:00Z",
});
const PERMANENT = keyFor({
  v: 1,
  kind: "permanent",
  customer: "Al Dhafra",
  expires: null,
  issued: "2026-10-12T11:00:00Z",
});

class MemoryStore implements LicenseMarkerStore {
  marker: LicenseMarker | null = null;
  failWrites = false;
  read(): LicenseMarker | null {
    return this.marker;
  }
  write(key: string, at: Date): void {
    if (this.failWrites) throw new Error("EPERM: operation not permitted");
    this.marker = { v: 1, key, activatedAt: at.toISOString() };
  }
}

function service(
  store: MemoryStore,
  now: Date = T0,
  options: { required?: boolean; pem?: string | null } = {},
) {
  return new LicenseService({
    required: options.required ?? true,
    publicKeyPem: options.pem === undefined ? PEM : options.pem,
    store,
    now: () => now,
  });
}

describe("LicenseService", () => {
  it("a development build without enforcement needs no licence", () => {
    expect(service(new MemoryStore(), T0, { required: false }).status()).toEqual({
      required: false,
      state: "active",
      reason: null,
      license: null,
      notSaved: false,
      configError: null,
    });
  });

  it("without a public key the build cannot activate anything", () => {
    for (const pem of [null, "not a pem"]) {
      const s = service(new MemoryStore(), T0, { pem });
      expect(s.status()).toMatchObject({
        state: "inactive",
        configError: "license_not_configured",
      });
      expect(s.activate(TRIAL)).toMatchObject({ accepted: false, reason: null });
    }
  });

  it("first start: inactive with no reason; a refused key stores nothing", () => {
    const store = new MemoryStore();
    const s = service(store);
    expect(s.status()).toMatchObject({ required: true, state: "inactive", reason: null });
    const refused = s.activate("hello");
    expect(refused).toMatchObject({ accepted: false, reason: "malformed", license: null });
    expect(refused.status.state).toBe("inactive");
    expect(store.marker).toBeNull();
  });

  it("a valid key is stored and makes the licence active", () => {
    const store = new MemoryStore();
    const result = service(store).activate(`  ${TRIAL}\n`);
    expect(result).toMatchObject({ accepted: true, reason: null });
    expect(result.status).toMatchObject({
      state: "active",
      notSaved: false,
      license: { kind: "trial" },
    });
    expect(store.marker?.key).toBe(TRIAL); // stored normalised
  });

  it("the stored key is verified again at every start: a trial that ran out is expired", () => {
    const store = new MemoryStore();
    service(store).activate(TRIAL);
    expect(service(store, new Date("2026-10-13T11:00:00Z")).status().state).toBe("active");
    const later = service(store, new Date("2026-10-14T09:00:00Z")).status();
    expect(later).toMatchObject({
      state: "inactive",
      reason: "expired",
      license: { expires: "2026-10-13T12:00:00Z" },
    });
  });

  it("an expired key is refused with its date; a refused key keeps the active one", () => {
    const store = new MemoryStore();
    const s = service(store, new Date("2026-10-14T09:00:00Z"));
    expect(s.activate(TRIAL)).toMatchObject({
      accepted: false,
      reason: "expired",
      license: { expires: "2026-10-13T12:00:00Z" },
    });
    s.activate(PERMANENT);
    expect(s.activate("NZL1.x.y")).toMatchObject({ accepted: false, status: { state: "active" } });
    expect(store.marker?.key).toBe(PERMANENT);
  });

  it("change key: a trial is replaced by a permanent key", () => {
    const store = new MemoryStore();
    const s = service(store);
    s.activate(TRIAL);
    const upgraded = s.activate(PERMANENT);
    expect(upgraded.status.license).toMatchObject({ kind: "permanent", customer: "Al Dhafra" });
    expect(store.marker?.key).toBe(PERMANENT);
  });

  it("a key that cannot be saved still activates this session, and the next start asks again", () => {
    const store = new MemoryStore();
    store.failWrites = true;
    const lines: string[] = [];
    const s = new LicenseService({
      required: true,
      publicKeyPem: PEM,
      store,
      now: () => T0,
      log: (line) => lines.push(line),
    });
    const result = s.activate(PERMANENT);
    expect(result).toMatchObject({ accepted: true, status: { state: "active", notSaved: true } });
    expect(lines.join("\n")).toContain("not saved");
    expect(service(store).status().state).toBe("inactive");
  });
});
