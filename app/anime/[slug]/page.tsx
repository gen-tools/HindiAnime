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

  const [apiInfo, movieInfo, searchRes, directData] = await Promise.all([
    getAnimeInfo(cleanSlug),
    getMovieInfo(cleanSlug),
    searchAnime(searchKeyword, 1),
    scrapeDirectSeriesData(cleanSlug),
  ]);

  const searchMatch = searchRes?.results?.results?.find(
    (r) => cleanAnimeSlug(r.anime_id) === cleanSlug
  );

  let item: Anime | undefined;
  const movieData = resolveMovieInfoData(movieInfo);
  const animeData = resolveAnimeInfoData(apiInfo);
  if (movieData?.title) {
    item = mapMovieInfoToAnime(
      movieData,
      searchMatch?.poster || directData?.poster || undefined,
      directData?.title || undefined
    );
  } else if (animeData) {
    item = mapApiInfoToAnime(
      animeData,
      searchMatch?.poster || directData?.poster || undefined,
      directData?.title || undefined
    );
  } else if (directData) {
    const formattedTitle = directData.title || formatDisplayTitle(cleanSlug);
    item = {
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

  // Override synopsis with scraped data if the API returned the fallback or empty
  if (
    directData?.synopsis &&
    (!item.synopsis ||
      item.synopsis === SYNOPSIS_FALLBACK ||
      item.synopsis === "No synopsis available.")
  ) {
    item = { ...item, synopsis: directData.synopsis };
  }

  // Override title if current title contains percent encoding or fallback
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

  // 1. Fetch info, movieInfo, direct scraper data and search in parallel
  const [apiInfo, movieInfo, searchRes, directData] = await Promise.all([
    getAnimeInfo(cleanSlug),
    getMovieInfo(cleanSlug),
    searchAnime(searchKeyword, 1),
    scrapeDirectSeriesData(cleanSlug),
  ]);

  // Match ONLY by exact slug
  const searchMatch = searchRes?.results?.results?.find(
    (r) => cleanAnimeSlug(r.anime_id) === cleanSlug
  );

  let item: Anime | undefined;
  const movieData = resolveMovieInfoData(movieInfo);
  const animeData = resolveAnimeInfoData(apiInfo);
  // Only treat as a Movie if the scraper also confirms it's a movie.
  // This prevents series like Solo Leveling (which have a separate movie entry)
  // from being misclassified as Movies because getMovieInfo returns data.
  const confirmedMovie = movieData?.title && (directData?.isMovie !== false);
  if (confirmedMovie) {
    item = mapMovieInfoToAnime(
      movieData!,
      searchMatch?.poster || directData?.poster || undefined,
      directData?.title || undefined
    );
  } else if (animeData) {
    item = mapApiInfoToAnime(
      animeData,
      searchMatch?.poster || directData?.poster || undefined,
      directData?.title || undefined
    );
  } else if (directData) {
    const formattedTitle = directData.title || formatDisplayTitle(cleanSlug);
    item = {
      id: cleanSlug,
      slug: cleanSlug,
      title: formattedTitle,
      synopsis: directData.synopsis || "",
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

  // Override synopsis with scraped data if the API returned the fallback or empty
  if (
    directData?.synopsis &&
    (!item.synopsis ||
      item.synopsis === SYNOPSIS_FALLBACK ||
      item.synopsis === "No synopsis available.")
  ) {
    item = { ...item, synopsis: directData.synopsis };
  }

  // Override title if current title contains percent encoding or fallback
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

  if (item.type === "Movie" || directData?.isMovie) {
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
    const [availableSeasons, epApiRes] = await Promise.all([
      getAvailableSeasons(cleanSlug),
      getEpisodes(cleanSlug, seasonNum),
    ]);
    const rawEpisodes = epApiRes?.results?.episodes || [];

    const totalSeasons = availableSeasons.length || directData?.seasons?.length || item.seasons;
    item = { ...item, seasons: totalSeasons };

    if (rawEpisodes.length > 0) {
      episodes = deduplicateEpisodes(
        rawEpisodes.map((ep, idx) =>
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
    } else if (seasonNum === 1 && directData?.s1Episodes && directData.s1Episodes.length > 0) {
      episodes = deduplicateEpisodes(
        directData.s1Episodes.map((ep, idx) =>
          mapApiEpisodeToEpisode(
            ep,
            item!.slug,
            item!.title,
            item!.poster,
            item!.languages,
            1,
            idx
          )
        )
      );
    }
  }

  // 3. Build season list
  const isMovie = item.type === "Movie" || Boolean(directData?.isMovie);
  const totalSeasonsCount = isMovie ? 1 : item.seasons || 1;
  const seasonList: SeasonItem[] = isMovie
    ? [{ season: "1", text: "Movie" }]
    : Array.from({ length: totalSeasonsCount }, (_, idx) => ({
        season: String(idx + 1),
        text: `Season ${idx + 1}`,
      }));

  const firstEpisodeId = episodes.length > 0 ? episodes[0].id : "ep-1-1";

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
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="font-display text-xl font-bold text-text-primary">
              Episodes
            </h2>
            <SeasonSelector
              seasons={seasonList}
              currentSeason={currentSeason}
            />
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
