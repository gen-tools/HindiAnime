"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Play, Trash2, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import {
  getContinueWatching,
  removeFromContinueWatching,
  clearContinueWatching,
  type ContinueWatchingItem,
} from "@/lib/storage/userDataService";
import { PosterArt } from "@/components/anime/PosterArt";
import { cn } from "@/lib/utils";

// One-time migration key: when the poster-extraction bug was fixed,
// stale IndexedDB records may still have wrong cross-contaminated
// poster URLs. Clear them once so clean data accumulates going forward.
const POSTER_MIGRATION_KEY = "hindianime_poster_fix_v1";

async function runPosterMigrationIfNeeded(): Promise<void> {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(POSTER_MIGRATION_KEY)) return; // already ran
  try {
    // Clear continue-watching items that have suspicious poster URLs
    // (cross-contaminated images show up as TMDB w500 URLs not matching
    // the slug, but we cannot easily verify that client-side, so we
    // clear all existing items once and let them be rebuilt on next watch).
    await clearContinueWatching();
    localStorage.setItem(POSTER_MIGRATION_KEY, "1");
  } catch {
    // best-effort, silently ignore
  }
}

export function HomeContinueWatching() {
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
  };

  const loadItems = () => {
    getContinueWatching().then((res) => {
      setItems(res);
      setTimeout(checkScroll, 100);
    });
  };

  useEffect(() => {
    setMounted(true);
    // Run one-time migration to clear stale wrong-poster data, then load
    runPosterMigrationIfNeeded().then(() => loadItems());

    const handleUpdate = () => loadItems();
    window.addEventListener("hindianime:userdata-changed", handleUpdate);
    window.addEventListener("resize", checkScroll);
    return () => {
      window.removeEventListener("hindianime:userdata-changed", handleUpdate);
      window.removeEventListener("resize", checkScroll);
    };
  }, []);

  const handleRemove = async (slug: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await removeFromContinueWatching(slug);
    setItems((prev) => prev.filter((i) => i.animeSlug !== slug));
  };

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = Math.max(300, scrollRef.current.clientWidth * 0.75);
    scrollRef.current.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  if (!mounted || items.length === 0) {
    return null; // Zero disruption or space if no watch history exists
  }

  return (
    <section className="py-6 md:py-8">
      <div className="container-page">
        {/* Header */}
        <div className="mb-4 flex items-end justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold text-text-primary md:text-2xl">
              Continue Watching
            </h2>
            <span className="rounded-full bg-green-primary/15 border border-green-primary/30 px-2.5 py-0.5 text-xs font-bold text-green-light">
              {items.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => scroll("left")}
              disabled={!canScrollLeft}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-line bg-surface text-text-secondary transition-colors hover:border-green-primary/50 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Scroll left"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => scroll("right")}
              disabled={!canScrollRight}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-line bg-surface text-text-secondary transition-colors hover:border-green-primary/50 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Scroll right"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Carousel Rail */}
        <div className="relative group/rail">
          <div
            ref={scrollRef}
            onScroll={checkScroll}
            className="no-scrollbar -mx-1 flex gap-4 overflow-x-auto scroll-smooth px-1 pb-2 pt-1"
          >
            {items.map((item) => (
              <div
                key={item.animeSlug}
                className="group relative flex w-[160px] sm:w-[180px] md:w-[200px] shrink-0 flex-col overflow-hidden rounded-xl border border-border-line bg-surface transition-all duration-300 hover:border-green-primary/50 hover:shadow-lg hover:shadow-green-primary/5"
              >
                {/* Poster Artwork with Hover Resume */}
                <Link
                  href={`/watch/${item.animeSlug}/${item.episodeId}`}
                  className="relative block aspect-[2/3] w-full overflow-hidden bg-surface-card"
                >
                  <PosterArt
                    seed={item.animePoster}
                    title={item.animeTitle}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />

                  {/* Remove Button */}
                  <button
                    type="button"
                    onClick={(e) => handleRemove(item.animeSlug, e)}
                    title="Remove from Continue Watching"
                    className="absolute top-2 right-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white/70 backdrop-blur-sm transition-all hover:bg-red-500 hover:text-white"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>

                  {/* Hover Overlay with Resume Button */}
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-green-bright text-black shadow-[0_0_20px_rgba(34,197,94,0.8)]">
                      <Play className="h-5 w-5 translate-x-0.5 fill-black" />
                    </span>
                  </div>

                  {/* Simulated Watch Progress Bar */}
                  <div className="absolute inset-x-0 bottom-0 z-20 h-1.5 bg-black/70">
                    <div className="h-full w-3/5 rounded-r bg-gradient-to-r from-green-primary to-green-bright shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                  </div>
                </Link>

                {/* Info & Metadata */}
                <div className="p-3">
                  <Link href={`/watch/${item.animeSlug}/${item.episodeId}`}>
                    <h3 className="truncate text-sm font-semibold text-text-primary transition-colors group-hover:text-green-light">
                      {item.animeTitle}
                    </h3>
                  </Link>
                  <div className="mt-1 flex items-center justify-between text-xs text-text-muted">
                    <span className="font-medium text-green-light">
                      S{item.season} · EP {item.episode}
                    </span>
                    <span className="truncate max-w-[80px] text-[11px]">
                      {item.episodeTitle || "Episode"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
