"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { staticCatalog } from "@/lib/static-catalog";

const PAGE_SIZE = 12;

export function SeriesCatalogBrowser() {
  const [page, setPage] = useState(1);
  useEffect(() => {
    const readPage = () => setPage(Math.max(1, Number(new URLSearchParams(window.location.search).get("page")) || 1));
    readPage();
    window.addEventListener("popstate", readPage);
    return () => window.removeEventListener("popstate", readPage);
  }, []);

  const items = staticCatalog.filter((item) => item.type === "TV");
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = useMemo(() => items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [items, safePage]);
  const pageHref = (value: number) => value <= 1 ? "/series" : `/series?page=${value}`;

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b border-border-line pb-4">
        <div>
          <h2 className="font-display text-xl font-bold text-text-primary">All Series</h2>
          {visible.length > 0 && <p className="text-xs text-text-muted mt-0.5">Page {safePage} of {totalPages} • Showing {visible.length} anime series</p>}
        </div>
      </div>
      <div className="mt-8"><AnimeGrid items={visible} /></div>
      {totalPages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination">
          <a href={pageHref(Math.max(1, safePage - 1))} aria-disabled={safePage === 1} className="rounded-lg border border-border-line px-3 py-2 text-sm text-text-secondary aria-disabled:pointer-events-none aria-disabled:opacity-30">Prev</a>
          <span className="px-3 text-sm text-text-muted">Page <span className="text-text-primary">{safePage}</span> of {totalPages}</span>
          <a href={pageHref(Math.min(totalPages, safePage + 1))} aria-disabled={safePage === totalPages} className="rounded-lg border border-border-line px-3 py-2 text-sm text-text-secondary aria-disabled:pointer-events-none aria-disabled:opacity-30">Next</a>
        </nav>
      )}
    </>
  );
}
