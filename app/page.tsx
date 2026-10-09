import { AnimeHero } from "@/components/anime/AnimeHero";
import { DeferredHomeContinueWatching } from "@/components/home/DeferredHomeContinueWatching";
import { TrendingSection } from "@/components/home/TrendingSection";
import { PopularSection } from "@/components/home/PopularSection";
import { LatestSection } from "@/components/home/LatestSection";
import { AllAnimeSection } from "@/components/home/AllAnimeSection";
import { MovieSection } from "@/components/home/MovieSection";
import { LanguageSection } from "@/components/home/LanguageSection";
import { GenreSection } from "@/components/home/GenreSection";
import { DiscoverySection } from "@/components/home/DiscoverySection";
import { FadeIn } from "@/components/ui/FadeIn";
import type { Metadata } from "next";
import {
  getHomepageData,
} from "@/lib/api/client";

import { createCanonicalMetadata } from "@/lib/seo";

// Cache homepage with ISR (120s) for instant (<50ms) TTFB and ultra-high mobile & desktop PageSpeed.
export const revalidate = 120;

export const metadata: Metadata = createCanonicalMetadata("/");

export default async function HomePage() {
  const {
    heroItems,
    latestEpisodes,
    trendingItems,
    popularItems,
    movieItems,
    seriesItems,
    upcomingItems,
  } = await getHomepageData();

  // The hero items are enriched with /api/info overviews. Catalog rows keep
  // the lighter-weight catalog response.
  const displayHeroItems =
    heroItems && heroItems.length > 0
      ? heroItems
      : trendingItems && trendingItems.length > 0
      ? trendingItems.slice(0, 6)
      : [];

  return (
    <>
      {/* 1. Hero (features trending anime spotlight) */}
      <AnimeHero items={displayHeroItems} />

      {/* Continue Watching (renders only when user has active watch progress) */}
      <DeferredHomeContinueWatching />

      {/* 2. Trending Now */}
      <FadeIn>
        <TrendingSection items={trendingItems} />
      </FadeIn>

      {/* 3. Popular Anime (immediately after Trending Now) */}
      <FadeIn>
        <PopularSection items={popularItems} />
      </FadeIn>

      {/* 4. Latest Episodes */}
      <FadeIn>
        <LatestSection episodes={latestEpisodes} />
      </FadeIn>

      {/* 5. On Air & Upcoming */}
      <FadeIn>
        <AllAnimeSection title="On Air & Upcoming" items={upcomingItems} viewAllHref="/schedule" />
      </FadeIn>

      {/* 6. Series */}
      <FadeIn>
        <AllAnimeSection title="Series" items={seriesItems} viewAllHref="/series" />
      </FadeIn>

      {/* 7. Movies */}
      <FadeIn>
        <MovieSection items={movieItems} />
      </FadeIn>

      {/* 8. Other existing sections */}
      <FadeIn>
        <LanguageSection />
      </FadeIn>
      <FadeIn>
        <GenreSection />
      </FadeIn>
      <FadeIn>
        <DiscoverySection />
      </FadeIn>
    </>
  );
}
