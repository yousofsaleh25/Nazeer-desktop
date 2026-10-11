/** An indeterminate activity indicator; announced only when it carries a label. */
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";

const SIZES = { sm: "size-3.5", md: "size-5", lg: "size-8" } as const;

export interface SpinnerProps {
  size?: keyof typeof SIZES;
  /** accessible text in the UI language; without it the spinner is decorative */
  label?: string;
  className?: string;
}

export function Spinner({ size = "md", label, className }: SpinnerProps) {
  const icon = (
    <LoaderCircle
      aria-hidden="true"
      className={cn("animate-spin text-current motion-reduce:animate-none", SIZES[size], className)}
    />
  );
  if (label === undefined) return icon;
  return (
    <span role="status" aria-label={label} className="inline-flex">
      {icon}
    </span>
  );
}
