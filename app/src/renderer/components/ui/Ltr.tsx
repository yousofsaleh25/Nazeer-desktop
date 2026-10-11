/** Left-to-right isolates for numbers, units, ids and paths inside right-to-left text. */
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

/** U+00A0, built here: invisible characters are never typed into source (no-invisible test). */
export const NBSP = String.fromCharCode(0xa0);

export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}

/**
 * A file path, left to right, with every folder and file name in its own isolate. Without them an
 * Arabic folder name ("D:\captures\اختبار\20260414_181203-007.bag", realistic on the camera
 * laptop) turns the digits after it into an Arabic run and the path reads in the wrong order.
 * The full path is the tooltip, so a truncated path stays readable.
 */
export function PathText({ path, className }: { path: string; className?: string }) {
  const parts = path.split(/([\\/])/);
  return (
    <bdi dir="ltr" title={path} className={className}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Fragment key={index}>{part}</Fragment>
        ) : part === "" ? null : (
          <bdi key={index} dir="auto">
            {part}
          </bdi>
        ),
      )}
    </bdi>
  );
}

export interface NumProps {
  value: number | null | undefined;
  digits?: number;
  grouping?: boolean;
  /** already localized (an i18n unit string); follows the number in the surrounding direction */
  unit?: string;
  className?: string;
}

/**
 * A number with ASCII digits and fixed decimals in an LTR isolate (signs and decimal points never
 * reorder). The unit follows outside the isolate, in the surrounding direction, so Arabic reads
 * "1.930 م" right to left as the engine's own value texts do; a no-break space keeps them together.
 */
export function Num({ value, digits = 0, grouping = false, unit, className }: NumProps) {
  const text = formatNumber(value, { digits, grouping });
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <bdi dir="ltr" className="tabular-nums">
        {text}
      </bdi>
      {unit && text !== "--" ? NBSP + unit : null}
    </span>
  );
}
