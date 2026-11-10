import { BrowserHomepageSections } from "@/components/home/BrowserHomepageSections";
import { LanguageSection } from "@/components/home/LanguageSection";
import { GenreSection } from "@/components/home/GenreSection";
import { DiscoverySection } from "@/components/home/DiscoverySection";
import { FadeIn } from "@/components/ui/FadeIn";
import { Suspense } from "react";
import type { Metadata } from "next";
import {
  getFallbackHomepageData,
  getHomepageData,
} from "@/lib/api/client";

import { createCanonicalMetadata } from "@/lib/seo";

export const metadata: Metadata = createCanonicalMetadata("/");

const fallbackHomepageData = getFallbackHomepageData();

async function HomepageFeedSections() {
  const homepageData = await getHomepageData();
  return (
    <BrowserHomepageSections
      initialData={homepageData}
      initialDataGeneratedAt={Date.now()}
    />
  );
}

export default function HomePage() {
  return (
    <>
      <h1 className="sr-only">Hindi Anime – Watch Hindi Dubbed Anime Online</h1>
      <Suspense
        fallback={
          <BrowserHomepageSections
            initialData={fallbackHomepageData}
            initialDataGeneratedAt={0}
          />
        }
      >
        <HomepageFeedSections />
      </Suspense>

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
