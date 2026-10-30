import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type Variant = "filled" | "tinted" | "gray" | "plain" | "glass" | "destructive";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  filled: "bg-tint text-white",
  tinted: "bg-[color-mix(in_srgb,var(--tint)_15%,transparent)] text-tint-text",
  gray: "bg-fill-3 text-tint-text",
  plain: "bg-transparent text-tint-text",
  glass: "glass text-label",
  destructive: "bg-[color-mix(in_srgb,var(--red)_15%,transparent)] text-red-text",
};

const sizes: Record<Size, string> = {
  sm: "min-h-[30px] px-3 text-subhead font-semibold gap-1",
  md: "min-h-[var(--tap)] px-4 text-body font-semibold gap-1.5",
  lg: "min-h-[52px] px-6 text-headline gap-2",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
};

function buttonClass(variant: Variant, size: Size, block: boolean | undefined, className: string | undefined) {
  return cx(
    "inline-flex select-none items-center justify-center rounded-full whitespace-nowrap",
    "transition-[transform,opacity,filter] duration-150 active:scale-[0.97] active:opacity-80",
    "disabled:pointer-events-none disabled:opacity-40",
    variants[variant],
    sizes[size],
    block && "w-full",
    className,
  );
}

export function Button({ variant = "filled", size = "md", icon, block, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, block, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function LinkButton({ variant = "filled", size = "md", icon, block, className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
}) {
  return (
    <a className={buttonClass(variant, size, block, className)} {...rest}>
      {icon}
      {children}
    </a>
  );
}

/** Round glass button used in nav bars and next to the tab bar. */
export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "glass inline-flex size-11 shrink-0 items-center justify-center rounded-full text-label",
        "transition-transform duration-150 active:scale-90",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
