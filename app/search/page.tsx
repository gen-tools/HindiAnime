import { Suspense } from "react";
import type { Metadata } from "next";
import { createCanonicalMetadata } from "@/lib/seo";
import { SearchPageClient } from "@/components/search/SearchPageClient";

export const metadata: Metadata = createCanonicalMetadata("/search", {
  title: "Search",
  description: "Search anime, movies, and characters across Hindi Anime's catalog.",
  robots: { index: false, follow: true },
});

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="container-page min-h-[60vh] py-10"><h1 className="font-display text-3xl font-extrabold text-text-primary">Search</h1></div>}>
      <SearchPageClient />
    </Suspense>
  );
}
