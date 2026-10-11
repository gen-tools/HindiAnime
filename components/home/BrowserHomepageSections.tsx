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

  useEffect(() => {
    // Server data is already rendered immediately. Use the browser Worker path
    // only when server-side catalog retrieval produced no homepage content.
    if (hasInitialContent) return;

    const controller = new AbortController();
    fetchHomepageDataInBrowser(controller.signal)
      .then((freshData) => setData(freshData))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") {
          console.warn("[Homepage] Live source refresh failed; retaining current data.", error.message);
        }
      });
    return () => controller.abort();
  }, [hasInitialContent]);

  const displayHeroItems = data.heroItems.length > 0
    ? data.heroItems
    : data.trendingItems.slice(0, 6);

  return (
    <>
      <AnimeHero items={displayHeroItems} />
      <DeferredHomeContinueWatching />
      <FadeIn><TrendingSection items={data.trendingItems} /></FadeIn>
      <FadeIn><PopularSection items={data.popularItems} /></FadeIn>
      <FadeIn><LatestSection episodes={data.latestEpisodes} /></FadeIn>
      <FadeIn><AllAnimeSection title="On Air & Upcoming" items={data.upcomingItems} viewAllHref="/schedule" /></FadeIn>
      <FadeIn><AllAnimeSection title="Series" items={data.seriesItems} viewAllHref="/series" /></FadeIn>
      <FadeIn><MovieSection items={data.movieItems} /></FadeIn>
    </>
  );
}

