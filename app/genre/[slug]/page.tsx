import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { Pagination } from "@/components/ui/Pagination";
import { ListingFilters } from "@/components/search/ListingFilters";
import { NoResultsState } from "@/components/search/SearchStates";
import { genres, getGenre } from "@/lib/mock/genres";
import { getAnimeByGenre } from "@/lib/mock/anime";
import {
  getCatalogPosterItems,
  getGenreCatalog,
  getHomepageData,
  getHomepagePosterCatalog,
} from "@/lib/api/client";
import { posterPalette } from "@/lib/poster";
import { Layers, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;

export function generateStaticParams() {
  return genres.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const genre = getGenre(slug);
  if (!genre) return {};
  return {
    title: `${genre.label} Anime | Watch Dubbed & Subbed in Hindi`,
    description: `Watch the best ${genre.label} anime on HindiAnime — ${genre.description.toLowerCase()}. Stream in HD with multi-language audio.`,
  };
}

export default async function GenrePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sParams = await searchParams;
  const genre = getGenre(slug);
  if (!genre) notFound();

  const { language, type, sort = "rating" } = sParams;
  const page = Math.max(1, Number(sParams.page) || 1);

  const genreData = await getGenreCatalog(slug, page);
  let items = genreData.results;
  const totalPages = genreData.totalPages;
  const years = [...new Set(items.map((a) => a.year).filter((y) => y > 0))].sort((a, b) => b - a);

  if (language) items = items.filter((a) => a.languages.includes(language as never));
  if (type) items = items.filter((a) => a.type === type);
  if (sParams.year) items = items.filter((a) => String(a.year) === sParams.year);

  if (sort === "rating") items = [...items].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  if (sort === "recent") items = [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  if (sort === "title") items = [...items].sort((a, b) => a.title.localeCompare(b.title));

  const paged = items;

  function buildHref(p: number) {
    const next = new URLSearchParams(sParams as Record<string, string>);
    next.set("page", String(p));
    return `/genre/${slug}?${next.toString()}`;
  }

  const { palette } = posterPalette(slug);
  const [base, , bright] = palette;

  return (
    <div className="container-page py-10">
      {/* Horizontal Genre Switcher Bar */}
      <div className="no-scrollbar mb-8 flex items-center gap-2 overflow-x-auto pb-2">
        <Link
          href="/genre"
          className="flex items-center gap-1.5 rounded-full border border-border-line bg-surface px-4 py-1.5 text-xs font-semibold text-text-secondary hover:border-green-primary/60 hover:text-white"
        >
          <Layers className="h-3.5 w-3.5" />
          All Genres
        </Link>
        {genres.map((g) => {
          const isActive = g.slug === slug;
          return (
            <Link
              key={g.slug}
              href={`/genre/${g.slug}`}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold whitespace-nowrap transition-all",
                isActive
                  ? "border border-green-bright bg-green-primary/20 text-green-light shadow-[0_0_12px_-2px_rgba(34,197,94,0.5)]"
                  : "border border-border-line bg-surface text-text-secondary hover:border-green-primary/60 hover:text-white"
              )}
            >
              {g.label}
            </Link>
          );
        })}
      </div>

      {/* Genre Header Banner */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border-line p-6 sm:p-8"
        style={{
          background: `linear-gradient(135deg, ${base}44 0%, #080d0a 75%)`,
        }}
      >
        <div
          className="absolute -right-12 -top-12 h-48 w-48 rounded-full opacity-20 blur-3xl"
          style={{ background: bright }}
          aria-hidden="true"
        />

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-green-light">
            <Sparkles className="h-3.5 w-3.5" />
            <span>GENRE SHOWCASE</span>
          </div>
          <h1 className="font-display mt-1 text-3xl font-extrabold text-text-primary md:text-4xl">
            {genre.label} Anime
          </h1>
          <p className="mt-2 max-w-xl text-sm text-text-secondary">
            {genre.description}. Total of <strong className="text-white">{items.length} titles</strong> available.
          </p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="mt-8">
        <Suspense fallback={<div className="h-11" />}>
          <ListingFilters years={years} />
        </Suspense>
      </div>

      {/* Results Grid */}
      <div className="mt-8">
        {paged.length > 0 ? (
          <>
            <AnimeGrid items={paged} />
            <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
          </>
        ) : (
          <NoResultsState />
        )}
      </div>
    </div>
  );
}
