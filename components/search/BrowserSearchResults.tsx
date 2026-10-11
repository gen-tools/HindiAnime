"use client";

import { useEffect, useState } from "react";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { NoResultsState } from "@/components/search/SearchStates";
import { Pagination } from "@/components/ui/Pagination";
import { searchAnimeInBrowser } from "@/lib/api/browser-source";
import { matchesCountry } from "@/lib/mock/countries";
import type { Anime } from "@/types/anime";

interface SearchFilters {
  genre?: string;
  language?: string;
  country?: string;
  type?: string;
}

export function BrowserSearchResults({
  query,
  page,
  initialItems,
  initialTotalPages,
  filters,
}: {
  query: string;
  page: number;
  initialItems: Anime[];
  initialTotalPages: number;
  filters: SearchFilters;
}) {
  const [items, setItems] = useState(initialItems);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [loading, setLoading] = useState(initialItems.length === 0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    searchAnimeInBrowser(query, page, controller.signal)
      .then(({ items: liveItems, totalPages: liveTotalPages }) => {
        const filtered = liveItems.filter((item) =>
          (!filters.genre || item.genres.includes(filters.genre)) &&
          (!filters.language || item.languages.includes(filters.language as never)) &&
          (!filters.country || matchesCountry(item, filters.country)) &&
          (!filters.type || item.type === filters.type)
        );
        setItems(filtered);
        setTotalPages(liveTotalPages);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") {
          console.warn("[Search] Live source request failed.", error.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, page, filters.genre, filters.language, filters.country, filters.type]);

  function buildHref(nextPage: number) {
    const params = new URLSearchParams({ q: query });
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    params.set("page", String(nextPage));
    return `/search?${params.toString()}`;
  }

  if (items.length > 0) {
    return <><AnimeGrid items={items} /><Pagination page={page} totalPages={totalPages} buildHref={buildHref} /></>;
  }
  if (loading) return <p className="py-12 text-center text-sm text-text-muted" role="status">Searching the catalog…</p>;
  return <NoResultsState query={query} />;
}

