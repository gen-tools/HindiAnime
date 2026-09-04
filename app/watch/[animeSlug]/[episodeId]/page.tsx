import type { Metadata } from "next";
import Link from "next/link";
import { StreamPlayer } from "@/components/player/StreamPlayer";
import { EpisodeNavigation } from "@/components/episodes/EpisodeNavigation";
import { EpisodeList } from "@/components/episodes/EpisodeList";
import { SeasonSelector } from "@/components/episodes/SeasonSelector";
import { Badge } from "@/components/ui/Badge";
import { getAnimeBySlug } from "@/lib/mock/anime";
import {
  getAnimeInfo,
  getEpisodes,
  getAvailableSeasons,
  searchAnime,
  mapApiInfoToAnime,
  mapSearchItemToAnime,
  mapApiEpisodeToEpisode,
  cleanAnimeSlug,
  SYNOPSIS_FALLBACK,
  resolveAnimeInfoData,
  resolveMovieInfoData,
  getMovieInfo,
  mapMovieInfoToAnime,
  scrapeDirectSeriesData,
  formatDisplayTitle,
  isUsableImageUrl,
} from "@/lib/api/client";
import type { Anime } from "@/types/anime";
import type { Episode } from "@/types/episode";
import type { SeasonItem } from "@/types/api";
import { deduplicateEpisodes } from "@/lib/episodes";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ animeSlug: string; episodeId: string }>;
}): Promise<Metadata> {
  const { animeSlug: rawSlug, episodeId } = await params;
  const cleanSlug = cleanAnimeSlug(rawSlug) || rawSlug;
  const searchKeyword = formatDisplayTitle(cleanSlug).toLowerCase();

  const [apiInfo, movieInfo, searchRes, directData] = await Promise.all([
    getAnimeInfo(cleanSlug),
    getMovieInfo(cleanSlug),
    searchAnime(searchKeyword, 1),
    scrapeDirectSeriesData(cleanSlug),
  ]);

  const searchMatch = searchRes?.results?.results?.find(
    (r) => cleanAnimeSlug(r.anime_id) === cleanSlug
  );

  let anime: Anime | undefined;
  const movieData = resolveMovieInfoData(movieInfo);
  const animeDataMeta = resolveAnimeInfoData(apiInfo);
  if (movieData?.title) {
    anime = mapMovieInfoToAnime(
      movieData,
      searchMatch?.poster || directData?.poster || undefined,
      directData?.title || undefined
    );
  } else if (animeDataMeta) {
    anime = mapApiInfoToAnime(
      animeDataMeta,
      searchMatch?.poster || directData?.poster || undefined,
      directData?.title || undefined
    );
  } else if (directData) {
    const formattedTitle = directData.title || formatDisplayTitle(cleanSlug);
    anime = {
      id: cleanSlug,
      slug: cleanSlug,
      title: formattedTitle,
      synopsis: directData.synopsis || `Watch ${formattedTitle} in Hindi on HindiAnime.`,
      poster: directData.poster || cleanSlug,
      backdrop: directData.backdrop || directData.poster || cleanSlug,
      rating: 8.5,
      year: new Date().getFullYear(),
      type: directData.isMovie ? "Movie" : "TV",
      status: directData.isMovie ? "Completed" : "Ongoing",
      durationMinutes: directData.isMovie ? 110 : 24,
      episodeCount: directData.s1Episodes.length || 1,
      genres: ["action", "animation"],
      languages: ["hindi", "japanese", "english"],
      seasons: directData.seasons.length || 1,
      studio: "Anime",
      updatedAt: new Date().toISOString().split("T")[0],
    };
  } else if (searchMatch) {
    anime = mapSearchItemToAnime(searchMatch);
  } else {
    anime = getAnimeBySlug(cleanSlug);
  }

  const isMovie = anime?.type === "Movie" || Boolean(directData?.isMovie);
  const title =
    directData?.title ||
    (anime?.title && !anime.title.includes("%") ? anime.title : formatDisplayTitle(cleanSlug));

  // Parse ep-{season}-{ep} → human-readable label
  let episodeLabel = isMovie ? "Full Movie" : episodeId;
  if (!isMovie) {
    const match = episodeId.match(/ep-(\d+)-(\d+)/);
    if (match) {
      episodeLabel = `S${match[1]} Episode ${match[2]}`;
    }
  }

  return {
    title: `${title} — ${episodeLabel} | HINDIANIME`,
    description: `Watch ${title} ${episodeLabel} in Hindi on HindiAnime.`,
    alternates: { canonical: `/watch/${cleanSlug}/${episodeId}` },
  };
}

export default async function WatchPage({
  params,
}: {
  params: Promise<{ animeSlug: string; episodeId: string }>;
}) {
  const { animeSlug: rawSlug, episodeId } = await params;
  const cleanSlug = cleanAnimeSlug(rawSlug) || rawSlug;
  const searchKeyword = formatDisplayTitle(cleanSlug).toLowerCase();

  const epMatch = episodeId.match(/ep-(\d+)-(\d+)/);
  const seasonNumber = epMatch ? parseInt(epMatch[1], 10) || 1 : 1;
  const episodeNumber = epMatch ? parseInt(epMatch[2], 10) || 1 : 1;

  // ── 1. Resolve anime metadata ─────────────────────────────────────────────
  const [apiInfo, movieInfo, searchRes, discoveredSeasons, directData] = await Promise.all([
    getAnimeInfo(cleanSlug),
    getMovieInfo(cleanSlug),
    searchAnime(searchKeyword, 1),
    getAvailableSeasons(cleanSlug),
    scrapeDirectSeriesData(cleanSlug),
  ]);

  // Match strictly by exact slug — never hijack identity with random search results
  const searchMatch = searchRes?.results?.results?.find(
    (r) => cleanAnimeSlug(r.anime_id) === cleanSlug
  );

  let anime: Anime | undefined;
  const movieData = resolveMovieInfoData(movieInfo);
  const animeData = resolveAnimeInfoData(apiInfo);
  if (movieData?.title) {
    anime = mapMovieInfoToAnime(
      movieData,
      searchMatch?.poster || directData?.poster || undefined,
      directData?.title || undefined
    );
  } else if (animeData) {
    anime = mapApiInfoToAnime(
      animeData,
      searchMatch?.poster || directData?.poster || undefined,
      directData?.title || undefined
    );
  } else if (directData) {
    const formattedTitle = directData.title || formatDisplayTitle(cleanSlug);
    anime = {
      id: cleanSlug,
      slug: cleanSlug,
      title: formattedTitle,
      synopsis: directData.synopsis || `Watch ${formattedTitle} in Hindi on HindiAnime.`,
      poster: directData.poster || cleanSlug,
      backdrop: directData.backdrop || directData.poster || cleanSlug,
      rating: 8.5,
      year: new Date().getFullYear(),
      type: directData.isMovie ? "Movie" : "TV",
      status: directData.isMovie ? "Completed" : "Ongoing",
      durationMinutes: directData.isMovie ? 110 : 24,
      episodeCount: directData.s1Episodes.length || 1,
      genres: ["action", "animation"],
      languages: ["hindi", "japanese", "english"],
      seasons: directData.seasons.length || 1,
      studio: "Anime",
      updatedAt: new Date().toISOString().split("T")[0],
    };
  } else if (searchMatch) {
    anime = mapSearchItemToAnime(searchMatch);
  } else {
    anime = getAnimeBySlug(cleanSlug);
  }

  // If no anime found, generate fallback anime model from slug
  if (!anime) {
    const formattedTitle = formatDisplayTitle(cleanSlug);
    anime = {
      id: cleanSlug,
      slug: cleanSlug,
      title: formattedTitle,
      synopsis: directData?.synopsis || SYNOPSIS_FALLBACK,
      poster: directData?.poster || cleanSlug,
      backdrop: directData?.backdrop || directData?.poster || cleanSlug,
      rating: 8.0,
      year: new Date().getFullYear(),
      type: "TV",
      status: "Ongoing",
      durationMinutes: 24,
      episodeCount: 1,
      genres: ["action"],
      languages: ["hindi", "japanese", "english"],
      seasons: 1,
      studio: "Anime Production",
      updatedAt: new Date().toISOString().split("T")[0],
    };
  }

  // Ensure slug and id are strictly preserved
  anime = { ...anime, id: cleanSlug, slug: cleanSlug };

  // Override synopsis with scraped data if the API returned the fallback or empty
  if (
    directData?.synopsis &&
    (!anime.synopsis ||
      anime.synopsis === SYNOPSIS_FALLBACK ||
      anime.synopsis === "No synopsis available.")
  ) {
    anime = { ...anime, synopsis: directData.synopsis };
  }

  // Override title if current title contains percent encoding or fallback
  if (directData?.title && (!anime.title || anime.title.includes("%"))) {
    anime = { ...anime, title: directData.title };
  } else if (anime.title && anime.title.includes("%")) {
    anime = { ...anime, title: formatDisplayTitle(anime.title) };
  }

  // Override poster & backdrop if missing or not usable
  if (directData?.poster && (!anime.poster || !isUsableImageUrl(anime.poster))) {
    anime = { ...anime, poster: directData.poster };
  }
  if (directData?.backdrop && (!anime.backdrop || !isUsableImageUrl(anime.backdrop))) {
    anime = { ...anime, backdrop: directData.backdrop };
  } else if (directData?.poster && (!anime.backdrop || !isUsableImageUrl(anime.backdrop))) {
    anime = { ...anime, backdrop: directData.poster };
  }

  const isMovie = anime.type === "Movie" || Boolean(directData?.isMovie);

  const infoSeasonCount = Number(animeData?.seasons);
  const availableSeasons = isMovie
    ? [1]
    : discoveredSeasons.length
    ? discoveredSeasons
    : directData?.seasons?.length
    ? directData.seasons
    : Number.isInteger(infoSeasonCount) && infoSeasonCount > 0
    ? Array.from({ length: infoSeasonCount }, (_, index) => index + 1)
    : [seasonNumber];

  const seasonList: SeasonItem[] = availableSeasons.map((season) => ({
    season: String(season),
    text: isMovie ? "Movie" : `Season ${season}`,
  }));

  // ── 2. Fetch episodes for this season ─────────────────────────────────────
  let episodes: Episode[] = [];

  if (isMovie) {
    episodes = [
      {
        id: "ep-1-1",
        animeSlug: cleanSlug,
        animeTitle: anime.title,
        animePoster: anime.poster,
        season: 1,
        number: 1,
        title: "Full Movie",
        thumbnail: anime.poster,
        durationMinutes: anime.durationMinutes || 110,
        languages: anime.languages,
        releasedAt: new Date().toISOString().split("T")[0],
      },
    ];
  } else {
    try {
      const epApiRes = await getEpisodes(cleanSlug, seasonNumber);
      const rawEpisodes = epApiRes?.results?.episodes || [];

      if (rawEpisodes.length > 0) {
        episodes = deduplicateEpisodes(
          rawEpisodes.map((ep, idx) =>
            mapApiEpisodeToEpisode(
              ep,
              anime!.slug,
              anime!.title,
              anime!.poster,
              anime!.languages,
              seasonNumber,
              idx
            )
          )
        );
      } else if (seasonNumber === 1 && directData?.s1Episodes && directData.s1Episodes.length > 0) {
        episodes = deduplicateEpisodes(
          directData.s1Episodes.map((ep, idx) =>
            mapApiEpisodeToEpisode(
              ep,
              anime!.slug,
              anime!.title,
              anime!.poster,
              anime!.languages,
              1,
              idx
            )
          )
        );
      }
    } catch (err) {
      console.error("WatchPage episode fetch error:", err);
    }
  }

  // If still empty, synthesize at least the current requested episode
  if (episodes.length === 0) {
    episodes = [
      {
        id: episodeId,
        animeSlug: anime.slug,
        animeTitle: anime.title,
        animePoster: anime.poster,
        season: seasonNumber,
        number: episodeNumber,
        title: isMovie ? "Full Movie" : `Episode ${episodeNumber}`,
        thumbnail: anime.poster,
        durationMinutes: 24,
        languages: anime.languages,
        releasedAt: new Date().toISOString().split("T")[0],
      },
    ];
  }

  // ── 3. Find current episode ───────────────────────────────────────────────
  let currentIndex = episodes.findIndex((e) => e.id === episodeId);
  if (currentIndex === -1) {
    currentIndex = episodes.findIndex((e) => e.number === episodeNumber);
  }
  if (currentIndex === -1 && episodes.length > 0) {
    currentIndex = 0;
  }

  let episode = episodes[currentIndex];
  if (!episode) {
    episode = episodes[0] || {
      id: episodeId,
      animeSlug: anime.slug,
      animeTitle: anime.title,
      animePoster: anime.poster,
      season: seasonNumber,
      number: episodeNumber,
      title: isMovie ? "Full Movie" : `Episode ${episodeNumber}`,
      thumbnail: anime.poster,
      durationMinutes: 24,
      languages: anime.languages,
      releasedAt: new Date().toISOString().split("T")[0],
    };
  }

  const prevEpisode = episodes[currentIndex - 1];
  const nextEpisode = episodes[currentIndex + 1];

  const episodeTitle = isMovie
    ? `${anime.title} — Full Movie`
    : `EP ${episode.number} — ${episode.title}`;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 md:py-8 lg:max-w-6xl transition-all">
      {/* Breadcrumb — server-rendered */}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-text-muted">
        <Link
          href={`/anime/${anime.slug}`}
          className="focus-ring hover:text-green-light"
        >
          {anime.title}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-text-secondary">
          {isMovie ? "Full Movie" : `Episode ${episode.number}`}
        </span>
      </nav>

      {/*
        StreamPlayer — client component with integrated Server selector, Theater mode, and Fullscreen.
        Fetches streams via /api/stream-proxy on mount.
      */}
      <StreamPlayer
        animeSlug={anime.slug}
        season={episode.season}
        episode={episode.number}
        episodeTitle={episodeTitle}
        languages={episode.languages}
      />

      {/* Episode metadata — server-rendered */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-text-primary md:text-2xl">
            {anime.title}
            {!isMovie && (
              <span className="ml-2 text-text-muted">
                S{episode.season} · EP {episode.number}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">{episode.title}</p>
          {anime.synopsis && anime.synopsis !== SYNOPSIS_FALLBACK && (
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-secondary">
              {anime.synopsis}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="outline">{isMovie ? "Movie" : `Season ${episode.season}`}</Badge>
            <Badge tone="green">{anime.status}</Badge>
            {!isMovie && seasonList.length > 1 && (
              <SeasonSelector
                seasons={seasonList}
                currentSeason={seasonNumber}
                watchAnimeSlug={anime.slug}
              />
            )}
          </div>
        </div>
        {!isMovie && (
          <EpisodeNavigation
            animeSlug={anime.slug}
            prevId={prevEpisode?.id}
            nextId={nextEpisode?.id}
          />
        )}
      </div>

      {/* Episode list — for series */}
      {!isMovie && episodes.length > 1 && (
        <div className="mt-8">
          <EpisodeList
            episodes={episodes}
            animeSlug={anime.slug}
            activeEpisodeId={episode.id}
          />
        </div>
      )}
    </div>
  );
}
