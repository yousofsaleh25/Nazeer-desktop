/**
 * The packaged renderer is served from app://nazeer/<path> (pure helpers; unit-tested): URL →
 * file under the renderer output folder, refusing anything that could leave it.
 */
import path from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "nazeer";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Map an app://nazeer URL to a file below `root`; null when malformed or escaping. */
export function resolveAppPath(root: string, rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return null;
  const segments = pathname.split("/").filter((s) => s.length > 0);
  // ".." could climb out, ":" could name a drive or an alternate data stream on Windows
  if (segments.length === 0 || segments.some((s) => s === "." || s === ".." || s.includes(":"))) {
    return null;
  }
  const base = path.resolve(root);
  const file = path.resolve(base, ...segments);
  const relative = path.relative(base, file);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return file;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

export function mimeType(file: string): string {
  return MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
