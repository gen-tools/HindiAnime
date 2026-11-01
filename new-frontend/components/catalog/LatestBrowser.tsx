"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Sparkles, Tv } from "lucide-react";
import type { Episode } from "@/types/episode";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { EpisodeCard } from "@/components/episodes/EpisodeCard";
import { NoResultsState } from "@/components/search/SearchStates";
import { staticCatalog } from "@/lib/static-catalog";
import { getEpisodeIdentity } from "@/lib/episodes";
import { languages } from "@/lib/mock/languages";
import { genres } from "@/lib/mock/genres";
import { countries, matchesCountry } from "@/lib/mock/countries";
import type { Anime } from "@/types/anime";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;

export function LatestBrowser({ initialEpisodes }: { initialEpisodes: Episode[] }) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const read = () => setQuery(window.location.search);
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const params = useMemo(() => new URLSearchParams(query), [query]);
  const tab = params.get("tab") === "series" ? "series" : "episodes";
  const language = params.get("language") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const episodeResults = language ? initialEpisodes.filter((episode) => episode.languages.includes(language as never)) : initialEpisodes;
  const series = useMemo(() => {
    let items: Anime[] = staticCatalog.filter((item) => item.type === "TV");
    const genre = params.get("genre");
    const country = params.get("country");
    const type = params.get("type");
    const year = params.get("year");
    if (genre) items = items.filter((item) => item.genres.includes(genre));
    if (country) items = items.filter((item) => matchesCountry(item, country));
    if (language) items = items.filter((item) => item.languages.includes(language as never));
    if (type) items = items.filter((item) => item.type === type);
    if (year) items = items.filter((item) => String(item.year) === year);
    const sort = params.get("sort") || "recent";
    if (sort === "rating") items = [...items].sort((a, b) => b.rating - a.rating);
    else if (sort === "title") items = [...items].sort((a, b) => a.title.localeCompare(b.title));
    return items;
  }, [language, params]);
  const totalPages = Math.max(1, Math.ceil(series.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedSeries = series.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const years = [...new Set(series.map((item) => item.year).filter((year) => year > 0))].sort((a, b) => b - a);
  const setQueryParam = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    window.location.assign(`/latest${next.size ? `?${next.toString()}` : ""}`);
  };
  const pageHref = (nextPage: number) => {
    const next = new URLSearchParams(params.toString());
    if (nextPage <= 1) next.delete("page");
    else next.set("page", String(nextPage));
    return `/latest${next.size ? `?${next.toString()}` : ""}`;
  };
  const tabHref = (value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", value);
    next.delete("page");
    return `/latest?${next.toString()}`;
  };

  return (
    <div className="container-page py-10">
      <div className="relative overflow-hidden rounded-2xl border border-border-line bg-gradient-to-r from-surface via-surface-dark to-background p-6 sm:p-8">
        <div className="relative z-10 max-w-2xl"><div className="inline-flex items-center gap-2 rounded-full border border-green-primary/30 bg-green-primary/10 px-3 py-1 text-xs font-semibold text-green-light"><Sparkles className="h-3.5 w-3.5" /><span>Latest Updates</span></div><h1 className="font-display mt-3 text-3xl font-extrabold text-text-primary md:text-4xl">Latest Releases</h1><p className="mt-2 text-sm text-text-secondary">Freshly simulcasted episodes, newly dubbed releases, and catalog additions.</p></div>
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b border-border-line pb-4">
        <div className="flex items-center gap-2"><a href={tabHref("episodes")} className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all", tab === "episodes" ? "bg-green-primary text-white shadow-[0_0_12px_rgba(34,197,94,0.4)]" : "bg-surface text-text-secondary hover:bg-surface-elevated hover:text-white")}><Clock className="h-4 w-4" />Latest Episodes ({episodeResults.length})</a><a href={tabHref("series")} className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all", tab === "series" ? "bg-green-primary text-white shadow-[0_0_12px_rgba(34,197,94,0.4)]" : "bg-surface text-text-secondary hover:bg-surface-elevated hover:text-white")}><Tv className="h-4 w-4" />Newly Added Series ({series.length})</a></div>
        <div className="flex items-center gap-1.5 text-xs text-text-muted"><span>Filter:</span><a href="/latest?tab=episodes&language=hindi" className="rounded px-2.5 py-1 border border-border-line bg-surface text-text-secondary hover:text-white">Hindi Dubs</a><a href="/latest?tab=episodes&language=english" className="rounded px-2.5 py-1 border border-border-line bg-surface text-text-secondary hover:text-white">English Sub/Dub</a></div>
      </div>
      {tab === "episodes" ? <div className="mt-8"><div className="mb-4 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-text-primary">Recent Broadcast Drops</h2><span className="text-xs text-text-muted">Episode updates listed by the source</span></div>{episodeResults.length ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{episodeResults.map((episode) => <EpisodeCard key={getEpisodeIdentity(episode)} episode={episode} />)}</div> : <NoResultsState />}</div> : <div className="mt-6">
        <div key={query} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{[
          <select key="genre" aria-label="Filter by genre" defaultValue={params.get("genre") || ""} onChange={(event) => setQueryParam("genre", event.target.value)} className="rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-sm text-text-primary"><option value="">All Genres</option>{genres.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}</select>,
          <select key="language" aria-label="Filter by language" defaultValue={language} onChange={(event) => setQueryParam("language", event.target.value)} className="rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-sm text-text-primary"><option value="">All Languages</option>{languages.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>,
          <select key="country" aria-label="Filter by country" defaultValue={params.get("country") || ""} onChange={(event) => setQueryParam("country", event.target.value)} className="rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-sm text-text-primary"><option value="">All Countries</option>{countries.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>,
          <select key="type" aria-label="Filter by type" defaultValue={params.get("type") || ""} onChange={(event) => setQueryParam("type", event.target.value)} className="rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-sm text-text-primary"><option value="">All Types</option><option value="TV">TV</option><option value="Movie">Movie</option></select>,
          <select key="sort" aria-label="Sort results" defaultValue={params.get("sort") || "recent"} onChange={(event) => setQueryParam("sort", event.target.value)} className="rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-sm text-text-primary"><option value="recent">Most Recent</option><option value="rating">Top Rated</option><option value="title">A–Z</option></select>,
          <select key="year" aria-label="Filter by year" defaultValue={params.get("year") || ""} onChange={(event) => setQueryParam("year", event.target.value)} className="rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-sm text-text-primary"><option value="">All Years</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select>,
        ]}</div>
        <div className="mt-8">{pagedSeries.length ? <><AnimeGrid items={pagedSeries} />{totalPages > 1 && <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination"><a href={pageHref(Math.max(1, safePage - 1))} className="rounded-lg border border-border-line px-3 py-2 text-sm text-text-secondary">Prev</a><span className="px-3 text-sm text-text-muted">Page {safePage} of {totalPages}</span><a href={pageHref(Math.min(totalPages, safePage + 1))} className="rounded-lg border border-border-line px-3 py-2 text-sm text-text-secondary">Next</a></nav>}</> : <NoResultsState />}</div>
      </div>}
    </div>
  );
}
