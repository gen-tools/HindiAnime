import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { SeriesCatalogBrowser } from "@/components/catalog/SeriesCatalogBrowser";
import { createCanonicalMetadata } from "@/lib/seo";

export const revalidate = 21600;

export const metadata: Metadata = createCanonicalMetadata("/series", {
  title: "Anime Series Catalog",
  description:
    "Explore and stream anime TV series and multi-season anime on Hindi Anime.",
});

export default function SeriesPage() {
  return (
    <div className="container-page py-10">
      <div className="relative overflow-hidden rounded-2xl border border-border-line bg-gradient-to-r from-surface via-surface-dark to-background p-6 sm:p-8">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-green-primary/30 bg-green-primary/10 px-3 py-1 text-xs font-semibold text-green-light">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Complete Collection</span>
          </div>
          <h1 className="font-display mt-3 text-3xl font-extrabold text-text-primary md:text-4xl">Anime Series</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Stream all available anime TV series, ongoing broadcasts, and completed seasons dubbed in Hindi, Tamil, Telugu, and English.
          </p>
        </div>
      </div>
      <SeriesCatalogBrowser />
    </div>
  );
}
