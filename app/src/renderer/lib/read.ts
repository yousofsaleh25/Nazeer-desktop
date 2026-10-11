/**
 * Readers for the engine objects the OpenAPI types as free dictionaries (frame.z_ref,
 * frame.ground, a candidate set's walk, a probe result, …). Each returns the value when it has the
 * expected type and null otherwise, so a missing or renamed field shows "--", never a crash or a
 * made-up number.
 */
import { isRecord } from "@/api/errors";

export { isRecord };

export function readNumber(obj: unknown, key: string): number | null {
  const value = isRecord(obj) ? obj[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readString(obj: unknown, key: string): string | null {
  const value = isRecord(obj) ? obj[key] : undefined;
  return typeof value === "string" ? value : null;
}

export function readBoolean(obj: unknown, key: string): boolean | null {
  const value = isRecord(obj) ? obj[key] : undefined;
  return typeof value === "boolean" ? value : null;
}

export function readRecord(obj: unknown, key: string): Record<string, unknown> | null {
  const value = isRecord(obj) ? obj[key] : undefined;
  return isRecord(value) ? value : null;
}

export function readArray(obj: unknown, key: string): unknown[] | null {
  const value = isRecord(obj) ? obj[key] : undefined;
  return Array.isArray(value) ? value : null;
}

export function readStrings(obj: unknown, key: string): string[] {
  return (readArray(obj, key) ?? []).filter((v): v is string => typeof v === "string");
}

/** An image point `[u, v]` with finite coordinates. */
export type Point = readonly [number, number];

export function asPoint(value: unknown): Point | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [u, v] = value as unknown[];
  return typeof u === "number" && typeof v === "number" && Number.isFinite(u) && Number.isFinite(v)
    ? [u, v]
    : null;
}

export function readPoint(obj: unknown, key: string): Point | null {
  return asPoint(isRecord(obj) ? obj[key] : undefined);
}

/** `[x0, y0, x1, y1]` with finite numbers. */
export function asBox(value: unknown): readonly [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const nums = value.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length === 4 ? [nums[0]!, nums[1]!, nums[2]!, nums[3]!] : null;
}
