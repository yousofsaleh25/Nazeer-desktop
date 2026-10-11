/**
 * Buttons. Every variant meets the 32 px hit target; `loading` keeps the label (so the button does
 * not change width), shows a spinner and blocks clicks. IconButton requires a label: it becomes
 * the accessible name and the tooltip.
 */
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,filter] duration-(--nz-duration-fast) ease-standard",
    "disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active",
        secondary:
          "border border-border-control bg-surface text-ink hover:bg-surface-hover active:bg-surface-sunken",
        ghost: "text-ink hover:bg-surface-hover active:bg-surface-sunken",
        danger: "bg-danger text-danger-fg hover:brightness-95 active:brightness-90",
        link: "min-h-0 px-0 text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        sm: "min-h-8 px-3 text-xs [&_svg]:size-3.5",
        md: "min-h-9 px-4 text-sm [&_svg]:size-4",
        lg: "min-h-11 px-5 text-base [&_svg]:size-5",
        icon: "size-9 [&_svg]:size-4.5",
        "icon-sm": "size-8 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** render the child element (e.g. a router Link) with the button's styling */
  asChild?: boolean;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  type,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button
      type={type ?? "button"}
      className={classes}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "children" | "asChild" | "size"> {
  icon: LucideIcon;
  /** accessible name and tooltip, already in the UI language */
  label: string;
  /** richer tooltip content (e.g. a bilingual label and a shortcut); defaults to `label` */
  tooltip?: ReactNode;
  size?: "icon" | "icon-sm";
  /** mirror the icon in right-to-left (arrows, chevrons) */
  directional?: boolean;
}

export function IconButton({
  icon: Icon,
  label,
  tooltip,
  size = "icon",
  variant = "ghost",
  directional = false,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip content={tooltip ?? label}>
      <Button aria-label={label} size={size} variant={variant} {...props}>
        <Icon aria-hidden="true" className={directional ? "rtl:-scale-x-100" : undefined} />
      </Button>
    </Tooltip>
  );
}
