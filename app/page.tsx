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

// Cache homepage with ISR (120s) for instant (<50ms) TTFB and ultra-high mobile & desktop PageSpeed.
export const revalidate = 120;

export const metadata: Metadata = createCanonicalMetadata("/");

export default async function HomePage() {
  const homepageData = await getHomepageData();

  return (
    <>
      <BrowserHomepageSections initialData={homepageData} />

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
