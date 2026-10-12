/**
 * The overlay bytes the app verified (finalize listener): kept outside Redux (bytes are not
 * serialisable) for the one session and overlay version the `report` slice names. The approval
 * screen shows exactly these bytes, and the print step (Stage 7) sends exactly these bytes, so
 * what the operator approved is what gets printed (D7).
 */
export interface VerifiedOverlay {
  sessionId: string;
  version: number;
  sha256: string;
  bytes: Uint8Array<ArrayBuffer>;
}

let kept: VerifiedOverlay | null = null;

export function keepVerifiedOverlay(overlay: VerifiedOverlay): void {
  kept = overlay;
}

/** The bytes verified for exactly this session, version and SHA-256; null otherwise. */
export function verifiedOverlay(
  sessionId: string,
  version: number,
  sha256: string,
): VerifiedOverlay | null {
  return kept !== null &&
    kept.sessionId === sessionId &&
    kept.version === version &&
    kept.sha256 === sha256
    ? kept
    : null;
}

/** Drop the kept bytes (only those of `sessionId` when given). */
export function forgetVerifiedOverlay(sessionId?: string): void {
  if (sessionId === undefined || kept?.sessionId === sessionId) kept = null;
}
