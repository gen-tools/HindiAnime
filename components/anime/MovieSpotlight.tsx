"use client";

import { useEffect, useState } from "react";
import { Clock, Info, Play, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import type { Anime } from "@/types/anime";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { LanguageBadges } from "@/components/anime/LanguageBadges";
import { PosterArt } from "@/components/anime/PosterArt";
import { RatingBadge } from "@/components/ui/RatingBadge";
import { SYNOPSIS_FALLBACK } from "@/lib/api/client";
import { formatDuration } from "@/lib/utils";

const SLIDE_DURATION = 7500;

export function MovieSpotlight({ items }: { items: Anime[] }) {
  const [index, setIndex] = useState(0);
  const item = items[index];

  useEffect(() => {
    if (items.length <= 1) return;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    const syncRotation = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (!motionPreference.matches) {
        timer = setInterval(() => setIndex((current) => (current + 1) % items.length), SLIDE_DURATION);
      }
    };

    syncRotation();
    motionPreference.addEventListener("change", syncRotation);
    return () => {
      if (timer) clearInterval(timer);
      motionPreference.removeEventListener("change", syncRotation);
    };
  }, [items.length]);

  if (!item) return null;

  const selectSlide = (nextIndex: number) => {
    setIndex((nextIndex + items.length) % items.length);
  };

  return (
    <section className="relative overflow-hidden border-b border-border-line bg-background">
      <div key={item.slug} className="movie-spotlight-image absolute inset-0">
        <PosterArt
          seed={item.backdrop || item.poster}
          title={item.title}
          orientation="landscape"
          className="h-full w-full object-cover"
          priority={index === 0}
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />

      <div className="container-page relative flex min-h-[460px] flex-col justify-end gap-4 py-16 sm:min-h-[500px]">
        <div key={`${item.slug}-copy`} className="movie-spotlight-copy max-w-3xl">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-green-primary/40 bg-green-primary/20 px-3 py-1 text-xs font-semibold text-green-light backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5" />
            <span>PREMIERE SPOTLIGHT</span>
          </div>

          <h1 className="font-display mt-4 max-w-2xl text-3xl font-extrabold text-white drop-shadow-md sm:text-5xl md:text-6xl">
            {item.title}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-text-secondary">
            <RatingBadge rating={item.rating} />
            <Badge tone="green">HD 1080p</Badge>
            <span>{item.year}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-text-muted" />
              {formatDuration(item.durationMinutes)}
            </span>
            <div className="hidden sm:block">
              <LanguageBadges languages={item.languages} max={4} />
            </div>
          </div>

          {item.synopsis && item.synopsis !== SYNOPSIS_FALLBACK && (
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-text-secondary line-clamp-3">
              {item.synopsis}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink
              href={`/anime/${item.slug}`}
              size="lg"
              icon={<Play className="h-4 w-4 fill-white" />}
              className="shadow-[0_0_20px_rgba(34,197,94,0.4)]"
            >
              Watch Movie
            </ButtonLink>
            <ButtonLink
              href={`/anime/${item.slug}`}
              variant="secondary"
              size="lg"
              icon={<Info className="h-4 w-4" />}
            >
              Details &amp; Cast
            </ButtonLink>
          </div>

          {items.length > 1 && (
            <div className="mt-6 flex max-w-md items-center justify-between gap-4">
              <div className="flex items-center gap-2" role="tablist" aria-label="Featured movies">
                {items.map((slide, slideIndex) => (
                  <button
                    key={slide.slug}
                    type="button"
                    onClick={() => selectSlide(slideIndex)}
                    role="tab"
                    aria-selected={slideIndex === index}
                    aria-label={`Slide ${slideIndex + 1}: ${slide.title}`}
                    className="focus-ring relative h-1.5 w-7 overflow-hidden rounded-full bg-white/25 sm:w-9"
                  >
                    {slideIndex === index && (
                      <span key={item.slug} className="hero-progress-fill absolute inset-y-0 left-0 w-full origin-left rounded-full bg-green-bright" />
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => selectSlide(index - 1)}
                  aria-label="Previous featured movie"
                  className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg border border-border-line bg-surface/70 text-text-muted transition-colors hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => selectSlide(index + 1)}
                  aria-label="Next featured movie"
                  className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg border border-border-line bg-surface/70 text-text-muted transition-colors hover:text-white"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
