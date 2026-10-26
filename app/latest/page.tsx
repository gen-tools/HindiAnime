import type { Metadata } from "next";
import { LatestBrowser } from "@/components/catalog/LatestBrowser";
import { getLatestEpisodes, mapLatestEpisodeToEpisode } from "@/lib/api/client";
import { deduplicateEpisodes } from "@/lib/episodes";
import { createCanonicalMetadata } from "@/lib/seo";

export const revalidate = 21600;

export const metadata: Metadata = createCanonicalMetadata("/latest", {
  title: "Latest Releases & New Episodes",
  description: "Watch newly dropped anime episodes and freshly added anime series and movies on Hindi Anime.",
});

export default async function LatestPage() {
  const response = await getLatestEpisodes();
  const episodes = deduplicateEpisodes((response?.results ?? []).map(mapLatestEpisodeToEpisode));
  return <LatestBrowser initialEpisodes={episodes} />;
}
