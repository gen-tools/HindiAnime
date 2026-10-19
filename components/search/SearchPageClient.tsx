"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchBar } from "@/components/search/SearchBar";
import { SearchFilters } from "@/components/search/SearchFilters";
import { BrowserSearchResults } from "@/components/search/BrowserSearchResults";
import { normalizeFilterParams, hasFilterParamChanges } from "@/lib/search-filters";
import { openWatchDirectAd } from "@/components/ads/WatchDirectLinkAd";

export function SearchPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawParams = searchParams.toString();
  const params = normalizeFilterParams(rawParams, {
    sortOptions: ["rating", "year", "title"],
  });
  useEffect(() => {
    const current = new URLSearchParams(rawParams);
    const original = Object.fromEntries(current.entries());
    const normalized = normalizeFilterParams(rawParams, {
      sortOptions: ["rating", "year", "title"],
    });
    if (hasFilterParamChanges(original, normalized)) {
      const query = normalized.toString();
      router.replace(`/search${query ? `?${query}` : ""}`);
    }
  }, [rawParams, router]);

  useEffect(() => {
    const handleAnimeResultClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || anchor.target === "_blank") return;

      try {
        const destination = new URL(anchor.href, window.location.href);
        if (
          destination.origin === window.location.origin &&
          /^\/anime\/[^/]+\/?$/.test(destination.pathname)
        ) {
          openWatchDirectAd();
        }
      } catch {
        // Ignore malformed or non-navigation links.
      }
    };

    document.addEventListener("click", handleAnimeResultClick, true);
    return () => document.removeEventListener("click", handleAnimeResultClick, true);
  }, []);

  const query = (params.get("q") || params.get("s") || "").trim();
  const genre = params.get("genre") || undefined;
  const language = params.get("language") || undefined;
  const country = params.get("country") || undefined;
  const selectedType = params.get("type") || undefined;
  const year = params.get("year") || undefined;
  const sort = params.get("sort") || "rating";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const hasAnyFilter = Boolean(query || genre || language || country || selectedType || year);
  const filters = {
    genre,
    language,
    country,
    type: selectedType || (!hasAnyFilter ? "TV" : undefined),
    year,
    sort,
  };

  return (
    <div className="container-page py-10">
      <h1 className="font-display text-3xl font-extrabold text-text-primary">Search</h1>
      <p className="mt-1 text-sm text-text-muted">
        {query ? `Results for "${query}"` : "Browse the full catalog or refine with filters."}
      </p>

      <div className="mt-6 max-w-xl">
        <SearchBar defaultValue={query} size="lg" />
      </div>

      <div className="mt-6">
        <SearchFilters />
      </div>

      <div className="mt-8">
        <BrowserSearchResults
          key={`${query}:${page}:${genre ?? ""}:${language ?? ""}:${country ?? ""}:${selectedType ?? ""}:${year ?? ""}:${sort}`}
          query={query}
          page={page}
          filters={filters}
        />
      </div>
    </div>
  );
}
