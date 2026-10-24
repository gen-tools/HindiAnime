"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Play, Info, Star, ChevronLeft, ChevronRight } from "lucide-react";
import type { Anime } from "@/types/anime";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LanguageBadges } from "./LanguageBadges";
import { PosterArt } from "./PosterArt";
import { FavoriteButton } from "./FavoriteButton";
import { SYNOPSIS_FALLBACK } from "@/lib/api/client";
import { normalizeGenreSlug } from "@/lib/mock/genres";

const SLIDE_DURATION = 7500;

export function AnimeHero({ items }: { items: Anime[] }) {
  const [index, setIndex] = useState(0);
  const item = items[index];

  useEffect(() => {
    if (items.length <= 1) return;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    const syncRotation = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (!motionPreference.matches && document.visibilityState === "visible") {
        timer = setInterval(() => setIndex((current) => (current + 1) % items.length), SLIDE_DURATION);
      }
    };

    syncRotation();
    motionPreference.addEventListener("change", syncRotation);
    document.addEventListener("visibilitychange", syncRotation);
    return () => {
      if (timer) clearInterval(timer);
      motionPreference.removeEventListener("change", syncRotation);
      document.removeEventListener("visibilitychange", syncRotation);
    };
  }, [items.length]);

  if (!item) return null;

  const selectSlide = (nextIndex: number) => {
    setIndex((nextIndex + items.length) % items.length);
  };
  const watchHref = item.type === "Movie" ? `/watch/${item.slug}/movie` : `/watch/${item.slug}/ep-1-1`;

  return (
    <section className="relative overflow-hidden border-b border-border-line bg-background">
      <div key={item.slug} className="absolute inset-0 hero-slide-enter">
        <PosterArt
          seed={item.backdrop || item.poster}
          title={item.title}
          orientation="landscape"
          fit="cover"
          priority
          showOverlay={false}
          showSprocket={false}
          fillContainer
          className="absolute inset-0 h-full w-full opacity-75 sm:opacity-100"
          imageClassName="object-cover object-center"
        />
      </div>

      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent sm:via-background/25" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/65 via-background/30 to-transparent sm:from-background/55 sm:via-background/15" />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-background/40 to-transparent sm:from-background/20" />

      <div className="container-page relative z-10 flex min-h-[480px] flex-col justify-end pb-8 pt-16 sm:min-h-[520px] sm:pb-12 sm:pt-20 md:min-h-[560px] md:flex-row md:items-end md:justify-between lg:min-h-[600px]">
        <div key={`${item.slug}-copy`} className="hero-copy-enter flex max-w-2xl flex-1 flex-col gap-3.5 sm:gap-4 md:pb-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-primary/40 bg-green-primary/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-green-light">
              <span className="h-2 w-2 rounded-full bg-green-bright" />
              Featured Spotlight
            </span>
            {item.type && (
              <span className="rounded-full border border-border-line bg-surface-elevated px-2.5 py-0.5 text-xs font-semibold text-text-secondary">
                {item.type}
              </span>
            )}
          </div>

          <h2 className="font-display text-3xl font-black leading-[1.06] tracking-tight text-white sm:text-5xl md:text-6xl">
            {item.title}
          </h2>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:text-sm">
            {item.rating > 0 && (
              <span className="flex items-center gap-1 rounded-md border border-green-primary/20 bg-surface/60 px-2 py-0.5 font-bold text-green-bright">
                <Star className="h-3.5 w-3.5 fill-green-bright" /> {item.rating.toFixed(1)}
              </span>
            )}
            {item.year && item.year > 0 && <span className="font-semibold text-text-secondary">{item.year}</span>}
            {item.status && <Badge tone={item.status === "Ongoing" ? "green" : "outline"} className="text-xs">{item.status}</Badge>}
            {item.episodeCount && item.episodeCount > 0 && (
              <span className="font-medium text-text-muted">
                {item.episodeCount} {item.episodeCount === 1 ? "Episode" : "Episodes"}
              </span>
            )}
          </div>

          {item.genres?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {item.genres.slice(0, 4).map((genre) => (
                <Link key={genre} href={`/genre/${normalizeGenreSlug(genre)}`}>
                  <span className="rounded-md border border-border-line bg-surface/80 px-2.5 py-0.5 text-[11px] font-medium capitalize text-text-secondary transition-colors hover:border-green-primary/50 hover:text-green-light">
                    {genre.replaceAll("-", " ")}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {item.synopsis && item.synopsis !== SYNOPSIS_FALLBACK && (
            <p className="line-clamp-2 max-w-xl text-xs leading-relaxed text-text-secondary sm:line-clamp-3 sm:text-sm md:text-[15px]">
              {item.synopsis}
            </p>
          )}
          {item.languages?.length > 0 && <LanguageBadges languages={item.languages} max={4} className="text-xs" />}

          <div className="mt-2 flex flex-wrap items-center gap-2.5 sm:gap-3">
            {!item.isMock && (
              <ButtonLink href={watchHref} prefetch size="lg" icon={<Play className="h-4 w-4 fill-white" />} className="font-bold touch-manipulation active:scale-95">
                WATCH NOW
              </ButtonLink>
            )}
            <ButtonLink href={`/anime/${item.slug}`} variant="secondary" size="lg" icon={<Info className="h-4 w-4" />}>
              Details
            </ButtonLink>
            <FavoriteButton anime={{
              animeSlug: item.slug,
              title: item.title,
              poster: item.poster,
              rating: item.rating,
              type: item.type,
              genres: item.genres,
              languages: item.languages,
            }} />
          </div>

          {items.length > 1 && (
            <div className="mt-3 flex max-w-md items-center justify-between gap-4 pt-1">
              <div className="flex items-center gap-1.5 sm:gap-2" role="tablist" aria-label="Featured anime">
                {items.map((slide, slideIndex) => (
                  <button
                    key={slide.slug}
                    type="button"
                    onClick={() => selectSlide(slideIndex)}
                    role="tab"
                    aria-selected={slideIndex === index}
                    aria-label={`Slide ${slideIndex + 1}: ${slide.title}`}
                    className="focus-ring relative h-1.5 w-6 overflow-hidden rounded-full bg-white/20 sm:w-9"
                  >
                    {slideIndex === index && <span key={item.slug} className="hero-progress-fill absolute inset-y-0 left-0 w-full origin-left rounded-full bg-green-bright" />}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => selectSlide(index - 1)} aria-label="Previous slide" className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg border border-border-line bg-surface/60 text-text-muted transition-colors hover:text-white">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => selectSlide(index + 1)} aria-label="Next slide" className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg border border-border-line bg-surface/60 text-text-muted transition-colors hover:text-white">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="hidden w-52 shrink-0 self-center md:block lg:w-64 xl:w-72">
          <div className="group relative overflow-hidden rounded-2xl border-2 border-border-line ring-1 ring-green-primary/30 transition-transform duration-200 hover:scale-[1.02]">
            <PosterArt seed={item.poster} title={item.title} orientation="portrait" loading="lazy" />
            {!item.isMock && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <Link href={watchHref} prefetch={false} aria-label={`Watch ${item.title}`} className="flex h-14 w-14 items-center justify-center rounded-full bg-green-bright text-black transition-transform hover:scale-110 active:scale-95">
                  <Play className="h-6 w-6 translate-x-0.5 fill-black" />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
