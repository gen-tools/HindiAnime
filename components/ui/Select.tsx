import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SelectHTMLAttributes } from "react";

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          "focus-ring w-full appearance-none rounded-lg border border-border-line bg-surface px-4 py-2.5 pr-9 text-sm text-text-primary transition-colors focus:border-green-bright/70",
          className
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
    </div>
  );
}
