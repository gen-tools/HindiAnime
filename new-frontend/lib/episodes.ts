import type { Episode } from "@/types/episode";

/**
 * The upstream episode payload identifies an episode by its anime, season, and
 * number. Its route ID intentionally omits the anime slug, so use this full
 * identity for React lists and API duplicate suppression.
 */
export function getEpisodeIdentity(episode: Pick<Episode, "animeSlug" | "season" | "number">): string {
  return `${episode.animeSlug}:s${episode.season}:e${episode.number}`;
}

/**
 * Some upstream episode feeds repeat the same episode. Preserve the first
 * item in API order and omit repeated identifiers so users never see two
 * buttons for one actual episode.
 */
export function deduplicateEpisodes(episodes: Episode[]): Episode[] {
  const seen = new Set<string>();

  return episodes.filter((episode) => {
    const identity = getEpisodeIdentity(episode);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
