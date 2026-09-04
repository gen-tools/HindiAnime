import { AnimeRow } from "@/components/anime/AnimeRow";
import type { Anime } from "@/types/anime";

export function TrendingSection({ items = [] }: { items?: Anime[] }) {
  return <AnimeRow title="Trending Now" items={items} viewAllHref="/popular" ranked />;
}
