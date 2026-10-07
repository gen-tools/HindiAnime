"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function AnimeRowControls({
  targetId,
  title,
}: {
  targetId: string;
  title: string;
}) {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const row = document.getElementById(targetId);
    if (!row) return;
    setCanScrollLeft(row.scrollLeft > 10);
    setCanScrollRight(row.scrollLeft + row.clientWidth < row.scrollWidth - 10);
  }, [targetId]);

  useEffect(() => {
    const row = document.getElementById(targetId);
    if (!row) return;
    checkScroll();
    row.addEventListener("scroll", checkScroll, { passive: true });
    const observer = new ResizeObserver(checkScroll);
    observer.observe(row);
    return () => {
      row.removeEventListener("scroll", checkScroll);
      observer.disconnect();
    };
  }, [checkScroll, targetId]);

  const scroll = (direction: "left" | "right") => {
    const row = document.getElementById(targetId);
    if (!row) return;
    row.scrollBy({
      left: direction === "left" ? -Math.max(300, row.clientWidth * 0.75) : Math.max(300, row.clientWidth * 0.75),
      behavior: "smooth",
    });
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => scroll("left")}
          disabled={!canScrollLeft}
          className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg border border-border-line bg-surface text-text-secondary transition-all hover:border-green-primary/60 hover:bg-white/[0.05] hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Scroll ${title} left`}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => scroll("right")}
          disabled={!canScrollRight}
          className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg border border-border-line bg-surface text-text-secondary transition-all hover:border-green-primary/60 hover:bg-white/[0.05] hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Scroll ${title} right`}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}
