"use client";

import { useEffect, useRef, useState } from "react";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { NoResultsState } from "@/components/search/SearchStates";
import { Pagination } from "@/components/ui/Pagination";
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
  const requestKey = JSON.stringify([
    query,
    page,
    filters.genre ?? null,
    filters.language ?? null,
    filters.country ?? null,
    filters.type ?? null,
  ]);
  const ssrRequestKeyRef = useRef<string | null>(initialItems.length > 0 ? requestKey : null);

  useEffect(() => {
    // The server already searched and filtered this exact initial request.
    // Keep this key through Strict Mode's effect replay, but clear it as soon
    // as the request identity changes so later searches still run.
    if (ssrRequestKeyRef.current === requestKey) return;
    ssrRequestKeyRef.current = null;

    let active = true;
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(query)}&page=${page}`, { cache: "no-store" })
      .then((res) => res.ok
        ? res.json() as Promise<{ results?: Anime[]; totalPages?: number }>
        : Promise.resolve({ results: [] as Anime[], totalPages: 1 }))
      .then(({ results: liveItems = [], totalPages: liveTotalPages = 1 }) => {
        if (!active) return;
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
        if (active) console.warn("[Search] Live source request failed.", error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [query, page, filters.genre, filters.language, filters.country, filters.type, requestKey]);

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

