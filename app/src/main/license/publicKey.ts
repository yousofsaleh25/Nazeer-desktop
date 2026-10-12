/**
 * The licence public key baked into the app (D11). This file is written by
 * `node tools/generate-license.mjs --init`; do not edit it by hand. null = no key yet: packaging
 * refuses to build without one, and a development build that requires a licence reports
 * `license_not_configured`.
 */
export const LICENSE_PUBLIC_KEY_PEM: string | null = [
  "-----BEGIN PUBLIC KEY-----",
  "MCowBQYDK2VwAyEAztcyMN7tooCIwkURNKXqjtlpDRFPXKfxm9rWuz+ZT1U=",
  "-----END PUBLIC KEY-----",
].join("\n");

/** sha256 of the DER public key (first 16 hex), shown by the generator and About. */
export const LICENSE_KEY_ID: string | null = "2f8696292b9d9ec0";
