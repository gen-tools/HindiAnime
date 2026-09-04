import { cn } from "@/lib/utils";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "outline";
type Size = "sm" | "md" | "lg";

interface BaseProps {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-green-primary text-white hover:bg-green-bright hover:shadow-[0_0_24px_-4px_rgba(34,197,94,0.6)]",
  secondary:
    "bg-surface-elevated text-text-primary border border-border-line hover:border-green-primary/60 hover:text-white",
  ghost: "bg-transparent text-text-secondary hover:text-white hover:bg-white/5",
  outline:
    "bg-transparent border border-white/20 text-text-primary hover:border-green-bright hover:text-green-light",
};

const sizeStyles: Record<Size, string> = {
  sm: "text-sm px-3.5 py-2 gap-1.5",
  md: "text-sm px-5 py-2.5 gap-2",
  lg: "text-base px-6 py-3.5 gap-2.5",
};

const shared =
  "focus-ring inline-flex items-center justify-center rounded-lg font-semibold transition-all duration-200 whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none";

export function Button({
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: BaseProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cn(shared, variantStyles[variant], sizeStyles[size], className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
}: BaseProps & { href: string }) {
  return (
    <Link href={href} className={cn(shared, variantStyles[variant], sizeStyles[size], className)}>
      {icon}
      {children}
    </Link>
  );
}
