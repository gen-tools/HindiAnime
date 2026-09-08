import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchBar } from "@/components/search/SearchBar";
import { SearchFilters } from "@/components/search/SearchFilters";
import { EmptySearchState, NoResultsState } from "@/components/search/SearchStates";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { Pagination } from "@/components/ui/Pagination";
import { anime } from "@/lib/mock/anime";
import {
  getCatalogPosterItems,
  getHomepageData,
  getHomepagePosterCatalog,
  isUsableImageUrl,
  searchGlobalAnime,
} from "@/lib/api/client";
import type { Anime } from "@/types/anime";

export const metadata: Metadata = {
  title: "Search",
  description: "Search anime, movies, and characters across HindiAnime's catalog.",
};

const PAGE_SIZE = 12;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const rawQ = (params.q || params.s)?.trim() ?? "";
  const genre = params.genre;
  const language = params.language;
  const type = params.type;
  const sort = params.sort ?? "rating";
  const page = Math.max(1, Number(params.page) || 1);

  let results: Anime[] = [];
  let totalPages = 1;

  async function getLiveCatalog(): Promise<Anime[]> {
    const data = await getHomepageData();
    return getHomepagePosterCatalog(data).filter(
      (item) => isUsableImageUrl(item.poster)
    );
  }

  if (rawQ) {
    const globalSearch = await searchGlobalAnime(rawQ, page);
    results = globalSearch.results
      .map((result) => result.item)
      .filter((item) => isUsableImageUrl(item.poster));
    totalPages = globalSearch.totalPages;
  } else {
    const liveCatalog = await getLiveCatalog();
    // Existing genre/language controls retain their current navigation and
    // taxonomy. The unfiltered catalog itself now comes directly from /api.
    results = genre || language || type
      ? getCatalogPosterItems(anime, liveCatalog)
      : liveCatalog;
    if (genre) results = results.filter((a) => a.genres.includes(genre));
    if (language) results = results.filter((a) => a.languages.includes(language as never));
    if (type) results = results.filter((a) => a.type === type);

    results = [...results].sort((a, b) => {
      if (sort === "year") return b.year - a.year;
      if (sort === "title") return a.title.localeCompare(b.title);
      return b.rating - a.rating;
    });

    totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
    results = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }

  function buildHref(p: number) {
    const next = new URLSearchParams();
    if (rawQ) next.set("q", rawQ);
    if (genre) next.set("genre", genre);
    if (language) next.set("language", language);
    if (type) next.set("type", type);
    if (params.sort) next.set("sort", params.sort);
    next.set("page", String(p));
    return `/search?${next.toString()}`;
  }

  const hasAnyFilter = Boolean(rawQ || genre || language || type);

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
