"use client";

import { useEffect, useRef, useState } from "react";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { NoResultsState } from "@/components/search/SearchStates";
import { Pagination } from "@/components/ui/Pagination";
import { matchesCountry } from "@/lib/mock/countries";
import { loadSearchIndex, searchLocalIndex } from "@/lib/search-index";
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
  filters,
}: {
  query: string;
  page: number;
  filters: SearchFilters;
}) {
  const [items, setItems] = useState<Anime[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestKey = JSON.stringify([query, page, filters]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setFailed(false);
    void loadSearchIndex()
      .then((index) => {
        if (requestIdRef.current !== requestId) return;
        const matched = searchLocalIndex(query, index, index.length);
        const filtered = matched.filter((item) =>
          (!filters.genre || item.genres.includes(filters.genre)) &&
          (!filters.language || item.languages.includes(filters.language as never)) &&
          (!filters.country || matchesCountry(item, filters.country)) &&
          (!filters.type || item.type === filters.type)
        );
        const pageSize = 12;
        setTotalPages(Math.max(1, Math.ceil(filtered.length / pageSize)));
        setItems(filtered.slice((page - 1) * pageSize, page * pageSize));
      })
      .catch((error: unknown) => {
        if (requestIdRef.current === requestId) {
          setFailed(true);
          console.warn("[Search] Static index could not be loaded.", error);
        }
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
    return () => { requestIdRef.current += 1; };
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
  if (failed) return <p className="py-12 text-center text-sm text-text-muted" role="status">Search is temporarily unavailable. Please try again.</p>;
  return <NoResultsState query={query} />;
}

