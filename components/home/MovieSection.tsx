import { AnimeRow } from "@/components/anime/AnimeRow";
import type { Anime } from "@/types/anime";

export function MovieSection({ items }: { items: Anime[] }) {
  return <AnimeRow title="Movies" items={items} viewAllHref="/movies" />;
}
