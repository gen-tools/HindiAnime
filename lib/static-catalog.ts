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

const staticCatalogBySlug = new Map(staticCatalog.map((item) => [item.slug, item]));
const catalogGenresByItem = staticCatalog.map((item) => ({
  item,
  genres: new Set(item.genres.map((genre) => genre.toLowerCase().trim().replace(/\s+/g, "-"))),
}));

export function getStaticCatalogItemBySlug(slug: string): Anime | undefined {
  return staticCatalogBySlug.get(slug);
}

/** Return the first related catalog items in the same order as staticCatalog. */
export function getStaticCatalogItemsByGenres(
  genreSlugs: readonly string[],
  excludedSlug: string,
  limit: number
): Anime[] {
  if (genreSlugs.length === 0 || limit <= 0) return [];

  const wantedGenres = new Set(genreSlugs);
  const matches: Anime[] = [];

  for (const entry of catalogGenresByItem) {
    if (!entry.item.slug || entry.item.slug === excludedSlug) continue;
    let hasMatch = false;
    for (const genre of entry.genres) {
      if (wantedGenres.has(genre)) {
        hasMatch = true;
        break;
      }
    }
    if (!hasMatch) continue;

    matches.push(entry.item);
    if (matches.length >= limit) break;
  }

  return matches;
}
