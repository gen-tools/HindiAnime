"use client";

import { useEffect, useState } from "react";
import { AnimeHero } from "@/components/anime/AnimeHero";
import { DeferredHomeContinueWatching } from "@/components/home/DeferredHomeContinueWatching";
import { TrendingSection } from "@/components/home/TrendingSection";
import { PopularSection } from "@/components/home/PopularSection";
import { LatestSection } from "@/components/home/LatestSection";
import { AllAnimeSection } from "@/components/home/AllAnimeSection";
import { MovieSection } from "@/components/home/MovieSection";
import { FadeIn } from "@/components/ui/FadeIn";
import { fetchHomepageDataInBrowser } from "@/lib/api/browser-source";
import type { HomepageData } from "@/lib/api/client";

export function BrowserHomepageSections({ initialData }: { initialData: HomepageData }) {
  const [data, setData] = useState(initialData);
  const hasInitialContent = initialData.trendingItems.length > 0 || initialData.latestEpisodes.length > 0;
  const [isLoading, setIsLoading] = useState(!hasInitialContent);

  useEffect(() => {
    // Server data is already rendered immediately. Use the browser Worker path
    // only when server-side catalog retrieval produced no homepage content.
    if (hasInitialContent) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    fetchHomepageDataInBrowser(controller.signal)
      .then((freshData) => setData(freshData))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") {
          console.warn("[Homepage] Live source refresh failed; retaining current data.", error.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [hasInitialContent]);

  const displayHeroItems = data.heroItems.length > 0
    ? data.heroItems
    : data.trendingItems.slice(0, 6);

  return (
    <>
      {displayHeroItems.length > 0 ? (
        <AnimeHero items={displayHeroItems} />
      ) : isLoading ? (
        <HeroSkeleton />
      ) : null}
      <DeferredHomeContinueWatching />
      {data.trendingItems.length > 0 ? (
        <FadeIn><TrendingSection items={data.trendingItems} /></FadeIn>
      ) : isLoading ? (
        <AnimeRowSkeleton title="Trending Now" />
      ) : null}
      {data.popularItems.length > 0 ? (
        <FadeIn><PopularSection items={data.popularItems} /></FadeIn>
      ) : isLoading ? (
        <AnimeRowSkeleton title="Popular Anime" />
      ) : null}
      <FadeIn><LatestSection episodes={data.latestEpisodes} /></FadeIn>
      <FadeIn><AllAnimeSection title="On Air & Upcoming" items={data.upcomingItems} viewAllHref="/schedule" /></FadeIn>
      <FadeIn><AllAnimeSection title="Series" items={data.seriesItems} viewAllHref="/series" /></FadeIn>
      <FadeIn><MovieSection items={data.movieItems} /></FadeIn>
    </>
  );
}

function HeroSkeleton() {
  return (
    <section
      role="status"
      aria-label="Loading featured anime"
      className="relative min-h-[480px] overflow-hidden border-b border-border-line bg-background sm:min-h-[520px] md:min-h-[560px] lg:min-h-[600px]"
    >
      <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-surface via-surface-elevated to-surface" />
      <div className="container-page relative flex min-h-[480px] flex-col justify-end gap-4 pb-10 pt-16 sm:min-h-[520px] md:min-h-[560px] lg:min-h-[600px]">
        <div className="h-4 w-32 rounded bg-white/10" />
        <div className="h-10 max-w-xl rounded bg-white/10 sm:h-14" />
        <div className="h-4 max-w-md rounded bg-white/[0.07]" />
        <div className="h-10 w-36 rounded-lg bg-white/10" />
      </div>
      <span className="sr-only">Loading featured anime</span>
    </section>
  );
}

function AnimeRowSkeleton({ title }: { title: string }) {
  return (
    <section aria-hidden="true" className="py-7 md:py-9">
      <div className="container-page">
        <div className="mb-4 h-7 w-40 animate-pulse rounded bg-white/10" />
        <div className="no-scrollbar flex gap-4 overflow-hidden px-1 pb-2 pt-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={`${title}-${index}`} className="w-[150px] shrink-0 sm:w-[168px] md:w-[180px]">
              <div className="aspect-[2/3] animate-pulse rounded-xl border border-border-line bg-surface-card" />
              <div className="mt-3 h-4 animate-pulse rounded bg-white/10" />
              <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-white/[0.07]" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading {title}</span>
    </section>
  );
}

