import { catalogIndex } from "@/lib/catalog-index";
import { anime as localAnime } from "@/lib/mock/anime";
import type { Anime } from "@/types/anime";

const localBySlug = new Map(localAnime.map((item) => [item.slug, item]));
const combined = new Map<string, Anime>();

for (const item of catalogIndex) {
  if (localBySlug.get(item.slug)?.isMock) continue;
  const local = localBySlug.get(item.slug);
  combined.set(item.slug, {
    ...item,
    synopsis: local?.synopsis || item.synopsis,
    genres: local?.genres?.length ? local.genres : item.genres,
    languages: local?.languages?.length ? local.languages : item.languages,
    rating: local?.rating || item.rating,
    year: local?.year || item.year,
    episodeCount: local?.episodeCount || item.episodeCount,
    seasons: local?.seasons || item.seasons,
    studio: local?.studio || item.studio,
    updatedAt: local?.updatedAt || item.updatedAt,
  });
}

export const staticCatalog = [...combined.values()];
