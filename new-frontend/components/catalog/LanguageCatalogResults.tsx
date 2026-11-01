"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { NoResultsState } from "@/components/search/SearchStates";
import { countries, matchesCountry } from "@/lib/mock/countries";
import type { Anime } from "@/types/anime";
import { genres } from "@/lib/mock/genres";
import { languages } from "@/lib/mock/languages";
import { staticCatalog } from "@/lib/static-catalog";

const PAGE_SIZE = 24;

export function LanguageCatalogResults({ language }: { language: string }) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const readQuery = () => setQuery(window.location.search);
    readQuery();
    window.addEventListener("popstate", readQuery);
    return () => window.removeEventListener("popstate", readQuery);
  }, []);
  const params = useMemo(() => new URLSearchParams(query), [query]);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const filtered = useMemo(() => {
    let results = staticCatalog.filter((item) => item.languages.includes(language as never));
    const genre = params.get("genre");
    const country = params.get("country");
    const type = params.get("type");
    const year = params.get("year");
    if (genre) results = results.filter((item) => item.genres.includes(genre));
    if (country) results = results.filter((item) => matchesCountry(item, country));
    if (type) results = results.filter((item) => item.type === type);
    if (year) results = results.filter((item) => String(item.year) === year);
    const sort = params.get("sort") || "recent";
    if (sort === "rating") results = [...results].sort((a, b) => b.rating - a.rating);
    else if (sort === "title") results = [...results].sort((a, b) => a.title.localeCompare(b.title));
    else results = [...results].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return results;
  }, [language, params]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible: Anime[] = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const years = [...new Set(filtered.map((item) => item.year).filter((year) => year > 0))].sort((a, b) => b - a);
  const updateUrl = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    window.location.assign(`/language/${language}${next.size ? `?${next.toString()}` : ""}`);
  };
  const pageHref = (nextPage: number) => {
    const next = new URLSearchParams(params.toString());
    if (nextPage <= 1) next.delete("page");
    else next.set("page", String(nextPage));
    return `/language/${language}${next.size ? `?${next.toString()}` : ""}`;
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <select aria-label="Filter by genre" value={params.get("genre") || ""} onChange={(event) => updateUrl("genre", event.target.value)} className="rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-sm text-text-primary">
          <option value="">All Genres</option>{genres.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}
        </select>
        <select aria-label="Filter by language" value={language} onChange={(event) => window.location.assign(`/language/${event.target.value}`)} className="rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-sm text-text-primary">
          {languages.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
        </select>
        <select aria-label="Filter by country" value={params.get("country") || ""} onChange={(event) => updateUrl("country", event.target.value)} className="rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-sm text-text-primary">
          <option value="">All Countries</option>{countries.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
        </select>
        <select aria-label="Filter by type" value={params.get("type") || ""} onChange={(event) => updateUrl("type", event.target.value)} className="rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-sm text-text-primary">
          <option value="">All Types</option><option value="TV">TV</option><option value="Movie">Movie</option>
        </select>
        <select aria-label="Filter by year" value={params.get("year") || ""} onChange={(event) => updateUrl("year", event.target.value)} className="rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-sm text-text-primary">
          <option value="">All Years</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
        <select aria-label="Sort results" value={params.get("sort") || "recent"} onChange={(event) => updateUrl("sort", event.target.value)} className="rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-sm text-text-primary">
          <option value="recent">Most Recent</option><option value="rating">Top Rated</option><option value="title">A–Z</option>
        </select>
      </div>
      <div className="mt-8">
        {visible.length ? (
          <>
            <AnimeGrid items={visible} />
            {totalPages > 1 && <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination"><a href={pageHref(Math.max(1, safePage - 1))} className="rounded-lg border border-border-line px-3 py-2 text-sm text-text-secondary">Prev</a><span className="px-3 text-sm text-text-muted">Page {safePage} of {totalPages}</span><a href={pageHref(Math.min(totalPages, safePage + 1))} className="rounded-lg border border-border-line px-3 py-2 text-sm text-text-secondary">Next</a></nav>}
          </>
        ) : <NoResultsState />}
      </div>
    </>
  );
}
