import type { Metadata } from "next";
import { AnimeInfo } from "@/components/anime/AnimeInfo";
import { PosterArt } from "@/components/anime/PosterArt";
import { SeasonSelector } from "@/components/episodes/SeasonSelector";
import { EpisodeList } from "@/components/episodes/EpisodeList";
import { AnimeRow } from "@/components/anime/AnimeRow";
import { getAnimeBySlug } from "@/lib/mock/anime";
import {
  getAnimeInfo,
  getEpisodes,
  searchAnime,
  mapApiInfoToAnime,
  mapSearchItemToAnime,
  mapApiEpisodeToEpisode,
  cleanAnimeSlug,
  getHomepageFeed,
  getAvailableSeasons,
  getMovieInfo,
  mapMovieInfoToAnime,
  resolveAnimeInfoData,
  resolveMovieInfoData,
  scrapeDirectSeriesData,
  SYNOPSIS_FALLBACK,
  formatDisplayTitle,
  isUsableImageUrl,
  parseLanguages,
} from "@/lib/api/client";
import type { Anime } from "@/types/anime";
import type { Episode } from "@/types/episode";
import type { SeasonItem } from "@/types/api";
import { deduplicateEpisodes } from "@/lib/episodes";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const cleanSlug = cleanAnimeSlug(slug) || slug;
  const searchKeyword = formatDisplayTitle(cleanSlug).toLowerCase();

  const [apiInfo, movieInfo, searchRes, directData, epApiRes] = await Promise.all([
    getAnimeInfo(cleanSlug),
    getMovieInfo(cleanSlug),
    searchAnime(searchKeyword, 1),
    scrapeDirectSeriesData(cleanSlug),
    getEpisodes(cleanSlug, 1),
  ]);

  const searchMatch = searchRes?.results?.results?.find(
    (r) => cleanAnimeSlug(r.anime_id) === cleanSlug
  );

  const rawEpisodes = epApiRes?.results?.episodes || [];
  const s1Fallback = directData?.s1Episodes || [];
  const hasSeriesEpisodes = rawEpisodes.length > 0 || s1Fallback.length > 0;
  const hasMultipleSeasons = Boolean(directData?.seasons && directData.seasons.length > 1);

  const movieData = resolveMovieInfoData(movieInfo);
  const animeData = resolveAnimeInfoData(apiInfo);

  const isMovie =
    !hasSeriesEpisodes &&
    !hasMultipleSeasons &&
    (Boolean(directData?.isMovie) || (Boolean(movieData?.title) && !animeData?.title));

  let item: Anime | undefined;
  if (isMovie && movieData?.title) {
    item = mapMovieInfoToAnime(
      movieData,
      searchMatch?.poster || directData?.poster || undefined,
      directData?.title || undefined
    );
  } else if (animeData?.title) {
    item = mapApiInfoToAnime(
      animeData,
      searchMatch?.poster || directData?.poster || movieData?.poster || undefined,
      directData?.title || movieData?.title || undefined
    );
  } else if (directData) {
    const formattedTitle = directData.title || movieData?.title || formatDisplayTitle(cleanSlug);
    item = {
      id: cleanSlug,
      slug: cleanSlug,
      title: formattedTitle,
      synopsis:
        directData.synopsis ||
        (typeof movieData?.overview === "string"
          ? movieData.overview
          : `Watch ${formattedTitle} in Hindi on HindiAnime.`),
      poster: directData.poster || cleanSlug,
      backdrop: directData.backdrop || directData.poster || cleanSlug,
      rating: 8.5,
      year: new Date().getFullYear(),
      type: isMovie ? "Movie" : "TV",
      status: isMovie ? "Completed" : "Ongoing",
      durationMinutes: isMovie ? 110 : 24,
      episodeCount: directData.s1Episodes.length || 1,
      genres: ["action", "animation"],
      languages: ["hindi", "japanese", "english"],
      seasons: directData.seasons.length || 1,
      studio: "Anime",
      updatedAt: new Date().toISOString().split("T")[0],
    };
  } else if (searchMatch) {
    item = mapSearchItemToAnime(searchMatch);
  } else {
    item = getAnimeBySlug(cleanSlug);
  }

  if (!item) {
    const formattedTitle = formatDisplayTitle(cleanSlug);
    item = {
      id: cleanSlug,
      slug: cleanSlug,
      title: formattedTitle,
      synopsis: directData?.synopsis || "",
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

  // Override synopsis with scraped data if empty
  if (
    directData?.synopsis &&
    (!item.synopsis ||
      item.synopsis === SYNOPSIS_FALLBACK ||
      item.synopsis === "No synopsis available.")
  ) {
    item = { ...item, synopsis: directData.synopsis };
  }

  // Override title if current title contains percent encoding
  if (directData?.title && (!item.title || item.title.includes("%"))) {
    item = { ...item, title: directData.title };
  } else if (item.title && item.title.includes("%")) {
    item = { ...item, title: formatDisplayTitle(item.title) };
  }

  // Override poster & backdrop if missing or not usable
  if (directData?.poster && (!item.poster || !isUsableImageUrl(item.poster))) {
    item = { ...item, poster: directData.poster };
  }
  if (directData?.backdrop && (!item.backdrop || !isUsableImageUrl(item.backdrop))) {
    item = { ...item, backdrop: directData.backdrop };
  } else if (directData?.poster && (!item.backdrop || !isUsableImageUrl(item.backdrop))) {
    item = { ...item, backdrop: directData.poster };
  }

  return {
    title: item.title,
    description: item.synopsis,
    openGraph: {
      title: item.title,
      description: item.synopsis,
      type: item.type === "Movie" ? "video.movie" : "video.tv_show",
    },
    alternates: { canonical: `/anime/${cleanSlug}` },
  };
}

export default async function AnimeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const cleanSlug = cleanAnimeSlug(slug) || slug;
  const sParams = await searchParams;
  const currentSeason = sParams.season || "1";
  const seasonNum = parseInt(currentSeason, 10) || 1;

  const searchKeyword = formatDisplayTitle(cleanSlug).toLowerCase();

  // 1. Fetch info, movieInfo, search, direct scraper, seasons, and episodes in parallel
  const [apiInfo, movieInfo, searchRes, directData, availableSeasons, epApiRes] =
    await Promise.all([
      getAnimeInfo(cleanSlug),
      getMovieInfo(cleanSlug),
      searchAnime(searchKeyword, 1),
      scrapeDirectSeriesData(cleanSlug),
      getAvailableSeasons(cleanSlug),
      getEpisodes(cleanSlug, seasonNum),
    ]);

  // Match ONLY by exact slug
  const searchMatch = searchRes?.results?.results?.find(
    (r) => cleanAnimeSlug(r.anime_id) === cleanSlug
  );

  const rawEpisodes = epApiRes?.results?.episodes || [];
  const s1Fallback =
    seasonNum === 1 && directData?.s1Episodes ? directData.s1Episodes : [];
  const effectiveRawEpisodes =
    rawEpisodes.length > 0 ? rawEpisodes : s1Fallback;

  const hasSeriesEpisodes = effectiveRawEpisodes.length > 0;
  const hasMultipleSeasons =
    (availableSeasons && availableSeasons.length > 1) ||
    (directData?.seasons && directData.seasons.length > 1);

  const movieData = resolveMovieInfoData(movieInfo);
  const animeData = resolveAnimeInfoData(apiInfo);

  // A title is only a movie if it has NO series episodes and is confirmed as a movie
  const isMovie =
    !hasSeriesEpisodes &&
    !hasMultipleSeasons &&
    (Boolean(directData?.isMovie) ||
      (Boolean(movieData?.title) && !animeData?.title));

  let item: Anime | undefined;
  if (isMovie && movieData?.title) {
    item = mapMovieInfoToAnime(
      movieData,
      searchMatch?.poster || directData?.poster || undefined,
      directData?.title || undefined
    );
  } else if (animeData?.title) {
    item = mapApiInfoToAnime(
      animeData,
      searchMatch?.poster || directData?.poster || movieData?.poster || undefined,
      directData?.title || movieData?.title || undefined
    );
  } else {
    const formattedTitle =
      directData?.title ||
      movieData?.title ||
      searchMatch?.title ||
      formatDisplayTitle(cleanSlug);
    const poster =
      directData?.poster ||
      searchMatch?.poster ||
      movieData?.poster ||
      cleanSlug;

    const totalSeasonsCount =
      availableSeasons.length || directData?.seasons?.length || 1;

    item = {
      id: cleanSlug,
      slug: cleanSlug,
      title: formattedTitle,
      synopsis:
        directData?.synopsis ||
        (typeof movieData?.overview === "string"
          ? movieData.overview
          : SYNOPSIS_FALLBACK),
      poster,
      backdrop: directData?.backdrop || poster,
      rating: Number(movieData?.rating) || 8.5,
      year: Number(movieData?.year) || new Date().getFullYear(),
      type: isMovie ? "Movie" : "TV",
      status: isMovie ? "Completed" : "Ongoing",
      durationMinutes: isMovie ? 110 : 24,
      episodeCount: effectiveRawEpisodes.length || 12,
      genres: movieData?.genres?.map((g) =>
        g.toLowerCase().replace(/\s+/g, "-")
      ) || ["action", "animation"],
      languages: movieData?.languages
        ? parseLanguages(movieData.languages.join(","))
        : ["hindi", "japanese", "english"],
      seasons: totalSeasonsCount,
      studio: "Anime",
      updatedAt: new Date().toISOString().split("T")[0],
    };
  }

  if (!item) {
    const formattedTitle = formatDisplayTitle(cleanSlug);
    item = {
      id: cleanSlug,
      slug: cleanSlug,
      title: formattedTitle,
      synopsis: directData?.synopsis || "",
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

  // Override synopsis with scraped data if empty
  if (
    directData?.synopsis &&
    (!item.synopsis ||
      item.synopsis === SYNOPSIS_FALLBACK ||
      item.synopsis === "No synopsis available.")
  ) {
    item = { ...item, synopsis: directData.synopsis };
  }

  // Override title if current title contains percent encoding
  if (directData?.title && (!item.title || item.title.includes("%"))) {
    item = { ...item, title: directData.title };
  } else if (item.title && item.title.includes("%")) {
    item = { ...item, title: formatDisplayTitle(item.title) };
  }

  // Override poster & backdrop if missing or not usable
  if (directData?.poster && (!item.poster || !isUsableImageUrl(item.poster))) {
    item = { ...item, poster: directData.poster };
  }
  if (directData?.backdrop && (!item.backdrop || !isUsableImageUrl(item.backdrop))) {
    item = { ...item, backdrop: directData.backdrop };
  } else if (directData?.poster && (!item.backdrop || !isUsableImageUrl(item.backdrop))) {
    item = { ...item, backdrop: directData.poster };
  }

  // Ensure slug and id are strictly preserved
  item = { ...item, id: cleanSlug, slug: cleanSlug };

  // 2. Discover episodes & seasons
  let episodes: Episode[] = [];

  if (isMovie) {
    episodes = [
      {
        id: "ep-1-1",
        animeSlug: cleanSlug,
        animeTitle: item.title,
        animePoster: item.poster,
        season: 1,
        number: 1,
        title: "Full Movie",
        thumbnail: item.poster,
        durationMinutes: item.durationMinutes || 110,
        languages: item.languages,
        releasedAt: new Date().toISOString().split("T")[0],
      },
    ];
  } else {
    const totalSeasons =
      availableSeasons.length || directData?.seasons?.length || item.seasons;
    item = { ...item, seasons: totalSeasons };

    if (effectiveRawEpisodes.length > 0) {
      episodes = deduplicateEpisodes(
        effectiveRawEpisodes.map((ep, idx) =>
          mapApiEpisodeToEpisode(
            ep,
            item!.slug,
            item!.title,
            item!.poster,
            item!.languages,
            seasonNum,
            idx
          )
        )
      );
    } else {
      // Synthesize at least Episode 1 fallback so episode options are never empty
      episodes = [
        {
          id: `ep-${seasonNum}-1`,
          animeSlug: item.slug,
          animeTitle: item.title,
          animePoster: item.poster,
          season: seasonNum,
          number: 1,
          title: `Episode 1`,
          thumbnail: item.poster,
          durationMinutes: 24,
          languages: item.languages,
          releasedAt: new Date().toISOString().split("T")[0],
        },
      ];
    }
  }

  // 3. Build season list
  const allSeasons = isMovie
    ? [1]
    : Array.from(
        new Set([
          ...(availableSeasons.length ? availableSeasons : [1]),
          ...(directData?.seasons || []),
          seasonNum,
        ])
      ).sort((a, b) => a - b);

  const seasonList: SeasonItem[] = isMovie
    ? [{ season: "1", text: "Movie" }]
    : allSeasons.map((s) => ({
        season: String(s),
        text: `Season ${s}`,
      }));

  const firstEpisodeId = episodes.length > 0 ? episodes[0].id : `ep-${seasonNum}-1`;

  // Build related from homepage feed
  const homepageFeed = await getHomepageFeed();
  const feedSections = homepageFeed?.data?.results;
  const relatedRaw = feedSections
    ? [
        ...(feedSections.mostWatched_Series ?? []),
        ...(feedSections.on_air_series ?? []),
      ]
    : [];
  const related = relatedRaw
    .map((candidate) => mapSearchItemToAnime(candidate))
    .filter((candidate) => candidate.slug !== item!.slug)
    .slice(0, 12);

  return (
    <div className="pb-14">
      <div className="relative h-64 overflow-hidden border-b border-border-line sm:h-80 md:h-96">
        <PosterArt
          seed={item.backdrop}
          title={item.title}
          orientation="landscape"
          className="h-full"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-background/10" />
      </div>

      <AnimeInfo item={item} firstEpisodeId={firstEpisodeId} />

      {episodes.length > 0 && (
        <div className="container-page mt-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xl font-bold text-text-primary">
                Episodes
              </h2>
              {!isMovie && (
                <span className="rounded-full bg-surface-elevated px-2.5 py-0.5 text-xs font-semibold text-text-secondary border border-border-line">
                  {episodes.length} Episodes
                </span>
              )}
            </div>
            {!isMovie && seasonList.length > 1 && (
              <SeasonSelector
                seasons={seasonList}
                currentSeason={currentSeason}
              />
            )}
          </div>
          <EpisodeList episodes={episodes} animeSlug={item.slug} />
        </div>
      )}

      {related.length > 0 && (
        <AnimeRow title="You Might Also Like" items={related} />
      )}
    </div>
  );
}
