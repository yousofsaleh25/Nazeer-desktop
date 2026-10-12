/**
 * The licence gate in main (D11). `status()` re-verifies the stored key on every call, so an
 * expired trial is noticed at the next start; `activate()` verifies a pasted key and stores it.
 * A key that verifies but cannot be saved still activates this session (`notSaved`). Injectable
 * (public key, store, clock) and unit-tested; main starts the engine only once `status()` says
 * active.
 */
import type { KeyObject } from "node:crypto";
import type { ActivationResult, LicenseStatus } from "@shared/ipc";
import type { LicenseMarkerStore } from "./store";
import { loadPublicKey, normalizeKey, verifyLicenseKey } from "./verify";

export interface LicenseServiceOptions {
  /** production, or development with NAZEER_LICENSE_ENFORCE=1 */
  required: boolean;
  /** the baked key, or a development override; null when the build has none */
  publicKeyPem: string | null;
  store: LicenseMarkerStore;
  now?: () => Date;
  log?: (line: string) => void;
}

export class LicenseService {
  private readonly publicKey: KeyObject | null;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  /** a key accepted this session whose marker could not be written */
  private unsavedKey: string | null = null;

  constructor(private readonly options: LicenseServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => undefined);
    let key: KeyObject | null = null;
    if (options.publicKeyPem !== null) {
      try {
        key = loadPublicKey(options.publicKeyPem);
      } catch (error) {
        this.log(`licence: the public key cannot be loaded (${String(error)})`);
      }
    }
    this.publicKey = key;
  }

  status(): LicenseStatus {
    const base = { notSaved: false, configError: null } as const;
    if (!this.options.required) {
      return { ...base, required: false, state: "active", reason: null, license: null };
    }
    if (this.publicKey === null) {
      return {
        required: true,
        state: "inactive",
        reason: null,
        license: null,
        notSaved: false,
        configError: "license_not_configured",
      };
    }
    const stored = this.unsavedKey ?? this.options.store.read()?.key ?? null;
    if (stored === null) {
      return { ...base, required: true, state: "inactive", reason: null, license: null };
    }
    const check = verifyLicenseKey(stored, this.publicKey, this.now());
    if (check.ok) {
      return {
        ...base,
        required: true,
        state: "active",
        reason: null,
        license: check.license,
        notSaved: this.unsavedKey !== null,
      };
    }
    return {
      ...base,
      required: true,
      state: "inactive",
      reason: check.reason,
      license: check.license,
    };
  }

  activate(raw: string): ActivationResult {
    if (this.publicKey === null) {
      return {
        accepted: false,
        reason: null,
        detail: "this build has no licence public key",
        license: null,
        status: this.status(),
      };
    }
    const check = verifyLicenseKey(raw, this.publicKey, this.now());
    if (!check.ok) {
      this.log(`licence: key refused (${check.reason}: ${check.detail})`);
      return {
        accepted: false,
        reason: check.reason,
        detail: check.detail,
        license: check.license,
        status: this.status(),
      };
    }
    const key = normalizeKey(raw);
    try {
      this.options.store.write(key, this.now());
      this.unsavedKey = null;
    } catch (error) {
      this.unsavedKey = key;
      this.log(`licence: key accepted but not saved (${String(error)})`);
    }
    const { kind, fingerprint, expires } = check.license;
    this.log(`licence: ${kind} key ${fingerprint} activated (expires ${expires ?? "never"})`);
    return {
      accepted: true,
      reason: null,
      detail: "",
      license: check.license,
      status: this.status(),
    };
  }
}
