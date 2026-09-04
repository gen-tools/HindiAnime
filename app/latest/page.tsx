import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ListingFilters } from "@/components/search/ListingFilters";
import { NoResultsState } from "@/components/search/SearchStates";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { EpisodeCard } from "@/components/episodes/EpisodeCard";
import { Pagination } from "@/components/ui/Pagination";
import {
  getCatalog,
  getLatestEpisodes,
  mapLatestEpisodeToEpisode,
  mapSearchItemToAnime,
} from "@/lib/api/client";
import { Sparkles, Tv, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { deduplicateEpisodes, getEpisodeIdentity } from "@/lib/episodes";

export const metadata: Metadata = {
  title: "Latest Releases & New Episodes | HINDIANIME",
  description:
    "Watch newly dropped anime episodes and freshly added anime series and movies dubbed in Hindi, Tamil, Telugu, and English.",
};

const PAGE_SIZE = 12;

export default async function LatestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const tab = params.tab || "episodes";
  const { genre, language, type, sort = "recent" } = params;
  const page = Math.max(1, Number(params.page) || 1);

  // Latest episodes
  const [latestResponse, seriesResponse] = await Promise.all([
    getLatestEpisodes(),
    getCatalog("series", page),
  ]);
  const latestEpisodes = deduplicateEpisodes(
    (latestResponse?.results ?? []).map(mapLatestEpisodeToEpisode)
  );
  let filteredEpisodes = latestEpisodes;
  if (language) {
    filteredEpisodes = filteredEpisodes.filter((e) =>
      e.languages.includes(language as never)
    );
  }

  // Latest series
  let seriesResults = (seriesResponse?.results?.results ?? []).map((item) =>
    mapSearchItemToAnime(item)
  );
  const years = [...new Set(seriesResults.map((a) => a.year))].sort((a, b) => b - a);

  if (genre) seriesResults = seriesResults.filter((a) => a.genres.includes(genre));
  if (language) seriesResults = seriesResults.filter((a) => a.languages.includes(language as never));
  if (type) seriesResults = seriesResults.filter((a) => a.type === type);
  if (params.year) seriesResults = seriesResults.filter((a) => String(a.year) === params.year);

  if (sort === "rating") seriesResults = [...seriesResults].sort((a, b) => b.rating - a.rating);
  if (sort === "title") seriesResults = [...seriesResults].sort((a, b) => a.title.localeCompare(b.title));

  const totalPages = Math.max(1, Math.ceil(seriesResults.length / PAGE_SIZE));
  const pagedSeries = seriesResults.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function buildHref(p: number) {
    const next = new URLSearchParams(params as Record<string, string>);
    next.set("page", String(p));
    return `/latest?${next.toString()}`;
  }

  function getTabHref(newTab: string) {
    const next = new URLSearchParams(params as Record<string, string>);
    next.set("tab", newTab);
    next.delete("page");
    return `/latest?${next.toString()}`;
  }

  return (
    <div className="container-page py-10">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border-line bg-gradient-to-r from-surface via-surface-dark to-background p-6 sm:p-8">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-green-primary/30 bg-green-primary/10 px-3 py-1 text-xs font-semibold text-green-light">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Updated Daily</span>
          </div>
          <h1 className="font-display mt-3 text-3xl font-extrabold text-text-primary md:text-4xl">
            Latest Releases
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Freshly simulcasted episodes, newly dubbed releases, and catalog additions.
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b border-border-line pb-4">
        <div className="flex items-center gap-2">
          <Link
            href={getTabHref("episodes")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
              tab === "episodes"
                ? "bg-green-primary text-white shadow-[0_0_12px_rgba(34,197,94,0.4)]"
                : "bg-surface text-text-secondary hover:bg-surface-elevated hover:text-white"
            )}
          >
            <Clock className="h-4 w-4" />
            Latest Episodes ({filteredEpisodes.length})
          </Link>
          <Link
            href={getTabHref("series")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
              tab === "series"
                ? "bg-green-primary text-white shadow-[0_0_12px_rgba(34,197,94,0.4)]"
                : "bg-surface text-text-secondary hover:bg-surface-elevated hover:text-white"
            )}
          >
            <Tv className="h-4 w-4" />
            Newly Added Series ({seriesResults.length})
          </Link>
        </div>

        {/* Quick Language shortcuts */}
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span>Filter:</span>
          <Link
            href="/latest?tab=episodes&language=hindi"
            className={cn(
              "rounded px-2.5 py-1 border transition-colors",
              language === "hindi"
                ? "border-green-bright bg-green-primary/20 text-green-light"
                : "border-border-line bg-surface text-text-secondary hover:text-white"
            )}
          >
            Hindi Dubs
          </Link>
          <Link
            href="/latest?tab=episodes&language=english"
            className={cn(
              "rounded px-2.5 py-1 border transition-colors",
              language === "english"
                ? "border-green-bright bg-green-primary/20 text-green-light"
                : "border-border-line bg-surface text-text-secondary hover:text-white"
            )}
          >
            English Sub/Dub
          </Link>
        </div>
      </div>

      {/* Tab 1: Latest Episodes Feed */}
      {tab === "episodes" && (
        <div className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-text-primary">
              Recent Broadcast Drops
            </h2>
            <span className="text-xs text-text-muted">Broadcasted within the last 48 hours</span>
          </div>

          {filteredEpisodes.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredEpisodes.map((ep) => (
                <EpisodeCard key={getEpisodeIdentity(ep)} episode={ep} />
              ))}
            </div>
          ) : (
            <NoResultsState />
          )}
        </div>
      )}

      {/* Tab 2: Newly Added Series with full filter bar */}
      {tab === "series" && (
        <div className="mt-6">
          <Suspense fallback={<div className="h-11" />}>
            <ListingFilters years={years} />
          </Suspense>

          <div className="mt-8">
            {pagedSeries.length > 0 ? (
              <>
                <AnimeGrid items={pagedSeries} />
                <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
              </>
            ) : (
              <NoResultsState />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
