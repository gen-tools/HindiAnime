"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { ListingFilters } from "@/components/search/ListingFilters";
import { NoResultsState } from "@/components/search/SearchStates";
import { Pagination } from "@/components/ui/Pagination";
import { languages } from "@/lib/mock/languages";
import { matchesCountry } from "@/lib/mock/countries";
import { loadSearchIndex } from "@/lib/search-index";
import { normalizeFilterParams } from "@/lib/search-filters";
import type { Anime } from "@/types/anime";

const PAGE_SIZE = 12;

export function GenreBrowseClient({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const [catalog, setCatalog] = useState<Anime[] | null>(null);
  const [failed, setFailed] = useState(false);
  const params = normalizeFilterParams(searchParams.toString(), {
    omit: ["genre"],
    sortOptions: ["recent", "rating", "title"],
  });

  useEffect(() => {
    let active = true;
    void loadSearchIndex().then((items) => {
      if (active) setCatalog(items);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, []);

  const allGenreItems = useMemo(
    () => catalog?.filter((item) => item.genres.includes(slug)) ?? [],
    [catalog, slug]
  );
  const years = useMemo(
    () => [...new Set(allGenreItems.map((item) => item.year).filter((year) => year > 0))]
      .sort((a, b) => b - a),
    [allGenreItems]
  );
  const filteredItems = useMemo(() => {
    let items = allGenreItems.filter((item) =>
      (!params.get("language") || item.languages.includes(params.get("language") as never)) &&
      (!params.get("country") || matchesCountry(item, params.get("country")!)) &&
      (!params.get("type") || item.type === params.get("type")) &&
      (!params.get("year") || String(item.year) === params.get("year"))
    );
    const sort = params.get("sort") ?? "recent";
    if (sort === "rating") items = [...items].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    if (sort === "recent") items = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (sort === "title") items = [...items].sort((a, b) => a.title.localeCompare(b.title));
    return items;
  }, [allGenreItems, params]);

  const page = Math.max(1, Number(params.get("page")) || 1);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pageItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function buildHref(nextPage: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(nextPage));
    return `/genre/${slug}?${next.toString()}`;
  }

  function buildLanguageHref(language: string) {
    const next = new URLSearchParams(params);
    next.delete("page");
    next.set("genre", slug);
    next.set("language", language);
    return `/language/${language}?${next.toString()}`;
  }

  return (
    <>
      <div className="mt-8">
        <Suspense fallback={<div className="h-11" />}><ListingFilters years={years} /></Suspense>
      </div>

      <div className="mt-8">
        {!catalog && !failed ? (
          <p className="py-12 text-center text-sm text-text-muted" role="status">Loading genre catalog…</p>
        ) : failed ? (
          <p className="py-12 text-center text-sm text-text-muted" role="status">The genre catalog could not be loaded. Please try again.</p>
        ) : pageItems.length > 0 ? (
          <>
            <AnimeGrid items={pageItems} />
            <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
          </>
        ) : (
          <NoResultsState />
        )}
      </div>

      <div className="mt-14 border-t border-border-line/60 pt-8">
        <h2 className="text-sm font-semibold text-text-primary">Watch Anime in Your Language</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {languages.map((language) => (
            <Link key={language.code} href={buildLanguageHref(language.code)} prefetch={false} className="rounded-lg border border-border-line bg-surface px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-green-primary/50 hover:text-white">
              {language.label} Dubbed
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
