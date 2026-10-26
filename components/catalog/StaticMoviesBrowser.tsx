"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Play } from "lucide-react";
import { staticCatalog } from "@/lib/static-catalog";
import { MovieSpotlight } from "@/components/anime/MovieSpotlight";
import { PosterArt } from "@/components/anime/PosterArt";
import { RatingBadge } from "@/components/ui/RatingBadge";
import { LanguageBadges } from "@/components/anime/LanguageBadges";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { NoResultsState } from "@/components/search/SearchStates";
import { genres } from "@/lib/mock/genres";
import { languages } from "@/lib/mock/languages";
import { formatDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;

export function StaticMoviesBrowser() {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const readQuery = () => setQuery(window.location.search);
    readQuery();
    window.addEventListener("popstate", readQuery);
    return () => window.removeEventListener("popstate", readQuery);
  }, []);

  const params = useMemo(() => new URLSearchParams(query), [query]);
  const movies = staticCatalog.filter((item) => item.type === "Movie");
  const page = Math.max(1, Number(params.get("page")) || 1);
  const category = params.get("category") || "all";
  const genre = params.get("genre") || "";
  const language = params.get("language") || "";
  const year = params.get("year") || "";
  const sort = params.get("sort") || "rating";
  const results = useMemo(() => {
    let filtered = [...movies];
    if (category === "hindi") filtered = filtered.filter((item) => item.languages.includes("hindi"));
    else if (category === "action") filtered = filtered.filter((item) => item.genres.some((tag) => ["action", "thriller"].includes(tag)));
    else if (category === "romance") filtered = filtered.filter((item) => item.genres.some((tag) => ["romance", "drama"].includes(tag)));
    else if (category === "top_rated") filtered = filtered.filter((item) => item.rating >= 8.8);
    if (genre) filtered = filtered.filter((item) => item.genres.includes(genre));
    if (language) filtered = filtered.filter((item) => item.languages.includes(language as never));
    if (year) filtered = filtered.filter((item) => String(item.year) === year);
    if (sort === "rating") filtered.sort((a, b) => b.rating - a.rating);
    if (sort === "year") filtered.sort((a, b) => b.year - a.year);
    if (sort === "title") filtered.sort((a, b) => a.title.localeCompare(b.title));
    return filtered;
  }, [category, genre, language, movies, sort, year]);
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = results.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const showSpotlight = safePage === 1 && category === "all" && !genre && !language && !year;
  const makeHref = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key);
    const queryString = next.toString();
    return `/movies${queryString ? `?${queryString}` : ""}`;
  };

  return (
    <div>
      {showSpotlight && <MovieSpotlight items={movies.slice(0, 6)} />}
      <div className="container-page py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-text-primary">All Anime Movies</h2>
            {movies.length > 0 && <p className="text-xs text-text-muted mt-0.5">Page {safePage} of {totalPages} • Showing {visible.length} full-length theatrical features &amp; specials</p>}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {[["all", "All"], ["hindi", "Hindi Dubbed"], ["action", "Action & Adventure"], ["romance", "Romance & Drama"], ["top_rated", "Top Rated (8.8+)"]].map(([value, label]) => (
              <a key={value} href={makeHref({ category: value === "all" ? "" : value, page: "" })} className={cn("rounded-full px-3 py-1.5 font-medium border transition-colors", category === value ? "border-green-bright bg-green-primary/20 text-green-light" : "border-border-line bg-surface text-text-secondary hover:text-white")}>{label}</a>
            ))}
          </div>
        </div>

        <form key={query} className="grid grid-cols-2 gap-3 sm:grid-cols-4" action="/movies" method="get">
          {category !== "all" && <input type="hidden" name="category" value={category} />}
          <Select name="genre" defaultValue={genre} aria-label="Filter by genre"><option value="">All Genres</option>{genres.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}</Select>
          <Select name="language" defaultValue={language} aria-label="Filter by language"><option value="">All Languages</option>{languages.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</Select>
          <Select name="sort" defaultValue={sort} aria-label="Sort movies"><option value="rating">Top Rated</option><option value="year">Newest Year</option><option value="title">A–Z</option></Select>
          <button type="submit" className="focus-ring rounded-lg bg-green-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-bright transition-colors">Apply Filters</button>
        </form>

        {visible.length ? <>
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((movie) => <Link key={movie.id} href={`/anime/${movie.slug}`} className="focus-ring group relative flex flex-col overflow-hidden rounded-xl border border-border-line bg-surface transition-all duration-200 hover:-translate-y-1 hover:border-green-primary/60 hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.6)]">
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-surface-dark">
                <PosterArt seed={movie.backdrop || movie.poster} title={movie.title} orientation="landscape" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent opacity-80" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-primary text-black shadow-lg"><Play className="h-5 w-5 fill-current ml-0.5" /></span></span>
                <div className="absolute left-2.5 top-2.5"><Badge tone="green" className="text-[10px] font-bold">MOVIE</Badge></div>
                <div className="absolute right-2.5 top-2.5"><RatingBadge rating={movie.rating} /></div>
              </div>
              <div className="flex flex-1 flex-col justify-between p-4"><div><h3 className="font-display font-bold text-text-primary group-hover:text-green-light line-clamp-1">{movie.title}</h3>{movie.synopsis && <p className="mt-1.5 text-xs text-text-muted line-clamp-2 leading-relaxed">{movie.synopsis}</p>}</div>
                <div className="mt-4 flex flex-col gap-2 border-t border-border-line/60 pt-3"><div className="flex items-center justify-between text-xs text-text-muted"><span>{movie.year || "—"}</span><span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDuration(movie.durationMinutes)}</span></div><LanguageBadges languages={movie.languages} max={3} /></div>
              </div>
            </Link>)}
          </div>
          {totalPages > 1 && <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination"><a href={makeHref({ page: String(Math.max(1, safePage - 1)) })} className="rounded-lg border border-border-line px-3 py-2 text-sm text-text-secondary">Prev</a><span className="px-3 text-sm text-text-muted">Page {safePage} of {totalPages}</span><a href={makeHref({ page: String(Math.min(totalPages, safePage + 1)) })} className="rounded-lg border border-border-line px-3 py-2 text-sm text-text-secondary">Next</a></nav>}
        </> : <div className="mt-8"><NoResultsState /></div>}
      </div>
    </div>
  );
}
