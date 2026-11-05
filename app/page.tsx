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

// Render the data-driven homepage on a cache miss. Cloudflare's shared HTTP
// cache controls freshness without requiring persistent Next.js ISR storage.
export const dynamic = "force-dynamic";

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
