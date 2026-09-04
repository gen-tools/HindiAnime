import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination">
      <Link
        href={buildHref(Math.max(1, page - 1))}
        aria-disabled={page === 1}
        className={cn(
          "focus-ring flex items-center gap-1 rounded-lg border border-border-line px-3 py-2 text-sm text-text-secondary hover:border-green-primary/60 hover:text-white",
          page === 1 && "pointer-events-none opacity-30"
        )}
      >
        <ChevronLeft className="h-4 w-4" />
        Prev
      </Link>

      <span className="px-3 text-sm text-text-muted">
        Page <span className="text-text-primary">{page}</span> of {totalPages}
      </span>

      <Link
        href={buildHref(Math.min(totalPages, page + 1))}
        aria-disabled={page === totalPages}
        className={cn(
          "focus-ring flex items-center gap-1 rounded-lg border border-border-line px-3 py-2 text-sm text-text-secondary hover:border-green-primary/60 hover:text-white",
          page === totalPages && "pointer-events-none opacity-30"
        )}
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </Link>
    </nav>
  );
}
