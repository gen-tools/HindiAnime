import Link from "next/link";
import { notFound } from "next/navigation";
import { StreamPlayer } from "@/components/player/StreamPlayer";
import { WatchTracker } from "@/components/player/WatchTracker";
import { PosterArt } from "@/components/anime/PosterArt";
import { getAnimeBySlug } from "@/lib/mock/anime";
import {
  cleanAnimeSlug,
  formatDisplayTitle,
  getAnimeInfo,
  getAvailableSeasons,
  getEpisodes,
  getMovieInfo,
  mapSearchItemToAnime,
  resolveAnimeInfoData,
  resolveMovieInfoData,
  searchAnime,
  scrapeDirectSeriesData,
  isUsableImageUrl,
  parseDurationMinutes,
  SYNOPSIS_FALLBACK,
} from "@/lib/api/client";

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function movieTitleMatchesSlug(title: string, slug: string): boolean {
  const normalizedTitle = normalizeTitle(title).replace(/-movie$/, "");
  const normalizedSlug = normalizeTitle(slug).replace(/-movie$/, "");
  return normalizedTitle === normalizedSlug;
}

export default async function MovieWatchPage({
  params,
}: {
  params: Promise<{ animeSlug: string }>;
}) {
  const { animeSlug: rawSlug } = await params;
  const slug = cleanAnimeSlug(rawSlug) || rawSlug;
  const keyword = formatDisplayTitle(slug).toLowerCase();
  const [apiInfo, movieInfo, searchResult, directData, seasons, episodes] = await Promise.all([
    getAnimeInfo(slug),
    getMovieInfo(slug),
    searchAnime(keyword, 1),
    scrapeDirectSeriesData(slug),
    getAvailableSeasons(slug),
    getEpisodes(slug, 1),
  ]);

  const animeData = resolveAnimeInfoData(apiInfo);
  const movieData = resolveMovieInfoData(movieInfo);
  const searchMatch = searchResult?.results?.results?.find(
    (item) => cleanAnimeSlug(item.anime_id) === slug
  );
  const searchType = searchMatch ? mapSearchItemToAnime(searchMatch).type : undefined;
  const mockAnime = getAnimeBySlug(slug);
  const matchingMovie =
    movieData?.title && movieTitleMatchesSlug(movieData.title, slug)
      ? movieData
      : null;
  const hasSeriesEpisodes = Boolean(episodes?.results?.episodes?.length);
  const hasMultipleSeasons = (seasons?.length || 0) > 1 || (directData?.seasons?.length || 0) > 1;
  const isMovie =
    mockAnime?.type === "Movie" ||
    directData?.isMovie === true ||
    animeData?.quality?.toUpperCase().includes("MOVIE") === true ||
    searchType === "Movie" ||
    (!hasSeriesEpisodes &&
      !hasMultipleSeasons &&
      mockAnime?.type !== "TV" &&
      Boolean(matchingMovie?.title));

  if (!isMovie) notFound();

  const title =
    matchingMovie?.title ||
    (isMovie ? movieData?.title : undefined) ||
    directData?.title ||
    animeData?.title ||
    searchMatch?.title ||
    mockAnime?.title ||
    formatDisplayTitle(slug);
  const poster =
    (directData?.poster && isUsableImageUrl(directData.poster) ? directData.poster : "") ||
    (matchingMovie?.poster && isUsableImageUrl(matchingMovie.poster) ? matchingMovie.poster : "") ||
    (mockAnime?.poster && isUsableImageUrl(mockAnime.poster) ? mockAnime.poster : "") ||
    slug;
  const synopsis =
    (typeof matchingMovie?.overview === "string" ? matchingMovie.overview : "") ||
    directData?.synopsis ||
    (mockAnime?.synopsis && mockAnime.synopsis !== SYNOPSIS_FALLBACK ? mockAnime.synopsis : "");

  // The existing playback API accepts season/episode parameters; this page does
  // not create an Episode record or expose episode controls for a movie.
  return (
    <div className="pb-14">
      <div className="container-page pt-5">
        <nav className="mb-4 text-sm text-text-muted" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-green-light">Home</Link>
          <span className="mx-1.5">/</span>
          <span className="text-text-secondary">{title}</span>
        </nav>

        <WatchTracker
          animeSlug={slug}
          animeTitle={title}
          animePoster={poster}
          type="Movie"
          season={0}
          episode={0}
          episodeId="movie"
          episodeTitle="Full Movie"
          durationMinutes={movieData?.run_time || movieData?.runningTime
            ? parseDurationMinutes(movieData.run_time || movieData.runningTime)
            : undefined}
          genres={directData?.genres || matchingMovie?.genres?.map((genre) => genre.toLowerCase().replace(/\s+/g, "-")) || []}
        />

        <StreamPlayer
          key={`${slug}:movie`}
          animeSlug={slug}
          season={1}
          episode={1}
          episodeTitle={`${title} — Full Movie`}
        />

        <div className="mt-5 flex gap-4">
          <div className="hidden w-24 shrink-0 overflow-hidden rounded-lg sm:block">
            <PosterArt seed={poster} title={title} className="h-full w-full object-cover" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-text-primary md:text-2xl">{title}</h1>
            <p className="mt-1 text-sm text-text-secondary">Full Movie</p>
            {synopsis && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-secondary">{synopsis}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
