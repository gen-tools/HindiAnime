import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { Pagination } from "@/components/ui/Pagination";
import { ListingFilters } from "@/components/search/ListingFilters";
import { NoResultsState } from "@/components/search/SearchStates";
import { languages } from "@/lib/mock/languages";
import { getAnimeByLanguage } from "@/lib/mock/anime";
import {
  getCatalogPosterItems,
  getHomepageData,
  getHomepagePosterCatalog,
} from "@/lib/api/client";
import { Headphones, Subtitles, Globe, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;

export function generateStaticParams() {
  return languages.map((l) => ({ language: l.code }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ language: string }>;
}): Promise<Metadata> {
  const { language } = await params;
  const lang = languages.find((l) => l.code === language);
  if (!lang) return {};
  return {
    title: `${lang.label} Anime Dubbed & Subbed | Watch Online`,
    description: `Watch anime dubbed in ${lang.label} with full HD audio and subtitles on HindiAnime.`,
  };
}

export default async function LanguagePage({
  params,
  searchParams,
}: {
  params: Promise<{ language: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { language } = await params;
  const sParams = await searchParams;
  const lang = languages.find((l) => l.code === language);
  if (!lang) notFound();

  const { genre, type, sort = "rating" } = sParams;
  const page = Math.max(1, Number(sParams.page) || 1);

  const homepageData = await getHomepageData();
  let items = getCatalogPosterItems(
    getAnimeByLanguage(language),
    getHomepagePosterCatalog(homepageData)
  );
  const years = [...new Set(items.map((a) => a.year))].sort((a, b) => b - a);

  if (genre) items = items.filter((a) => a.genres.includes(genre));
  if (type) items = items.filter((a) => a.type === type);
  if (sParams.year) items = items.filter((a) => String(a.year) === sParams.year);

  if (sort === "rating") items = [...items].sort((a, b) => b.rating - a.rating);
  if (sort === "recent") items = [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  if (sort === "title") items = [...items].sort((a, b) => a.title.localeCompare(b.title));

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const paged = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function buildHref(p: number) {
    const next = new URLSearchParams(sParams as Record<string, string>);
    next.set("page", String(p));
    return `/language/${language}?${next.toString()}`;
  }

  return (
    <div className="container-page py-10">
      {/* Quick Language Switcher Bar */}
      <div className="no-scrollbar mb-8 flex items-center gap-2 overflow-x-auto pb-2">
        <Link
          href="/language"
          className="flex items-center gap-1.5 rounded-full border border-border-line bg-surface px-4 py-1.5 text-xs font-semibold text-text-secondary hover:border-green-primary/60 hover:text-white"
        >
          <Globe className="h-3.5 w-3.5" />
          All Languages
        </Link>
        {languages.map((l) => {
          const isActive = l.code === language;
          return (
            <Link
              key={l.code}
              href={`/language/${l.code}`}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold whitespace-nowrap transition-all",
                isActive
                  ? "border border-green-bright bg-green-primary/20 text-green-light shadow-[0_0_12px_-2px_rgba(34,197,94,0.5)]"
                  : "border border-border-line bg-surface text-text-secondary hover:border-green-primary/60 hover:text-white"
              )}
            >
              {l.label}
            </Link>
          );
        })}
      </div>

      {/* Language Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border-line bg-gradient-to-r from-surface via-surface-dark to-background p-6 sm:p-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-green-light">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Language Catalog</span>
            </div>
            <h1 className="font-display mt-1 text-3xl font-extrabold text-text-primary md:text-4xl">
              {lang.label} Anime
            </h1>
            <p className="mt-2 max-w-xl text-sm text-text-secondary">
              Everything available with {lang.label} audio dubbing and localized subtitles. Total of{" "}
              <strong className="text-white">{items.length} titles</strong> found.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5 sm:self-start md:self-auto">
            <span className="flex items-center gap-1.5 rounded-lg border border-border-line bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary">
              <Headphones className="h-3.5 w-3.5 text-green-light" />
              Dubbed Audio
            </span>
            <span className="flex items-center gap-1.5 rounded-lg border border-border-line bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary">
              <Subtitles className="h-3.5 w-3.5 text-green-light" />
              Subtitles
            </span>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="mt-8">
        <Suspense fallback={<div className="h-11" />}>
          <ListingFilters years={years} />
        </Suspense>
      </div>

      {/* Results */}
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
