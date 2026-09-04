import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function EpisodeNavigation({
  animeSlug,
  prevId,
  nextId,
}: {
  animeSlug: string;
  prevId?: string;
  nextId?: string;
}) {
  const baseStyles =
    "focus-ring flex items-center gap-1.5 rounded-lg border border-border-line px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:border-green-primary/60 hover:text-white";
  const disabledStyles = "pointer-events-none opacity-30";

  return (
    <div className="flex items-center gap-3">
      <Link
        href={prevId ? `/watch/${animeSlug}/${prevId}` : "#"}
        className={cn(baseStyles, !prevId && disabledStyles)}
        aria-disabled={!prevId}
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </Link>
      <Link
        href={nextId ? `/watch/${animeSlug}/${nextId}` : "#"}
        className={cn(baseStyles, !nextId && disabledStyles)}
        aria-disabled={!nextId}
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
