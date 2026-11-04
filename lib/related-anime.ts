import { getAnimeByGenre } from "@/lib/mock/anime";
import { genres } from "@/lib/mock/genres";
import { getStaticCatalogItemsByGenres } from "@/lib/static-catalog";
import type { Anime } from "@/types/anime";

const NON_GENRE_TAGS = new Set([
  "animation",
  "adult-cast",
  "award-winning",
  "all-episodes",
  "subbed",
  "dubbed",
  "hindi",
  "english",
  "japanese",
]);

const KNOWN_GENRES = new Set(genres.map((genre) => genre.slug));

const GENRE_PRIORITY = [
  "sports",
  "romance",
  "mystery",
  "horror",
  "thriller",
  "comedy",
  "isekai",
  "sci-fi",
  "action",
  "fantasy",
  "adventure",
  "slice-of-life",
  "psychological",
  "supernatural",
  "drama",
  "shounen",
  "school",
  "super-power",
];

export function getRelatedAnimeForPage(
  current: Pick<Anime, "slug" | "genres">
): { items: Anime[]; primaryGenre: string } {
  const rawGenres = (current.genres ?? [])
    .map((genre) => genre.toLowerCase().trim().replace(/\s+/g, "-"))
    .filter((genre) => genre && !NON_GENRE_TAGS.has(genre) && !genre.startsWith("page"));

  const primaryGenre =
    GENRE_PRIORITY.find((genre) => rawGenres.includes(genre)) ||
    rawGenres.find((genre) => KNOWN_GENRES.has(genre)) ||
    rawGenres[0] ||
    "action";
  const relatedGenres = rawGenres.length ? rawGenres : [primaryGenre];
  const seenSlugs = new Set([current.slug]);
  const related: Anime[] = [];

  for (const item of getStaticCatalogItemsByGenres(relatedGenres, current.slug, 18)) {
    if (item.slug && !seenSlugs.has(item.slug)) {
      seenSlugs.add(item.slug);
      related.push(item);
    }
  }

  for (const genre of relatedGenres) {
    for (const item of getAnimeByGenre(genre)) {
      if (item.slug && !seenSlugs.has(item.slug)) {
        seenSlugs.add(item.slug);
        related.push(item);
      }
    }
  }

  return { items: related.slice(0, 18), primaryGenre };
}
