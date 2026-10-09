import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchBar } from "@/components/search/SearchBar";
import { SearchFilters } from "@/components/search/SearchFilters";
import { EmptySearchState, NoResultsState } from "@/components/search/SearchStates";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { Pagination } from "@/components/ui/Pagination";
import {
  getCatalog,
  getCountryCatalog,
  getGenreCatalog,
  getLanguageCatalog,
  isUsableImageUrl,
  mapSearchItemToAnime,
  searchGlobalAnime,
} from "@/lib/api/client";
import { matchesCountry } from "@/lib/mock/countries";
import type { Anime } from "@/types/anime";
import { createCanonicalMetadata } from "@/lib/seo";
import { redirect } from "next/navigation";
import { hasFilterParamChanges, normalizeFilterParams } from "@/lib/search-filters";

export const metadata: Metadata = createCanonicalMetadata("/search", {
  title: "Search",
  description: "Search anime, movies, and characters across Hindi Anime's catalog.",
});

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const filterParams = normalizeFilterParams(params, {
    sortOptions: ["rating", "year", "title"],
  });
  if (hasFilterParamChanges(params, filterParams)) {
    const query = filterParams.toString();
    redirect(`/search${query ? `?${query}` : ""}`);
  }

  const rawQ = (filterParams.get("q") || filterParams.get("s"))?.trim() ?? "";
  const genre = filterParams.get("genre") ?? undefined;
  const language = filterParams.get("language") ?? undefined;
  const country = filterParams.get("country") ?? undefined;
  const type = filterParams.get("type") ?? undefined;
  const sort = filterParams.get("sort") ?? "rating";
  const page = Math.max(1, Number(filterParams.get("page")) || 1);

  let results: Anime[] = [];
  let totalPages = 1;

  if (rawQ) {
    const globalSearch = await searchGlobalAnime(rawQ, page);
    results = globalSearch.results
      .map((result) => result.item)
      .filter((item) => isUsableImageUrl(item.poster));
    totalPages = globalSearch.totalPages;
    if (genre) results = results.filter((a) => a.genres.includes(genre));
    if (language) results = results.filter((a) => a.languages.includes(language as never));
    if (country) results = results.filter((a) => matchesCountry(a, country));
    if (type) results = results.filter((a) => a.type === type);
  } else if (genre) {
    const genreData = await getGenreCatalog(genre, page);
    results = genreData.results;
    totalPages = genreData.totalPages;
    if (language) results = results.filter((a) => a.languages.includes(language as never));
    if (country) results = results.filter((a) => matchesCountry(a, country));
    if (type) results = results.filter((a) => a.type === type);
  } else if (language) {
    const langData = await getLanguageCatalog(language, page);
    results = langData.results;
    totalPages = langData.totalPages;
    if (genre) results = results.filter((a) => a.genres.includes(genre));
    if (country) results = results.filter((a) => matchesCountry(a, country));
    if (type) results = results.filter((a) => a.type === type);
  } else if (country) {
    const countryData = await getCountryCatalog(country, page, type);
    results = countryData.results;
    totalPages = countryData.totalPages;
    if (type) results = results.filter((a) => a.type === type);
  } else if (type === "Movie") {
    const movieRes = await getCatalog("movies", page);
    results = (movieRes?.results?.results ?? []).map((item) => mapSearchItemToAnime(item, "Movie"));
    totalPages = movieRes?.results?.totalPages ?? 1;
  } else {
    const seriesRes = await getCatalog("series", page);
    results = (seriesRes?.results?.results ?? []).map((item) => mapSearchItemToAnime(item, "TV"));
    totalPages = seriesRes?.results?.totalPages ?? 1;
  }

  if (!rawQ && sort) {
    results = [...results].sort((a, b) => {
      if (sort === "year") return (b.year || 0) - (a.year || 0);
      if (sort === "title") return a.title.localeCompare(b.title);
      return (b.rating || 0) - (a.rating || 0);
    });
  }

  function buildHref(p: number) {
    const next = new URLSearchParams();
    if (rawQ) next.set("q", rawQ);
    if (genre) next.set("genre", genre);
    if (language) next.set("language", language);
    if (country) next.set("country", country);
    if (type) next.set("type", type);
    if (filterParams.get("sort")) next.set("sort", filterParams.get("sort")!);
    next.set("page", String(p));
    return `/search?${next.toString()}`;
  }

  const hasAnyFilter = Boolean(rawQ || genre || language || country || type);

  return (
    <div className="container-page py-10">
      <h1 className="font-display text-3xl font-extrabold text-text-primary">Search</h1>
      <p className="mt-1 text-sm text-text-muted">
        {rawQ ? `Results for "${rawQ}"` : "Browse the full catalog or refine with filters."}
      </p>

      <div className="mt-6 max-w-xl">
        <SearchBar defaultValue={rawQ} size="lg" />
      </div>

      <div className="mt-6">
        <Suspense fallback={<div className="h-11" />}>
          <SearchFilters />
        </Suspense>
      </div>

      <div className="mt-8">
        {results.length > 0 ? (
          <>
            <AnimeGrid items={results} />
            <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
          </>
        ) : hasAnyFilter ? (
          <NoResultsState query={rawQ} />
        ) : (
          <EmptySearchState />
        )}
      </div>
    </div>
  );
}
