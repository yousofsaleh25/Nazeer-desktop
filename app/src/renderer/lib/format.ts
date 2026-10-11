/**
 * Numbers the app itself prints (counts, fractions, ETA). ASCII digits in every language, as the
 * engine's labels and the PDF use them; measurement values are never formatted here: the app
 * shows the engine's `presentation.value_text`.
 */

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(digits: number, grouping: boolean): Intl.NumberFormat {
  const key = `${digits}:${grouping}`;
  let f = formatters.get(key);
  if (f === undefined) {
    f = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: grouping,
    });
    formatters.set(key, f);
  }
  return f;
}

/** `--` for a missing or non-finite value (the engine's own placeholder). */
export function formatNumber(
  value: number | null | undefined,
  { digits = 0, grouping = false }: { digits?: number; grouping?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return formatter(digits, grouping).format(value);
}

export type ByteUnit = "b" | "kb" | "mb" | "gb";

/** A file size in binary units, as Windows Explorer shows it (the unit is labelled by i18n). */
export function byteSize(bytes: number): { value: number; digits: number; unit: ByteUnit } {
  const steps: [ByteUnit, number][] = [
    ["gb", 1024 ** 3],
    ["mb", 1024 ** 2],
    ["kb", 1024],
  ];
  for (const [unit, size] of steps) {
    if (bytes >= size) return { value: bytes / size, digits: unit === "kb" ? 0 : 2, unit };
  }
  return { value: bytes, digits: 0, unit: "b" };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * An engine timestamp (ISO 8601) as local `YYYY-MM-DD HH:MM`: ASCII digits and the same order in
 * both languages; `--` when it does not parse.
 */
export function formatDateTime(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  if (date === null || Number.isNaN(date.getTime())) return "--";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
