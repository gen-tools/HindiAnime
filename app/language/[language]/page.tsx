import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LanguageCatalogResults } from "@/components/catalog/LanguageCatalogResults";
import { Headphones, Subtitles, Globe, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

import { languages } from "@/lib/mock/languages";
import { genres } from "@/lib/mock/genres";
import { CANONICAL_SITE_ORIGIN, createCanonicalMetadata } from "@/lib/seo";
import { staticCatalog } from "@/lib/static-catalog";

export const dynamicParams = true;

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
  const normalizedLanguage = language.trim().toLowerCase();
  const lang = languages.find((l) => l.code === normalizedLanguage);
  if (!lang) {
    return {
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const config = getLanguageConfig(lang.code, lang.label);
  const initialItems = staticCatalog.filter((anime) => anime.languages.includes(language as never));
  const siteUrl = CANONICAL_SITE_ORIGIN;
  const canonicalUrl = `${siteUrl}/language/${lang.code}`;

  const fullTitle = `${config.title} | Hindi Anime`;

  return createCanonicalMetadata(`/language/${lang.code}`, {
    title: {
      absolute: fullTitle,
    },
    description: config.description,
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
      },
    },
    openGraph: {
      title: fullTitle,
      description: config.description,
      url: canonicalUrl,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: config.title,
      description: config.description,
    },
  });
}

export default async function LanguagePage({
  params,
}: {
  params: Promise<{ language: string }>;
}) {
  const { language } = await params;
  const normalizedLanguage = language.trim().toLowerCase();
  if (normalizedLanguage !== language) redirect(`/language/${normalizedLanguage}`);
  const lang = languages.find((l) => l.code === language);
  if (!lang) notFound();
  const config = getLanguageConfig(lang.code, lang.label);
  const initialItems = staticCatalog.filter((anime) => anime.languages.includes(language as never));

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
              <strong className="text-white">{initialItems.length} titles</strong> in this language catalog.
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
        <LanguageCatalogResults language={language} />
      </div>

      {/* Internal Navigation: Popular Genres */}
      <div className="mt-14 border-t border-border-line/60 pt-8">
        <h2 className="text-sm font-semibold text-text-primary">
          Explore Popular Genres
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {genres.slice(0, 8).map((g) => (
            <Link
              key={g.slug}
              href={`/genre/${g.slug}?language=${language}`}
              className="rounded-lg border border-border-line bg-surface px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-green-primary/50 hover:text-white"
            >
              {g.label} Anime
            </Link>
          ))}
          <Link
            href="/genre"
            className="rounded-lg border border-border-line bg-surface/60 px-3 py-1.5 text-xs font-medium text-green-light transition-colors hover:border-green-primary hover:text-white"
          >
            All Genres &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
