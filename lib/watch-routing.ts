export function buildWatchHref(slug: string, type?: string, episodeId?: string): string {
  if (type === "Movie") return `/watch/${slug}`;
  return `/watch/${slug}/${episodeId || "ep-1-1"}`;
}

export function isStoredMovieWatch(item: {
  episodeId?: string;
  episodeTitle?: string;
}): boolean {
  return (
    item.episodeId === "movie" ||
    /full\s+movie\s*$/i.test(item.episodeTitle?.trim() || "")
  );
}

export function buildStoredWatchHref(item: {
  animeSlug: string;
  episodeId: string;
  episodeTitle?: string;
}): string {
  return buildWatchHref(
    item.animeSlug,
    isStoredMovieWatch(item) ? "Movie" : "TV",
    item.episodeId
  );
}
