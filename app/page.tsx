import { BrowserHomepageSections } from "@/components/home/BrowserHomepageSections";
import { LanguageSection } from "@/components/home/LanguageSection";
import { GenreSection } from "@/components/home/GenreSection";
import { DiscoverySection } from "@/components/home/DiscoverySection";
import { FadeIn } from "@/components/ui/FadeIn";
import type { Metadata } from "next";
import {
  getHomepageData,
} from "@/lib/api/client";

import { createCanonicalMetadata } from "@/lib/seo";

// Always re-check the server credential before rendering API-backed homepage data.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export const metadata: Metadata = createCanonicalMetadata("/");

export default async function HomePage() {
  const homepageData = await getHomepageData();
  const hasAuthorizedHomeData = Boolean(
    homepageData.heroItems.length ||
    homepageData.latestEpisodes.length ||
    homepageData.trendingItems.length ||
    homepageData.popularItems.length ||
    homepageData.movieItems.length ||
    homepageData.seriesItems.length
  );

  return (
    <>
      <h1 className="sr-only">Hindi Anime – Watch Hindi Dubbed Anime Online</h1>
      <BrowserHomepageSections initialData={homepageData} />

      {hasAuthorizedHomeData && (
        <>
          <FadeIn><LanguageSection /></FadeIn>
          <FadeIn><GenreSection /></FadeIn>
          <FadeIn><DiscoverySection /></FadeIn>
        </>
      )}
    </>
  );
}
