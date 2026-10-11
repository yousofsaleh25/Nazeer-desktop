/**
 * SHA-256 of bytes the app received (the overlay PNG before approval, the sealed PDF before
 * sign-off), with WebCrypto: the page is a secure context (app://nazeer, or localhost in dev).
 */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
