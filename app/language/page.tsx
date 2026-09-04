import type { Metadata } from "next";
import Link from "next/link";
import { languages } from "@/lib/mock/languages";
import { anime } from "@/lib/mock/anime";
import {
  getCatalogPosterItems,
  getHomepageData,
  getHomepagePosterCatalog,
} from "@/lib/api/client";
import { PosterArt } from "@/components/anime/PosterArt";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { Badge } from "@/components/ui/Badge";
import { Globe, Headphones, Subtitles, ArrowRight, Sparkles, Flame } from "lucide-react";
import type { LanguageCode } from "@/types/language";

export const metadata: Metadata = {
  title: "Browse Anime by Language | Hindi, Tamil, Telugu & More",
  description:
    "Explore anime dubbed and subtitled in Hindi, Tamil, Telugu, English, Japanese, Malayalam, Kannada, Bengali, Marathi, and Korean.",
};

const languageDetails: Record<
  string,
  { native: string; description: string; dubCount: string; subCount: string; flag: string }
> = {
  hindi: {
    native: "हिन्दी",
    description: "Full Hindi audio dubs & multi-language subtitles for top anime series and blockbuster movies.",
    dubCount: "100%",
    subCount: "100%",
    flag: "🇮🇳",
  },
  tamil: {
    native: "தமிழ்",
    description: "High-quality Tamil dubbed anime with immersive voice acting and regional subtitles.",
    dubCount: "90%",
    subCount: "100%",
    flag: "🇮🇳",
  },
  telugu: {
    native: "తెలుగు",
    description: "Telugu dubbed episodes and theatrical releases for regional anime enthusiasts.",
    dubCount: "85%",
    subCount: "100%",
    flag: "🇮🇳",
  },
  english: {
    native: "English",
    description: "Official English dubs and dual-audio tracks with complete closed captions.",
    dubCount: "95%",
    subCount: "100%",
    flag: "🌐",
  },
  japanese: {
    native: "日本語",
    description: "Original Japanese broadcasts with accurate subtitles across 10 Indian & global languages.",
    dubCount: "Original",
    subCount: "100%",
    flag: "🇯🇵",
  },
  korean: {
    native: "한국어",
    description: "Korean audio and subtitles for manhwa adaptations and webtoon-inspired anime.",
    dubCount: "75%",
    subCount: "90%",
    flag: "🇰🇷",
  },
  malayalam: {
    native: "മലയാളം",
    description: "Malayalam dubbed anime and subtitle options for South Indian anime fans.",
    dubCount: "70%",
    subCount: "85%",
    flag: "🇮🇳",
  },
  kannada: {
    native: "ಕನ್ನಡ",
    description: "Kannada audio dubs and localized subtitles for popular anime titles.",
    dubCount: "70%",
    subCount: "85%",
    flag: "🇮🇳",
  },
  bengali: {
    native: "বাংলা",
    description: "Bengali translated subtitles and dubbed episodes for Eastern India fans.",
    dubCount: "65%",
    subCount: "85%",
    flag: "🇮🇳",
  },
  marathi: {
    native: "मराठी",
    description: "Marathi dubbed anime movies and television broadcasts.",
    dubCount: "65%",
    subCount: "80%",
    flag: "🇮🇳",
  },
};

export default async function LanguagesDirectoryPage() {
  const homepageData = await getHomepageData();
  const browseItems = getCatalogPosterItems(
    anime,
    getHomepagePosterCatalog(homepageData)
  );
  const getAnimeByLanguage = (code: LanguageCode) =>
    browseItems.filter((item) => item.languages.includes(code));
  const hindiAnime = getAnimeByLanguage("hindi").slice(0, 6);
  const regionalAnime = browseItems
    .filter((a) =>
      a.languages.some((l) => ["tamil", "telugu", "malayalam", "kannada", "bengali", "marathi"].includes(l))
    )
    .slice(0, 6);

  return (
    <div className="container-page py-10 md:py-14">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl border border-border-line bg-gradient-to-br from-surface via-surface-dark to-background p-6 sm:p-10">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-green-primary/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-green-primary/30 bg-green-primary/10 px-3 py-1 text-xs font-semibold text-green-light">
            <Globe className="h-3.5 w-3.5" />
            <span>Multi-Language Audio &amp; Subtitles</span>
          </div>
          <h1 className="font-display mt-4 text-3xl font-extrabold text-text-primary sm:text-5xl">
            Browse Anime by Language
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
            HindiAnime brings you anime in your mother tongue. Switch between Hindi, Tamil, Telugu,
            English, Japanese, and more with crystal-clear audio dubbing and precise subtitles.
          </p>

          <div className="mt-6 flex flex-wrap gap-4 text-xs font-medium text-text-muted">
            <span className="flex items-center gap-1.5 rounded-lg border border-border-line bg-surface/80 px-3 py-1.5 text-text-secondary">
              <Headphones className="h-4 w-4 text-green-light" />
              10+ Dubbed Audio Languages
            </span>
            <span className="flex items-center gap-1.5 rounded-lg border border-border-line bg-surface/80 px-3 py-1.5 text-text-secondary">
              <Subtitles className="h-4 w-4 text-green-light" />
              Multi-Language Subtitles
            </span>
            <span className="flex items-center gap-1.5 rounded-lg border border-border-line bg-surface/80 px-3 py-1.5 text-text-secondary">
              <Sparkles className="h-4 w-4 text-green-light" />
              Dual-Audio Streaming
            </span>
          </div>
        </div>
      </div>

      {/* Language Cards Grid */}
      <section className="mt-12">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-2xl font-bold text-text-primary">
            All Available Languages
          </h2>
          <span className="text-xs text-text-muted">10 Supported Dialects</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {languages.map((lang) => {
            const count = getAnimeByLanguage(lang.code).length;
            const meta = languageDetails[lang.code] || {
              native: lang.label,
              description: `Watch anime in ${lang.label}.`,
              dubCount: "80%",
              subCount: "100%",
              flag: "🌐",
            };
            const sampleAnime = getAnimeByLanguage(lang.code).slice(0, 3);

            return (
              <Link
                key={lang.code}
                href={`/language/${lang.code}`}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border-line bg-surface p-5 transition-all duration-200 hover:-translate-y-1 hover:border-green-primary/60 hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">{meta.flag}</span>
                      <div>
                        <h3 className="font-display text-lg font-bold text-text-primary group-hover:text-green-light">
                          {lang.label}
                        </h3>
                        <span className="text-xs font-medium text-text-muted">{meta.native}</span>
                      </div>
                    </div>
                    <Badge tone="green" className="text-xs font-semibold">
                      {count} {count === 1 ? "Anime" : "Anime"}
                    </Badge>
                  </div>

                  <p className="mt-3 text-xs leading-relaxed text-text-muted">
                    {meta.description}
                  </p>
                </div>

                <div className="mt-5">
                  <div className="mb-3 flex items-center justify-between border-t border-border-line/60 pt-3 text-[11px] text-text-muted">
                    <span className="flex items-center gap-1">
                      <Headphones className="h-3 w-3 text-green-light" />
                      Dub: <strong className="text-text-secondary">{meta.dubCount}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <Subtitles className="h-3 w-3 text-green-light" />
                      Sub: <strong className="text-text-secondary">{meta.subCount}</strong>
                    </span>
                  </div>

                  {/* Thumbnail strip */}
                  <div className="flex items-center gap-2">
                    {sampleAnime.map((item) => (
                      <div
                        key={item.id}
                        className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md border border-border-line"
                      >
                        <PosterArt seed={item.poster} title={item.title} fillContainer showOverlay={false} showSprocket={false} />
                      </div>
                    ))}
                    <div className="ml-auto flex items-center gap-1 text-xs font-semibold text-green-light group-hover:translate-x-1 transition-transform">
                      Explore
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Featured Hindi Dubs Spotlight */}
      <section className="mt-16">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-green-bright" />
            <h2 className="font-display text-2xl font-bold text-text-primary">
              Trending Hindi Dubbed Anime
            </h2>
          </div>
          <Link
            href="/language/hindi"
            className="flex items-center gap-1 text-xs font-semibold text-green-light hover:underline"
          >
            View all Hindi ({getAnimeByLanguage("hindi").length})
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <AnimeGrid items={hindiAnime} />
      </section>

      {/* Featured Regional Dubs (Tamil, Telugu, Bengali) */}
      <section className="mt-16">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-green-bright" />
            <h2 className="font-display text-2xl font-bold text-text-primary">
              Top Regional Language Dubs (Tamil, Telugu &amp; more)
            </h2>
          </div>
          <div className="flex gap-2">
            <Link
              href="/language/tamil"
              className="rounded-md border border-border-line bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary hover:border-green-primary/60 hover:text-white"
            >
              Tamil
            </Link>
            <Link
              href="/language/telugu"
              className="rounded-md border border-border-line bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary hover:border-green-primary/60 hover:text-white"
            >
              Telugu
            </Link>
          </div>
        </div>

        <AnimeGrid items={regionalAnime} />
      </section>
    </div>
  );
}
