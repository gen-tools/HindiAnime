import { AnimeRow } from "@/components/anime/AnimeRow";
import type { Anime } from "@/types/anime";

export function PopularSection({ items = [] }: { items?: Anime[] }) {
  return <AnimeRow title="Popular Anime" items={items} viewAllHref="/popular" />;
}
