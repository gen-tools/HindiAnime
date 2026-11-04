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

// The validated homepage feed is cached for 15 minutes; align page ISR with it
// so the page does not write snapshots more often than its source data changes.
export const revalidate = 900;

export const metadata: Metadata = createCanonicalMetadata("/");

export default async function HomePage() {
  const homepageData = await getHomepageData();
  const homepageDataGeneratedAt = Date.now();

  return (
    <>
      <h1 className="sr-only">Hindi Anime – Watch Hindi Dubbed Anime Online</h1>
      <BrowserHomepageSections
        initialData={homepageData}
        initialDataGeneratedAt={homepageDataGeneratedAt}
      />

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
