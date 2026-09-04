import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Play, Info, Sparkles, Clock } from "lucide-react";
import { PosterArt } from "@/components/anime/PosterArt";
import { RatingBadge } from "@/components/ui/RatingBadge";
import { LanguageBadges } from "@/components/anime/LanguageBadges";
import { ButtonLink } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { NoResultsState } from "@/components/search/SearchStates";
import { Pagination } from "@/components/ui/Pagination";
import {
  enrichAnimeSynopses,
  getCatalog,
  mapSearchItemToAnime,
  SYNOPSIS_FALLBACK,
} from "@/lib/api/client";
import { genres } from "@/lib/mock/genres";
import { languages } from "@/lib/mock/languages";
import { formatDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Anime Movies | Dubbed & Subbed in Hindi, Tamil, Telugu | HINDIANIME",
  description:
    "Stream blockbuster anime movies including Suzume, Your Name, Jujutsu Kaisen 0, Mugen Train, Spirited Away, and more in Hindi and regional dubs.",
};

export default async function MoviesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const movieResponse = await getCatalog("movies", page);
  const totalPages = movieResponse?.results?.totalPages ?? 1;
  const apiMovies = await enrichAnimeSynopses(
    (movieResponse?.results?.results ?? []).map((item) =>
      mapSearchItemToAnime(item, "Movie")
    )
  );
  const featured = apiMovies[0];
  let results = [...apiMovies];

  const category = params.category || "all";
  const genre = params.genre;
  const language = params.language;
  const sort = params.sort || "rating";

  if (category === "hindi") {
    results = results.filter((m) => m.languages.includes("hindi"));
  } else if (category === "action") {
    results = results.filter((m) => m.genres.some((g) => ["action", "thriller"].includes(g)));
  } else if (category === "romance") {
    results = results.filter((m) => m.genres.some((g) => ["romance", "drama"].includes(g)));
  } else if (category === "top_rated") {
    results = results.filter((m) => m.rating >= 8.8);
  }

  if (genre) results = results.filter((m) => m.genres.includes(genre));
  if (language) results = results.filter((m) => m.languages.includes(language as never));
  if (params.year) results = results.filter((m) => String(m.year) === params.year);

  if (sort === "rating") results = [...results].sort((a, b) => b.rating - a.rating);
  if (sort === "year") results = [...results].sort((a, b) => b.year - a.year);
  if (sort === "title") results = [...results].sort((a, b) => a.title.localeCompare(b.title));

  function buildHref(p: number) {
    const next = new URLSearchParams(params as Record<string, string>);
    next.set("page", String(p));
    return `/movies?${next.toString()}`;
  }

  const showSpotlight =
    featured && page === 1 && category === "all" && !genre && !language && !params.year;

  return (
    <div>
      {/* Featured Movie Spotlight Hero */}
      {showSpotlight && (
        <section className="relative overflow-hidden border-b border-border-line">
          <div className="absolute inset-0">
            <PosterArt
              seed={featured.backdrop}
              title={featured.title}
              orientation="landscape"
              className="h-full w-full object-cover"
              priority
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/30" />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />

          <div className="container-page relative flex min-h-[460px] flex-col justify-end gap-4 py-16">
            <div className="inline-flex items-center gap-2 rounded-full border border-green-primary/40 bg-green-primary/20 px-3 py-1 text-xs font-semibold text-green-light w-fit backdrop-blur-md">
              <Sparkles className="h-3.5 w-3.5" />
              <span>PREMIERE SPOTLIGHT</span>
            </div>

            <h1 className="font-display max-w-2xl text-3xl font-extrabold text-white sm:text-5xl md:text-6xl drop-shadow-md">
              {featured.title}
            </h1>

            <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
              <RatingBadge rating={featured.rating} />
              <Badge tone="green">HD 1080p</Badge>
              <span>{featured.year}</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-text-muted" />
                {formatDuration(featured.durationMinutes)}
              </span>
              <div className="hidden sm:block">
                <LanguageBadges languages={featured.languages} max={4} />
              </div>
            </div>

            {featured.synopsis && featured.synopsis !== SYNOPSIS_FALLBACK && (
              <p className="max-w-xl text-sm leading-relaxed text-text-secondary line-clamp-3">
                {featured.synopsis}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-3">
              <ButtonLink
                href={`/anime/${featured.slug}`}
                size="lg"
                icon={<Play className="h-4 w-4 fill-white" />}
                className="shadow-[0_0_20px_rgba(34,197,94,0.4)]"
              >
                Watch Movie
              </ButtonLink>
              <ButtonLink
                href={`/anime/${featured.slug}`}
                variant="secondary"
                size="lg"
                icon={<Info className="h-4 w-4" />}
              >
                Details &amp; Cast
              </ButtonLink>
            </div>
          </div>
        </section>
      )}

      {/* Main Movies Catalog Section */}
      <div className="container-page py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-text-primary">
              All Anime Movies
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Page {page} of {totalPages} • Showing {results.length} full-length theatrical features &amp; specials
            </p>
          </div>

          {/* Quick Category Chips */}
          <div className="flex flex-wrap gap-2 text-xs">
            <Link
              href="/movies"
              className={cn(
                "rounded-full px-3 py-1.5 font-medium border transition-colors",
                category === "all"
                  ? "border-green-bright bg-green-primary/20 text-green-light"
                  : "border-border-line bg-surface text-text-secondary hover:text-white"
              )}
            >
              All
            </Link>
            <Link
              href="/movies?category=hindi"
              className={cn(
                "rounded-full px-3 py-1.5 font-medium border transition-colors",
                category === "hindi"
                  ? "border-green-bright bg-green-primary/20 text-green-light"
                  : "border-border-line bg-surface text-text-secondary hover:text-white"
              )}
            >
              Hindi Dubbed
            </Link>
            <Link
              href="/movies?category=action"
              className={cn(
                "rounded-full px-3 py-1.5 font-medium border transition-colors",
                category === "action"
                  ? "border-green-bright bg-green-primary/20 text-green-light"
                  : "border-border-line bg-surface text-text-secondary hover:text-white"
              )}
            >
              Action &amp; Adventure
            </Link>
            <Link
              href="/movies?category=romance"
              className={cn(
                "rounded-full px-3 py-1.5 font-medium border transition-colors",
                category === "romance"
                  ? "border-green-bright bg-green-primary/20 text-green-light"
                  : "border-border-line bg-surface text-text-secondary hover:text-white"
              )}
            >
              Romance &amp; Drama
            </Link>
            <Link
              href="/movies?category=top_rated"
              className={cn(
                "rounded-full px-3 py-1.5 font-medium border transition-colors",
                category === "top_rated"
                  ? "border-green-bright bg-green-primary/20 text-green-light"
                  : "border-border-line bg-surface text-text-secondary hover:text-white"
              )}
            >
              Top Rated (8.8+)
            </Link>
          </div>
        </div>

        {/* Filters */}
        <Suspense fallback={<div className="h-11" />}>
          <MoviesFilterBar />
        </Suspense>

        {/* Movies Grid */}
        {results.length > 0 ? (
          <>
            <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {results.map((m) => (
              <Link
                key={m.id}
                href={`/anime/${m.slug}`}
                className="focus-ring group relative flex flex-col overflow-hidden rounded-xl border border-border-line bg-surface transition-all duration-200 hover:-translate-y-1 hover:border-green-primary/60 hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.6)]"
              >
                {/* Poster / Backdrop Header */}
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-surface-dark">
                  <PosterArt
                    seed={m.backdrop || m.poster}
                    title={m.title}
                    orientation="landscape"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent opacity-80" />

                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-primary text-black shadow-lg">
                      <Play className="h-5 w-5 fill-current ml-0.5" />
                    </span>
                  </span>

                  <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
                    <Badge tone="green" className="text-[10px] font-bold">
                      MOVIE
                    </Badge>
                  </div>

                  <div className="absolute right-2.5 top-2.5">
                    <RatingBadge rating={m.rating} />
                  </div>
                </div>

                {/* Details Body */}
                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <h3 className="font-display font-bold text-text-primary group-hover:text-green-light line-clamp-1">
                      {m.title}
                    </h3>
                    {m.synopsis && m.synopsis !== SYNOPSIS_FALLBACK && (
                      <p className="mt-1.5 text-xs text-text-muted line-clamp-2 leading-relaxed">
                        {m.synopsis}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex flex-col gap-2 border-t border-border-line/60 pt-3">
                    <div className="flex items-center justify-between text-xs text-text-muted">
                      <span>{m.year}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDuration(m.durationMinutes)}
                      </span>
                    </div>
                    <LanguageBadges languages={m.languages} max={3} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
        </>
      ) : (
          <div className="mt-8">
            <NoResultsState />
          </div>
        )}
      </div>
    </div>
  );
}

function MoviesFilterBar() {
  return (
    <form className="grid grid-cols-2 gap-3 sm:grid-cols-4" action="/movies" method="get">
      <Select name="genre" defaultValue="" aria-label="Filter by genre">
        <option value="">All Genres</option>
        {genres.map((g) => (
          <option key={g.slug} value={g.slug}>
            {g.label}
          </option>
        ))}
      </Select>
      <Select name="language" defaultValue="" aria-label="Filter by language">
        <option value="">All Languages</option>
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </Select>
      <Select name="sort" defaultValue="rating" aria-label="Sort movies">
        <option value="rating">Top Rated</option>
        <option value="year">Newest Year</option>
        <option value="title">A–Z</option>
      </Select>
      <button
        type="submit"
        className="focus-ring rounded-lg bg-green-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-bright transition-colors"
      >
        Apply Filters
      </button>
    </form>
  );
}
