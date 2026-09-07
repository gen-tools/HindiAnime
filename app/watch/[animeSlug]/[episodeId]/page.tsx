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
  parseLanguages,
} from "@/lib/api/client";
import type { Anime } from "@/types/anime";
import type { Episode } from "@/types/episode";
import type { SeasonItem } from "@/types/api";
import { deduplicateEpisodes } from "@/lib/episodes";

function createFallbackAnime(slug: string): Anime {
  const formattedTitle = formatDisplayTitle(slug);
  return {
    id: slug,
    slug,
    title: formattedTitle,
    synopsis: SYNOPSIS_FALLBACK,
    poster: slug,
    backdrop: slug,
    rating: 8.5,
    year: new Date().getFullYear(),
    type: "TV",
    status: "Ongoing",
    durationMinutes: 24,
    episodeCount: 1,
    genres: ["action", "animation"],
    languages: ["hindi", "japanese", "english"],
    seasons: 1,
    studio: "Anime",
    updatedAt: new Date().toISOString().split("T")[0],
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ animeSlug: string; episodeId: string }>;
}): Promise<Metadata> {
  const { animeSlug: rawSlug, episodeId } = await params;
  const cleanSlug = cleanAnimeSlug(rawSlug) || rawSlug;
  const searchKeyword = formatDisplayTitle(cleanSlug).toLowerCase();

  const epMatch = episodeId.match(/ep-(\d+)-(\d+)/);
  const seasonNumber = epMatch ? parseInt(epMatch[1], 10) || 1 : 1;

  const [apiInfo, movieInfo, searchRes, directData, epApiRes] = await Promise.all([
    getAnimeInfo(cleanSlug),
    getMovieInfo(cleanSlug),
    searchAnime(searchKeyword, 1),
    scrapeDirectSeriesData(cleanSlug),
    getEpisodes(cleanSlug, seasonNumber),
  ]);

  const searchMatch = searchRes?.results?.results?.find(
    (r) => cleanAnimeSlug(r.anime_id) === cleanSlug
  );

  const rawEpisodes = epApiRes?.results?.episodes || [];
  const s1Fallback = seasonNumber === 1 && directData?.s1Episodes ? directData.s1Episodes : [];
  const hasSeriesEpisodes = rawEpisodes.length > 0 || s1Fallback.length > 0;
  const hasMultipleSeasons = Boolean(directData?.seasons && directData.seasons.length > 1);

  const movieData = resolveMovieInfoData(movieInfo);
  const animeDataMeta = resolveAnimeInfoData(apiInfo);

  const isMovie =
    !hasSeriesEpisodes &&
    !hasMultipleSeasons &&
    (Boolean(directData?.isMovie) || (Boolean(movieData?.title) && !animeDataMeta?.title));

  let anime: Anime = createFallbackAnime(cleanSlug);
  if (isMovie && movieData?.title) {
    anime = mapMovieInfoToAnime(
      movieData,
      searchMatch?.poster || directData?.poster || undefined,
      directData?.title || undefined
    );
  } else if (animeDataMeta?.title) {
    anime = mapApiInfoToAnime(
      animeDataMeta,
      searchMatch?.poster || directData?.poster || movieData?.poster || undefined,
      directData?.title || movieData?.title || undefined
    );
  } else {
    const formattedTitle =
      directData?.title || movieData?.title || searchMatch?.title || formatDisplayTitle(cleanSlug);
    const poster =
      directData?.poster || searchMatch?.poster || movieData?.poster || cleanSlug;
    anime = {
      ...anime,
      title: formattedTitle,
      synopsis:
        directData?.synopsis ||
        (typeof movieData?.overview === "string" ? movieData.overview : `Watch ${formattedTitle} in Hindi on HindiAnime.`),
      poster,
      backdrop: directData?.backdrop || poster,
      rating: Number(movieData?.rating) || 8.5,
      year: Number(movieData?.year) || new Date().getFullYear(),
      type: isMovie ? "Movie" : "TV",
      status: isMovie ? "Completed" : "Ongoing",
      durationMinutes: isMovie ? 110 : 24,
      episodeCount: rawEpisodes.length || s1Fallback.length || 1,
      genres: movieData?.genres?.map((g) => g.toLowerCase().replace(/\s+/g, "-")) || [
        "action",
        "animation",
      ],
      languages: movieData?.languages
        ? parseLanguages(movieData.languages.join(","))
        : ["hindi", "japanese", "english"],
      seasons: directData?.seasons?.length || 1,
    };
  }

  const title =
    directData?.title ||
    (anime.title && !anime.title.includes("%") ? anime.title : formatDisplayTitle(cleanSlug));

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

  // ── 1. Resolve anime metadata & episodes concurrently ──────────────────────
  const [apiInfo, movieInfo, searchRes, discoveredSeasons, directData, epApiRes] = await Promise.all([
    getAnimeInfo(cleanSlug),
    getMovieInfo(cleanSlug),
    searchAnime(searchKeyword, 1),
    getAvailableSeasons(cleanSlug),
    scrapeDirectSeriesData(cleanSlug),
    getEpisodes(cleanSlug, seasonNumber),
  ]);

  // Match strictly by exact slug — never hijack identity with random search results
  const searchMatch = searchRes?.results?.results?.find(
    (r) => cleanAnimeSlug(r.anime_id) === cleanSlug
  );

  const rawEpisodes = epApiRes?.results?.episodes || [];
  const s1Fallback = seasonNumber === 1 && directData?.s1Episodes ? directData.s1Episodes : [];
  const effectiveRawEpisodes = rawEpisodes.length > 0 ? rawEpisodes : s1Fallback;

  const hasSeriesEpisodes = effectiveRawEpisodes.length > 0;
  const hasMultipleSeasons =
    (discoveredSeasons && discoveredSeasons.length > 1) ||
    Boolean(directData?.seasons && directData.seasons.length > 1);

  const movieData = resolveMovieInfoData(movieInfo);
  const animeData = resolveAnimeInfoData(apiInfo);

  // A title is only a movie if it has NO series episodes and is confirmed as a movie
  const isMovie =
    !hasSeriesEpisodes &&
    !hasMultipleSeasons &&
    (Boolean(directData?.isMovie) || (Boolean(movieData?.title) && !animeData?.title));

  let anime: Anime = createFallbackAnime(cleanSlug);
  if (isMovie && movieData?.title) {
    anime = mapMovieInfoToAnime(
      movieData,
      searchMatch?.poster || directData?.poster || undefined,
      directData?.title || undefined
    );
  } else if (animeData?.title) {
    anime = mapApiInfoToAnime(
      animeData,
      searchMatch?.poster || directData?.poster || movieData?.poster || undefined,
      directData?.title || movieData?.title || undefined
    );
  } else if (searchMatch) {
    anime = mapSearchItemToAnime(searchMatch);
  } else {
    const mock = getAnimeBySlug(cleanSlug);
    if (mock) {
      anime = mock;
    }
  }

  // Enrich with scraped or movie data if title/synopsis/poster was missing
  const bestTitle =
    directData?.title ||
    (movieData?.title && !animeData?.title ? movieData.title : "") ||
    anime.title ||
    formatDisplayTitle(cleanSlug);

  const bestPoster =
    directData?.poster ||
    (isUsableImageUrl(anime.poster) ? anime.poster : "") ||
    (movieData?.poster && isUsableImageUrl(movieData.poster) ? movieData.poster : "") ||
    cleanSlug;

  const totalSeasonsCount =
    discoveredSeasons.length || directData?.seasons?.length || anime.seasons || 1;

  anime = {
    ...anime,
    id: cleanSlug,
    slug: cleanSlug,
    title: bestTitle,
    poster: bestPoster,
    backdrop: directData?.backdrop || bestPoster,
    type: isMovie ? "Movie" : "TV",
    status: isMovie ? "Completed" : anime.status || "Ongoing",
    durationMinutes: isMovie ? 110 : 24,
    episodeCount: effectiveRawEpisodes.length || anime.episodeCount || 12,
    seasons: totalSeasonsCount,
  };

  if (
    directData?.synopsis &&
    (!anime.synopsis ||
      anime.synopsis === SYNOPSIS_FALLBACK ||
      anime.synopsis === "No synopsis available.")
  ) {
    anime = { ...anime, synopsis: directData.synopsis };
  } else if (typeof movieData?.overview === "string" && (!anime.synopsis || anime.synopsis === SYNOPSIS_FALLBACK)) {
    anime = { ...anime, synopsis: movieData.overview };
  }

  // Determine available seasons
  const infoSeasonCount = Number(animeData?.seasons);
  const discoveredList = discoveredSeasons.length
    ? discoveredSeasons
    : directData?.seasons?.length
    ? directData.seasons
    : Number.isInteger(infoSeasonCount) && infoSeasonCount > 0
    ? Array.from({ length: infoSeasonCount }, (_, index) => index + 1)
    : [seasonNumber];

  const availableSeasons = isMovie
    ? [1]
    : Array.from(new Set([...discoveredList, seasonNumber])).sort((a, b) => a - b);

  const seasonList: SeasonItem[] = availableSeasons.map((season) => ({
    season: String(season),
    text: isMovie ? "Movie" : `Season ${season}`,
  }));

  // ── 2. Build episodes list for current season ──────────────────────────────
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
    if (effectiveRawEpisodes.length > 0) {
      episodes = deduplicateEpisodes(
        effectiveRawEpisodes.map((ep, idx) =>
          mapApiEpisodeToEpisode(
            ep,
            anime.slug,
            anime.title,
            anime.poster,
            anime.languages,
            seasonNumber,
            idx
          )
        )
      );
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

  // ── 3. Find current active episode ─────────────────────────────────────────
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
          {isMovie ? "Full Movie" : `Season ${episode.season} · Episode ${episode.number}`}
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

      {/* Episode metadata & Controls */}
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

      {/* Episode list / Other episodes options */}
      {!isMovie && (
        <div className="mt-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xl font-bold text-text-primary">
                Episodes
              </h2>
              <span className="rounded-full bg-surface-elevated px-2.5 py-0.5 text-xs font-semibold text-text-secondary border border-border-line">
                {episodes.length} Episodes
              </span>
            </div>
            {seasonList.length > 1 && (
              <SeasonSelector
                seasons={seasonList}
                currentSeason={seasonNumber}
                watchAnimeSlug={anime.slug}
              />
            )}
          </div>
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
