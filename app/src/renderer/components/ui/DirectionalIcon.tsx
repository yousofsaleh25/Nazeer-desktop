/**
 * An icon that points somewhere (arrows, chevrons, "next"): drawn for left-to-right and mirrored
 * in right-to-left. Icons without a direction (search, trash, camera) are used as they are.
 */
import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "@/lib/cn";

export interface DirectionalIconProps extends LucideProps {
  icon: LucideIcon;
}

export function DirectionalIcon({ icon: Icon, className, ...props }: DirectionalIconProps) {
  return <Icon aria-hidden="true" className={cn("rtl:-scale-x-100", className)} {...props} />;
}
