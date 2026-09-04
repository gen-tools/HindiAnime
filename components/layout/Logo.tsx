import { cn } from "@/lib/utils";
import Link from "next/link";

export function Logo({ className, iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  return (
    <Link href="/" className={cn("focus-ring flex items-center gap-2 shrink-0", className)} aria-label="HindiAnime home">
      <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
        <path
          d="M15 1.5 27.5 8.5V21.5L15 28.5 2.5 21.5V8.5L15 1.5Z"
          stroke="#22C55E"
          strokeWidth="1.6"
          fill="#0F1713"
        />
        <path d="M12 10.5 20 15 12 19.5V10.5Z" fill="#22C55E" />
      </svg>
      {!iconOnly && (
        <span className="font-display text-[1.15rem] font-extrabold tracking-tight text-text-primary">
          HINDI<span className="text-green-bright">ANIME</span>
        </span>
      )}
    </Link>
  );
}
