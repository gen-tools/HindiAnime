import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { Pagination } from "@/components/ui/Pagination";
import { NoResultsState } from "@/components/search/SearchStates";
import { getCatalog, mapSearchItemToAnime } from "@/lib/api/client";

export const metadata: Metadata = {
  title: "Anime Series Catalog | Watch All Anime Series | HINDIANIME",
  description:
    "Explore and stream all anime TV series, simulcasts, and multi-season anime in Hindi, Tamil, Telugu, and English dubs.",
};

export default async function SeriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const seriesResponse = await getCatalog("series", page);
  const totalPages = seriesResponse?.results?.totalPages ?? 1;
  const rawResults = seriesResponse?.results?.results ?? [];
  const seriesList = rawResults.map((item) => mapSearchItemToAnime(item, "TV"));

  function buildHref(p: number) {
    const next = new URLSearchParams(params as Record<string, string>);
    next.set("page", String(p));
    return `/series?${next.toString()}`;
  }

  return (
    <div className="container-page py-10">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border-line bg-gradient-to-r from-surface via-surface-dark to-background p-6 sm:p-8">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-green-primary/30 bg-green-primary/10 px-3 py-1 text-xs font-semibold text-green-light">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Complete Collection</span>
          </div>
          <h1 className="font-display mt-3 text-3xl font-extrabold text-text-primary md:text-4xl">
            Anime Series
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Stream all available anime TV series, ongoing broadcasts, and completed seasons dubbed in Hindi, Tamil, Telugu, and English.
          </p>
        </div>
      </div>

      {/* Catalog Title & Page Stats */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b border-border-line pb-4">
        <div>
          <h2 className="font-display text-xl font-bold text-text-primary">
            All Series
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Page {page} of {totalPages} • Showing {seriesList.length} anime series
          </p>
        </div>
      </div>

      {/* Series Grid */}
      {seriesList.length > 0 ? (
        <div className="mt-8">
          <AnimeGrid items={seriesList} />
          <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
        </div>
      ) : (
        <div className="mt-8">
          <NoResultsState query="series" />
        </div>
      )}
    </div>
  );
}
