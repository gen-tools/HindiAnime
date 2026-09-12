import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { Pagination } from "@/components/ui/Pagination";
import { ListingFilters } from "@/components/search/ListingFilters";
import { NoResultsState } from "@/components/search/SearchStates";
import { getLanguageCatalog } from "@/lib/api/client";
import { Headphones, Subtitles, Globe, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

import { languages } from "@/lib/mock/languages";

interface LanguagePageConfig {
  h1: string;
  title: string;
  description: string;
  intro: string;
}

const languageConfigs: Record<string, LanguagePageConfig> = {
  hindi: {
    h1: "Hindi Dubbed Anime",
    title: "Hindi Dubbed Anime - Watch Anime in Hindi",
    description:
      "Watch Hindi dubbed anime and discover anime available in Hindi. Browse popular series, stream episodes online, and find your next favorite show.",
    intro:
      "Explore the best collection of Hindi dubbed anime and discover popular anime in Hindi. Stream trending series and classic favorites with authentic Hindi anime voiceovers, high-definition video, and synchronized subtitles.",
  },
  tamil: {
    h1: "Tamil Dubbed Anime",
    title: "Tamil Dubbed Anime - Watch Anime in Tamil",
    description:
      "Watch Tamil dubbed anime and explore top anime series in Tamil. Stream popular episodes with clear audio and discover your next favorite series.",
    intro:
      "Find top-rated Tamil dubbed anime and stream your favorite anime in Tamil. Browse action-packed series and fan-favorite releases featuring Tamil anime audio tracks and regional subtitle support.",
  },
  telugu: {
    h1: "Telugu Dubbed Anime",
    title: "Telugu Dubbed Anime - Watch Anime in Telugu",
    description:
      "Watch Telugu dubbed anime and stream anime in Telugu online. Explore trending series with Telugu audio and find exciting new shows to enjoy.",
    intro:
      "Watch popular Telugu dubbed anime releases and enjoy anime in Telugu with high-quality audio. Explore a curated selection of Telugu anime series and movies ready for streaming.",
  },
  bengali: {
    h1: "Bengali Dubbed Anime",
    title: "Bengali Dubbed Anime - Watch Anime in Bengali",
    description:
      "Watch Bengali dubbed anime and explore anime in Bengali online. Enjoy popular animated series with regional audio and find great shows to stream.",
    intro:
      "Browse engaging Bengali dubbed anime and enjoy anime in Bengali with localized dubs. Discover compelling stories and popular Bengali anime episodes available to watch online.",
  },
  kannada: {
    h1: "Kannada Dubbed Anime",
    title: "Kannada Dubbed Anime - Watch Anime in Kannada",
    description:
      "Watch Kannada dubbed anime and stream anime in Kannada online. Browse popular series with local audio tracks and find your next anime to watch.",
    intro:
      "Stream entertaining Kannada dubbed anime and watch anime in Kannada with regional voice dubbing. Discover trending Kannada anime series and episodes updated for fans.",
  },
  malayalam: {
    h1: "Malayalam Dubbed Anime",
    title: "Malayalam Dubbed Anime - Watch Anime in Malayalam",
    description:
      "Watch Malayalam dubbed anime and discover anime in Malayalam online. Stream popular series with Malayalam audio and start watching your favorites.",
    intro:
      "Discover quality Malayalam dubbed anime and experience anime in Malayalam with regional audio options. Stream beloved Malayalam anime series and movies in one convenient place.",
  },
};

function getLanguageConfig(code: string, label: string): LanguagePageConfig {
  if (languageConfigs[code]) {
    return languageConfigs[code];
  }
  return {
    h1: `${label} Dubbed Anime`,
    title: `${label} Dubbed Anime - Watch Anime in ${label}`,
    description: `Watch ${label.toLowerCase()} dubbed anime and explore anime in ${label}. Browse popular series and find your next favorite anime to stream.`,
    intro: `Browse ${label} dubbed anime and enjoy watching anime in ${label}. Discover available series and movies with localized audio and subtitles.`,
  };
}

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

  const config = getLanguageConfig(lang.code, lang.label);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://hindianime.com";
  const canonicalUrl = `${siteUrl}/language/${lang.code}`;

  return {
    title: {
      absolute: config.title,
    },
    description: config.description,
    alternates: {
      canonical: canonicalUrl,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
      },
    },
    openGraph: {
      title: config.title,
      description: config.description,
      url: canonicalUrl,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: config.title,
      description: config.description,
    },
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

  const config = getLanguageConfig(lang.code, lang.label);
  const { genre, type, sort = "rating" } = sParams;
  const page = Math.max(1, Number(sParams.page) || 1);

  const langData = await getLanguageCatalog(language, page);
  let items = langData.results;
  const totalPages = langData.totalPages;
  const years = [...new Set(items.map((a) => a.year).filter((y) => y > 0))].sort((a, b) => b - a);

  if (genre) items = items.filter((a) => a.genres.includes(genre));
  if (type) items = items.filter((a) => a.type === type);
  if (sParams.year) items = items.filter((a) => String(a.year) === sParams.year);

  if (sort === "rating") items = [...items].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  if (sort === "recent") items = [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  if (sort === "title") items = [...items].sort((a, b) => a.title.localeCompare(b.title));

  const paged = items;

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
              {config.h1}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-secondary">
              {config.intro}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              <strong className="text-white">{items.length} titles</strong> on page {page} of {totalPages} total pages.
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
