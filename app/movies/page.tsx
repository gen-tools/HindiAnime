import type { Metadata } from "next";
import { StaticMoviesBrowser } from "@/components/catalog/StaticMoviesBrowser";
import { createCanonicalMetadata } from "@/lib/seo";

export const metadata: Metadata = createCanonicalMetadata("/movies", {
  title: "Anime Movies",
  description: "Explore and stream anime movies in Hindi and regional languages on Hindi Anime.",
});

export default function MoviesPage() {
  return <StaticMoviesBrowser />;
}
