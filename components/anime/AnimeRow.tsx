"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { ChevronRight, ChevronLeft } from "lucide-react";
import type { Anime } from "@/types/anime";
import { AnimeCard } from "./AnimeCard";

export function AnimeRow({
  title,
  items,
  viewAllHref,
  ranked = false,
}: {
  title: string;
  items: Anime[];
  viewAllHref?: string;
  ranked?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  function checkScroll() {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
  }

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [items]);

  function scroll(direction: "left" | "right") {
    if (!scrollRef.current) return;
    const scrollAmount = Math.max(300, scrollRef.current.clientWidth * 0.75);
    scrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  }

  if (items.length === 0) return null;

  return (
    <section className="py-7 md:py-9">
      <div className="container-page">
        {/* Section Header */}
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-xl font-bold text-text-primary md:text-2xl">
            {title}
          </h2>

          <div className="flex items-center gap-3">
            {/* Header Arrow Controls (< >) */}
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

            {viewAllHref && (
              <Link
                href={viewAllHref}
                className="focus-ring flex items-center gap-0.5 text-sm font-medium text-text-secondary hover:text-green-light"
              >
                View all
                <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>

        {/* Single Horizontal Row / Carousel */}
        <div className="group/row relative">
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => scroll("left")}
              className="focus-ring absolute -left-3.5 top-1/2 z-20 hidden -translate-y-1/2 items-center justify-center rounded-full border border-border-line bg-background/90 p-2.5 text-white shadow-2xl backdrop-blur-md transition-all hover:scale-110 hover:border-green-primary hover:bg-green-primary hover:text-black md:flex"
              aria-label="Previous items"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          <div
            ref={scrollRef}
            onScroll={checkScroll}
            className="no-scrollbar -mx-1 flex gap-4 overflow-x-auto scroll-smooth px-1 pb-2 pt-2"
          >
            {items.map((item, i) => (
              <AnimeCard
                key={item.id}
                item={item}
                rank={ranked ? i + 1 : undefined}
                className="w-[150px] shrink-0 sm:w-[168px] md:w-[180px]"
              />
            ))}
          </div>

          {canScrollRight && (
            <button
              type="button"
              onClick={() => scroll("right")}
              className="focus-ring absolute -right-3.5 top-1/2 z-20 hidden -translate-y-1/2 items-center justify-center rounded-full border border-border-line bg-background/90 p-2.5 text-white shadow-2xl backdrop-blur-md transition-all hover:scale-110 hover:border-green-primary hover:bg-green-primary hover:text-black md:flex"
              aria-label="Next items"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
