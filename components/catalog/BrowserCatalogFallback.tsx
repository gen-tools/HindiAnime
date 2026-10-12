"use client";

import { useEffect, useState } from "react";
import type { Anime } from "@/types/anime";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { Pagination } from "@/components/ui/Pagination";
import { getCatalog, mapSearchItemToAnime } from "@/lib/api/client";

type CatalogKind = "series" | "movies";
type LoadState = "loading" | "ready" | "error";

export function BrowserCatalogFallback({
  kind,
  page,
}: {
  kind: CatalogKind;
  page: number;
}) {
  const [items, setItems] = useState<Anime[]>([]);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const load = async () => {
      setState("loading");
      setItems([]);
      const response = await getCatalog(kind, page, {
        allowHomepageFallback: false,
        signal: controller.signal,
      });
      const rawItems = response?.results?.results ?? [];
      if (rawItems.length === 0) throw new Error("Catalog feed had no valid entries");
      if (!active) return;
      setItems(rawItems.map((item) =>
        mapSearchItemToAnime(item, kind === "movies" ? "Movie" : "TV")
      ));
      setTotalPages(response?.results?.totalPages ?? null);
      setState("ready");
    };

    load().catch(() => {
      if (active && !controller.signal.aborted) setState("error");
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [kind, page, retry]);

  if (state === "loading") {
    return <p className="mt-8 py-12 text-center text-sm text-text-muted" role="status">Loading catalog from the source…</p>;
  }

  if (state === "error") {
    return (
      <div className="mt-8 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-line py-20 text-center">
        <p className="font-display text-lg font-bold text-text-primary">Catalog temporarily unavailable</p>
        <p className="max-w-sm text-sm text-text-muted">The source did not return catalog entries. Try again shortly.</p>
        <button
          type="button"
          onClick={() => setRetry((value) => value + 1)}
          className="focus-ring mt-2 rounded-lg border border-border-line px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-green-primary/60 hover:text-green-light"
        >
          Try again
        </button>
      </div>
    );
  }

  const buildHref = (nextPage: number) => `/${kind}?page=${nextPage}`;
  return (
    <div className="mt-8">
      <p className="mb-5 text-xs text-text-muted">
        Page {page}{totalPages ? ` of ${totalPages}` : ""} • Showing {items.length} {kind === "series" ? "anime series" : "anime movies"}
      </p>
      <AnimeGrid items={items} />
      {totalPages !== null && (
        <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
      )}
    </div>
  );
}
