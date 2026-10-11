/** Identifiers shared by main, the preloads and the renderer (mirrors the engine's rules). */

/** ids and revisions travel through JavaScript numbers and SQLite INTEGER (engine MAX_SAFE_INT). */
export const MAX_SAFE_INT = 2 ** 53 - 1;

/** `YYYYmmdd_HHMMSS_<6 hex>` (engine `session_schema.SESSION_ID_RE`). */
export const SESSION_ID_RE = /^\d{8}_\d{6}_[0-9a-f]{6}$/;

/** A lowercase SHA-256 digest as the engine stamps it. */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
