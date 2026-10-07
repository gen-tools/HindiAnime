import type { AnimeType } from "@/types/anime";

export function buildWatchHref(slug: string, type: AnimeType, episodeId?: string): string {
  if (type.trim().toLowerCase() === "movie") return `/watch/${slug}`;
  return `/watch/${slug}/${episodeId || "ep-1-1"}`;
}

export function isStoredMovieWatch(item: {
  type?: AnimeType;
  episodeId?: string;
  episodeTitle?: string;
}): boolean {
  if (item.type) return item.type.trim().toLowerCase() === "movie";

  // Legacy history rows predate storing the structured anime type.
  return (
    item.episodeId === "movie" ||
    /full\s+movie\s*$/i.test(item.episodeTitle?.trim() || "")
  );
}

export function buildStoredWatchHref(item: {
  animeSlug: string;
  episodeId: string;
  type?: AnimeType;
  episodeTitle?: string;
}): string {
  return buildWatchHref(
    item.animeSlug,
    item.type || (isStoredMovieWatch(item) ? "Movie" : "TV"),
    item.episodeId
  );
}
