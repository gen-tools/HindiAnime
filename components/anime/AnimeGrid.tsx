import type { Anime } from "@/types/anime";
import { AnimeCard } from "./AnimeCard";

export function AnimeGrid({ items }: { items: Anime[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item, index) => (
        <AnimeCard
          key={item.id}
          item={item}
          className="w-full"
          imageLoading={index < 6 ? "eager" : "lazy"}
        />
      ))}
    </div>
  );
}
