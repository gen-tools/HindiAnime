import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Tone = "default" | "green" | "outline";

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const tones: Record<Tone, string> = {
    default: "bg-surface-elevated text-text-secondary border border-border-line",
    green: "bg-green-primary/15 text-green-light border border-green-primary/40",
    outline: "bg-transparent text-text-secondary border border-white/15",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
