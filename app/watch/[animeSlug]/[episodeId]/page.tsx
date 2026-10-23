import type { Metadata } from "next";
import { cache } from "react";
import { createCanonicalMetadata } from "@/lib/seo";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { StreamPlayer } from "@/components/player/StreamPlayer";
import { MockWatchUnavailable } from "@/components/player/MockWatchUnavailable";
import { ReadMoreText } from "@/components/ui/ReadMoreText";
import { WatchTracker } from "@/components/player/WatchTracker";
import { EpisodeNavigation } from "@/components/episodes/EpisodeNavigation";
import { EpisodeList } from "@/components/episodes/EpisodeList";
import { SeasonSelector } from "@/components/episodes/SeasonSelector";
import { Badge } from "@/components/ui/Badge";
import { FavoriteButton } from "@/components/anime/FavoriteButton";
import { AnimeRow } from "@/components/anime/AnimeRow";
import { Play, ChevronRight } from "lucide-react";
import { getAnimeBySlug, getAnimeByGenre, anime as mockAnimeList } from "@/lib/mock/anime";
import { genres } from "@/lib/mock/genres";
import { staticCatalog } from "@/lib/static-catalog";
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

export const revalidate = 21600;
export const dynamicParams = true;

export function generateStaticParams() {
  return mockAnimeList
    .filter((item) => !item.isMock && item.type !== "Movie")
    .sort((a, b) => (a.popularityRank ?? Number.MAX_SAFE_INTEGER) - (b.popularityRank ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 5)
    .map((item) => ({ animeSlug: item.slug, episodeId: "ep-1-1" }));
}
import type { Anime } from "@/types/anime";
import type { Episode } from "@/types/episode";
import type { SeasonItem } from "@/types/api";
import { deduplicateEpisodes } from "@/lib/episodes";
import { CANONICAL_SITE_ORIGIN, DEFAULT_OG_IMAGE, getCanonicalUrl } from "@/lib/seo";
import { MOCK_ARTWORK_URL } from "@/lib/mock/artwork";

const getWatchPageBaseData = cache(async (slug: string) => {
  const searchKeyword = formatDisplayTitle(slug).toLowerCase();
  return Promise.all([
    getAnimeInfo(slug),
    getMovieInfo(slug),
    searchAnime(searchKeyword, 1),
    scrapeDirectSeriesData(slug),
  ]);
});

const getWatchPageEpisodes = cache((slug: string, season: number) => getEpisodes(slug, season));
const getWatchPageSeasons = cache((slug: string) => getAvailableSeasons(slug));

function createFallbackAnime(slug: string): Anime {
  const mock = getAnimeBySlug(slug);
  const formattedTitle = formatDisplayTitle(slug);
  return {
    id: slug,
    slug,
    title: mock?.title || formattedTitle,
    synopsis: mock?.synopsis || SYNOPSIS_FALLBACK,
    poster: mock?.poster || slug,
    backdrop: mock?.backdrop || slug,
    rating: mock?.rating || 8.5,
    year: mock?.year || new Date().getFullYear(),
    type: mock?.type || "TV",
    status: mock?.status || "Ongoing",
    durationMinutes: mock?.durationMinutes || 24,
    episodeCount: mock?.episodeCount || 1,
    genres: mock?.genres && mock.genres.length > 0 ? mock.genres : [],
    languages: mock?.languages && mock.languages.length > 0 ? mock.languages : ["hindi", "japanese", "english"],
    seasons: mock?.seasons || 1,
    studio: mock?.studio || "Anime",
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
  const mockAnime = getAnimeBySlug(cleanSlug);
  if (mockAnime?.isMock) {
    const episodeMatch = episodeId.match(/ep-(\d+)-(\d+)/);
    const episodeLabel = episodeId === "movie"
      ? "Full Movie"
      : episodeMatch
      ? `Season ${episodeMatch[1]} Episode ${episodeMatch[2]}`
      : episodeId;
    const title = `${mockAnime.title} — ${episodeLabel} | Hindi Anime`;
    const description = `Watch ${mockAnime.title} ${episodeLabel} on Hindi Anime.`;
    const artwork = new URL(MOCK_ARTWORK_URL, CANONICAL_SITE_ORIGIN).toString();
    return createCanonicalMetadata(`/watch/${cleanSlug}/${episodeId}`, {
      title: { absolute: title },
      description,
      robots: { index: false, follow: true },
      openGraph: { title, description, images: [{ url: artwork, alt: mockAnime.title }] },
      twitter: { card: "summary_large_image", title, description, images: [artwork] },
    });
  }

  const epMatch = episodeId.match(/ep-(\d+)-(\d+)/);
  const seasonNumber = epMatch ? parseInt(epMatch[1], 10) || 1 : 1;

  const [[apiInfo, movieInfo, searchRes, directData], epApiRes] = await Promise.all([
    getWatchPageBaseData(cleanSlug),
    getWatchPageEpisodes(cleanSlug, seasonNumber),
  ]);

  const searchMatch = searchRes?.results?.results?.find(
    (r) => cleanAnimeSlug(r.anime_id) === cleanSlug
  );

  const rawEpisodes = epApiRes?.results?.episodes || [];
  // Do NOT count scraper's movie s1Episodes as series episodes
  const s1Fallback = seasonNumber === 1 && directData?.s1Episodes && !directData.isMovie
    ? directData.s1Episodes
    : [];
  const hasSeriesEpisodes = rawEpisodes.length > 0 || s1Fallback.length > 0;
  const hasMultipleSeasons = Boolean(directData?.seasons && directData.seasons.length > 1 && !directData.isMovie);

  const movieData = resolveMovieInfoData(movieInfo);
  const animeDataMeta = resolveAnimeInfoData(apiInfo);

  const isMovieRoute = episodeId === "movie";
  const isMovie =
    isMovieRoute ||
    Boolean(directData?.isMovie) ||
    (!hasSeriesEpisodes &&
      !hasMultipleSeasons &&
      (Boolean(movieData?.title) && !animeDataMeta?.title));

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
        (typeof movieData?.overview === "string" ? movieData.overview : SYNOPSIS_FALLBACK),
      poster,
      backdrop: directData?.backdrop || poster,
      rating: Number(movieData?.rating) || 8.5,
      year: Number(movieData?.year) || new Date().getFullYear(),
      type: isMovie ? "Movie" : "TV",
      status: isMovie ? "Completed" : "Ongoing",
      durationMinutes: isMovie ? 110 : 24,
      episodeCount: rawEpisodes.length || s1Fallback.length || 1,
      genres:
        (directData?.genres && directData.genres.length > 0 ? directData.genres : undefined) ||
        (movieData?.genres && movieData.genres.length > 0
          ? movieData.genres.map((g) => g.toLowerCase().replace(/\s+/g, "-"))
          : undefined) ||
        (getAnimeBySlug(cleanSlug)?.genres && getAnimeBySlug(cleanSlug)!.genres.length > 0
          ? getAnimeBySlug(cleanSlug)!.genres
          : []),
      languages: movieData?.languages
        ? parseLanguages(movieData.languages.join(","))
        : ["hindi", "japanese", "english"],
      seasons: directData?.seasons?.length || 1,
    };
  }

  // ── Clean the anime title before using in metadata ───────────────────────
  function cleanAnimeTitle(rawTitle: string): string {
    return rawTitle
      .replace(/\s*[-–—:]\s*Watch\s*(?:Now|Online).*$/i, "")
      .replace(/\s*[-–—:]\s*Hindi\s*Dubbed.*$/i, "")
      .replace(/\s*[-–—:]\s*(?:Hindi|Tamil|Telugu|Malayalam|Kannada|Bengali|Marathi|English|Japanese|Dubbed|Subbed).*$/i, "")
      .replace(/\s*[-–—:]\s*All\s*Episodes.*$/i, "")
      .replace(/\s*[-–—:]\s*Episodes?.*$/i, "")
      .replace(/\s*[-–—:]\s*Anime\s*Salt.*$/i, "")
      .replace(/\s*[([]?\s*Hindi\s*Dub(?:bed)?\s*[)\]]?\s*$/i, "")
      .trim();
  }

  const rawTitle =
    directData?.title ||
    (anime.title && !anime.title.includes("%") ? anime.title : formatDisplayTitle(cleanSlug));
  const cleanTitle = cleanAnimeTitle(rawTitle) || formatDisplayTitle(cleanSlug);

  // ── Build SEO metadata for the episode/watch page ────────────────────────
  const siteUrl = CANONICAL_SITE_ORIGIN;

  // Episode label: "Season 1 Episode 3" or "Full Movie"
  let episodeLabel: string;
  if (isMovie) {
    episodeLabel = "Full Movie";
  } else {
    const m = episodeId.match(/ep-(\d+)-(\d+)/);
    episodeLabel = m ? `Season ${m[1]} Episode ${m[2]}` : episodeId;
  }

  // Concise page title — use title.absolute to avoid layout template doubling
  const seoTitle = `${cleanTitle} — ${episodeLabel} | Hindi Anime`;

  // Description: lead with episode context, append synopsis snippet if real
  function buildWatchDescription(): string {
    const hasSynopsis =
      anime.synopsis &&
      anime.synopsis !== SYNOPSIS_FALLBACK &&
      anime.synopsis !== "No synopsis available." &&
      anime.synopsis.length > 20;

    const lead = isMovie
      ? `Watch ${cleanTitle} full movie`
      : `Watch ${cleanTitle} ${episodeLabel}`;

    if (!hasSynopsis) return `${lead} on Hindi Anime.`;

    // Append a short synopsis snippet (≤120 chars total for the sentence)
    const raw = anime.synopsis!.replace(/\s+/g, " ").trim();
    const maxSnippet = 120 - lead.length - 4; // 4 = " — " + "."
    if (maxSnippet < 20) return `${lead} on Hindi Anime.`;
    const snippet =
      raw.length <= maxSnippet
        ? raw
        : raw.slice(0, raw.lastIndexOf(" ", maxSnippet - 1) || maxSnippet) + "…";
    return `${lead} — ${snippet}`;
  }

  const seoDescription = buildWatchDescription();

  const canonicalUrl = getCanonicalUrl(`/watch/${cleanSlug}/${episodeId}`);
  const posterUrl = anime.poster && anime.poster.startsWith("http") ? anime.poster : DEFAULT_OG_IMAGE;

  return {
    title: {
      absolute: seoTitle,
    },
    description: seoDescription,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: seoTitle,
      description: seoDescription,
      type: isMovie ? "video.movie" : "video.episode",
      url: canonicalUrl,
      siteName: "Hindi Anime",
      locale: "en_US",
      images: [
        {
          url: posterUrl,
          alt: cleanTitle,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: seoTitle,
      description: seoDescription,
      images: [posterUrl],
    },
  };
}

export default async function WatchPage({
  params,
}: {
  params: Promise<{ animeSlug: string; episodeId: string }>;
}) {
  const { animeSlug: rawSlug, episodeId } = await params;
  const cleanSlug = cleanAnimeSlug(rawSlug) || rawSlug;
  const mockRecord = getAnimeBySlug(cleanSlug);
  if (mockRecord?.isMock) return <MockWatchUnavailable anime={mockRecord} />;

  // 'movie' is a special episodeId used for all movies — skip episode regex
  const isMovieRoute = episodeId === "movie";
  const epMatch = isMovieRoute ? null : episodeId.match(/ep-(\d+)-(\d+)/);
  const seasonNumber = epMatch ? parseInt(epMatch[1], 10) || 1 : 1;
  const episodeNumber = epMatch ? parseInt(epMatch[2], 10) || 1 : 1;

  // ── 1. Resolve anime metadata & episodes concurrently ──────────────────────
  const [[apiInfo, movieInfo, searchRes, directData], discoveredSeasons, epApiRes] = await Promise.all([
    getWatchPageBaseData(cleanSlug),
    getWatchPageSeasons(cleanSlug),
    // Skip episode fetch for explicit movie routes
    isMovieRoute ? Promise.resolve(null) : getWatchPageEpisodes(cleanSlug, seasonNumber),
  ]);

  // Match strictly by exact slug — never hijack identity with random search results
  const searchMatch = searchRes?.results?.results?.find(
    (r) => cleanAnimeSlug(r.anime_id) === cleanSlug
  );

  const rawEpisodes = epApiRes?.results?.episodes || [];
  // Do NOT count scraper's movie s1Episodes as series episodes
  const s1Fallback = seasonNumber === 1 && directData?.s1Episodes && !directData.isMovie
    ? directData.s1Episodes
    : [];
  const effectiveRawEpisodes = rawEpisodes.length > 0 ? rawEpisodes : s1Fallback;

  const hasSeriesEpisodes = effectiveRawEpisodes.length > 0;
  const hasMultipleSeasons =
    (discoveredSeasons && discoveredSeasons.length > 1) ||
    Boolean(directData?.seasons && directData.seasons.length > 1 && !directData.isMovie);

  const movieData = resolveMovieInfoData(movieInfo);
  const animeData = resolveAnimeInfoData(apiInfo);
  const mockAnime = getAnimeBySlug(cleanSlug);
  const searchItemType = searchMatch ? mapSearchItemToAnime(searchMatch).type : undefined;

  // isMovieRoute (episodeId === 'movie') is the strongest signal — always a movie.
  // Only classify as movie if explicitly a movie route or confirmed movie type with no series episodes
  const isMovie =
    isMovieRoute ||
    (Boolean(directData?.isMovie) && mockAnime?.type !== "TV" && episodeId === "movie") ||
    (!hasSeriesEpisodes &&
      !hasMultipleSeasons &&
      episodeId === "movie" &&
      Boolean(movieData?.title) &&
      !animeData?.title);

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

  const isTitleValid = (t?: string) =>
    Boolean(t && !t.toLowerCase().includes("404") && !t.toLowerCase().includes("not found"));

  const bestTitle =
    (isTitleValid(directData?.title) ? directData!.title : "") ||
    (movieData?.title && !animeData?.title && isTitleValid(movieData.title) ? movieData.title : "") ||
    (isTitleValid(anime.title) ? anime.title : "") ||
    formatDisplayTitle(cleanSlug);

  const bestPoster =
    directData?.poster ||
    directData?.backdrop ||
    (isUsableImageUrl(anime.poster) ? anime.poster : "") ||
    (movieData?.poster && isUsableImageUrl(movieData.poster) ? movieData.poster : "") ||
    cleanSlug;

  const totalSeasonsCount =
    discoveredSeasons.length || directData?.seasons?.length || anime.seasons || 1;

  const resolvedGenres =
    (directData?.genres && directData.genres.length > 0 ? directData.genres : undefined) ||
    (animeData?.genres && animeData.genres.length > 0 ? animeData.genres : undefined) ||
    (movieData?.genres && movieData.genres.length > 0
      ? movieData.genres.map((g) => g.toLowerCase().replace(/\s+/g, "-"))
      : undefined) ||
    (mockAnime?.genres && mockAnime.genres.length > 0 ? mockAnime.genres : undefined) ||
    [];

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
    genres: resolvedGenres.length > 0 ? resolvedGenres : anime.genres,
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

  const availableSeasons = Array.from(
    new Set([...discoveredList, seasonNumber])
  ).sort((a, b) => a - b);

  const seasonList: SeasonItem[] = availableSeasons.map((season) => ({
    season: String(season),
    text: `Season ${season}`,
  }));

  // ── 2. Build episodes list for current season ──────────────────────────────
  let episodes: Episode[] = [];

  if (isMovie) {
    // Redirect old ep-* movie URLs to the clean /movie route
    if (episodeId !== "movie") {
      redirect(`/watch/${cleanSlug}/movie`);
    }
    episodes = [
      {
        id: "movie",
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

  // If still empty, synthesize the full episode list for the season
  if (episodes.length === 0) {
    const totalCount = Math.max(anime.episodeCount || 12, episodeNumber);
    episodes = Array.from({ length: totalCount }, (_, i) => {
      const num = i + 1;
      return {
        id: `ep-${seasonNumber}-${num}`,
        animeSlug: anime.slug,
        animeTitle: anime.title,
        animePoster: anime.poster,
        season: seasonNumber,
        number: num,
        title: `Episode ${num}`,
        thumbnail: anime.poster,
        durationMinutes: 24,
        languages: anime.languages,
        releasedAt: new Date().toISOString().split("T")[0],
      };
    });
  }

  // ── 3. Find current active episode ─────────────────────────────────────────
  const requestedEpisodeId = `ep-${seasonNumber}-${episodeNumber}`;
  const currentIndex = episodes.findIndex(
    (e) =>
      e.id === requestedEpisodeId &&
      e.animeSlug === cleanSlug &&
      e.season === seasonNumber &&
      e.number === episodeNumber
  );

  const episode: Episode =
    (currentIndex >= 0 ? episodes[currentIndex] : undefined) || {
      id: requestedEpisodeId,
      animeSlug: cleanSlug,
      animeTitle: anime.title,
      animePoster: anime.poster,
      season: seasonNumber,
      number: episodeNumber,
      title: `Episode ${episodeNumber}`,
      thumbnail: anime.poster,
      durationMinutes: 24,
      languages: anime.languages,
      releasedAt: new Date().toISOString().split("T")[0],
    };

  const prevEpisode = currentIndex > 0 ? episodes[currentIndex - 1] : undefined;
  const nextEpisode = currentIndex >= 0 ? episodes[currentIndex + 1] : undefined;

  const episodeTitle = `EP ${episode.number} — ${episode.title}`;

  // ── 4. Build "You Might Also Like" genre-based anime ───────────────────────
  const nonGenreTags = new Set([
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

  const rawGenres = (anime.genres || [])
    .map((g) => g.toLowerCase().trim().replace(/\s+/g, "-"))
    .filter((g) => g && !nonGenreTags.has(g) && !g.startsWith("page"));

  const knownGenres = new Set(genres.map((g) => g.slug));

  const genrePriority = [
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

  // Determine the primary genre
  const primaryGenre =
    genrePriority.find((p) => rawGenres.includes(p)) ||
    rawGenres.find((g) => knownGenres.has(g)) ||
    rawGenres[0] ||
    "action";

  const seenSlugs = new Set<string>([cleanSlug]);
  const youMightAlsoLikePool: Anime[] = [];

  // Use the build-time catalog for related titles so rendering a detail or
  // watch page does not wait on additional scraper and homepage API calls.
  const localRelatedItems = staticCatalog.filter((candidate) =>
    candidate.genres?.some((genre) => {
      const normalizedGenre = genre.toLowerCase().trim().replace(/\s+/g, "-");
      return (rawGenres.length ? rawGenres : [primaryGenre]).includes(normalizedGenre);
    })
  );

  for (const item of localRelatedItems) {
    if (item.slug && !seenSlugs.has(item.slug)) {
      seenSlugs.add(item.slug);
      youMightAlsoLikePool.push(item);
    }
  }

  // 2. Mock anime matching any of this anime's genres (e.g. action, fantasy)
  for (const g of (rawGenres.length ? rawGenres : [primaryGenre])) {
    const mockGenreItems = getAnimeByGenre(g);
    for (const item of mockGenreItems) {
      if (item.slug && !seenSlugs.has(item.slug)) {
        seenSlugs.add(item.slug);
        youMightAlsoLikePool.push(item);
      }
    }
  }

  const youMightAlsoLike = youMightAlsoLikePool.slice(0, 18);

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
      <WatchTracker
        animeSlug={anime.slug}
        animeTitle={anime.title}
        animePoster={anime.poster}
        type={anime.type}
        season={episode.season}
        episode={episode.number}
        episodeId={episode.id}
        episodeTitle={episode.title}
        durationMinutes={episode.durationMinutes || anime.durationMinutes}
        genres={anime.genres}
      />

      <StreamPlayer
        key={`${anime.slug}:s${episode.season}:e${episode.number}`}
        animeSlug={anime.slug}
        season={episode.season}
        episode={episode.number}
        episodeTitle={episodeTitle}
        languages={episode.languages}
        isMovie={isMovie}
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
          <ReadMoreText
            text={anime.synopsis && anime.synopsis !== SYNOPSIS_FALLBACK
              ? anime.synopsis
              : `Watch ${anime.title} ${isMovie ? "Full Movie" : `Season ${episode.season} Episode ${episode.number}`} on Hindi Anime.`}
            className="mt-2 max-w-3xl text-sm leading-relaxed text-text-secondary"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <Badge tone="outline">{isMovie ? "Movie" : `Season ${episode.season}`}</Badge>
            <Badge tone="green">{anime.status}</Badge>
            {!isMovie && seasonList.length > 1 && (
              <SeasonSelector
                seasons={seasonList}
                currentSeason={seasonNumber}
                watchAnimeSlug={anime.slug}
              />
            )}
            <FavoriteButton
              anime={{
                animeSlug: anime.slug,
                title: anime.title,
                poster: anime.poster,
                rating: anime.rating,
                type: anime.type,
                genres: anime.genres,
                languages: anime.languages,
              }}
              variant="compact"
            />
          </div>

          {!isMovie && nextEpisode && (
            <Link
              href={`/watch/${anime.slug}/${nextEpisode.id}`}
              prefetch={false}
              className="group mt-3.5 inline-flex items-center gap-3 rounded-xl border border-border-line bg-surface/80 px-3.5 py-2 text-xs transition-all hover:border-green-primary/50 hover:bg-surface-elevated"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-green-primary/20 text-green-light">
                <Play className="h-3 w-3 fill-current" />
              </span>
              <div className="flex items-center gap-2">
                <span className="font-bold uppercase text-[10px] tracking-wider text-green-bright">Up Next:</span>
                <span className="font-medium text-text-primary group-hover:text-green-light transition-colors line-clamp-1">
                  EP {nextEpisode.number} &mdash; {nextEpisode.title}
                </span>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-text-muted group-hover:text-white transition-colors ml-1" />
            </Link>
          )}
        </div>
        {!isMovie && (
          <EpisodeNavigation
            animeSlug={anime.slug}
            prevId={prevEpisode?.id}
            nextId={nextEpisode?.id}
          />
        )}
      </div>

      {/* Episode list — only shown for series, never for movies */}
      {!isMovie && !isMovieRoute && anime.type !== "Movie" && (
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

      {/* You Might Also Like */}
      {youMightAlsoLike.length > 0 && (
        <div className="mt-10 pt-6 border-t border-border-line/60">
          <AnimeRow
            title="You Might Also Like"
            items={youMightAlsoLike}
            className="py-0"
            containerClassName="w-full"
            viewAllHref={`/genre/${primaryGenre}`}
          />
        </div>
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": isMovie ? "Movie" : "TVEpisode",
                "@id": `${getCanonicalUrl(`/watch/${cleanSlug}/${episodeId}`)}#media`,
                url: getCanonicalUrl(`/watch/${cleanSlug}/${episodeId}`),
                name: `${anime.title} ${isMovie ? "Full Movie" : episode.title || `Episode ${episode.number}`}`,
                description: anime.synopsis,
                image: anime.poster,
                episodeNumber: !isMovie ? episode.number : undefined,
                ...(!isMovie
                  ? {
                      partOfSeries: {
                        "@type": "TVSeries",
                        name: anime.title,
                        url: getCanonicalUrl(`/anime/${cleanSlug}`),
                      },
                    }
                  : {}),
              },
              {
                "@type": "BreadcrumbList",
                "@id": `${getCanonicalUrl(`/watch/${cleanSlug}/${episodeId}`)}#breadcrumbs`,
                itemListElement: [
                  {
                    "@type": "ListItem",
                    position: 1,
                    name: "Home",
                    item: CANONICAL_SITE_ORIGIN,
                  },
                  {
                    "@type": "ListItem",
                    position: 2,
                    name: anime.title,
                    item: getCanonicalUrl(`/anime/${cleanSlug}`),
                  },
                  {
                    "@type": "ListItem",
                    position: 3,
                    name: isMovie ? "Watch Movie" : `Watch Episode ${episode.number}`,
                    item: getCanonicalUrl(`/watch/${cleanSlug}/${episodeId}`),
                  },
                ],
              },
            ],
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
