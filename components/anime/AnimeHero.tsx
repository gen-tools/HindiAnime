"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Play, Info, Star, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import type { Anime } from "@/types/anime";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LanguageBadges } from "./LanguageBadges";
import { PosterArt } from "./PosterArt";
import { FavoriteButton } from "./FavoriteButton";
import { SYNOPSIS_FALLBACK } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const SLIDE_DURATION = 7500;

const containerVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08, delayChildren: 0.04 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: "easeOut" } },
};

export function AnimeHero({ items }: { items: Anime[] }) {
  const [index, setIndex] = useState(0);
  const [cycleKey, setCycleKey] = useState(0);

  const item = items[index];

  const goTo = useCallback((i: number) => {
    setIndex(i);
    setCycleKey((k) => k + 1);
  }, []);

  const nextSlide = useCallback(() => {
    if (items.length <= 1) return;
    setIndex((i) => (i + 1) % items.length);
    setCycleKey((k) => k + 1);
  }, [items.length]);

  const prevSlide = useCallback(() => {
    if (items.length <= 1) return;
    setIndex((i) => (i - 1 + items.length) % items.length);
    setCycleKey((k) => k + 1);
  }, [items.length]);

  useEffect(() => {
    if (items.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % items.length);
      setCycleKey((k) => k + 1);
    }, SLIDE_DURATION);
    return () => clearInterval(timer);
  }, [items.length]);

  if (!item) return null;

  const watchHref = `/watch/${item.slug}/ep-1-1`;

  return (
    <section className="relative overflow-hidden border-b border-border-line bg-background">
      {/* ─── Layer 1: Cinematic Backdrop ─────────────────────────────────── */}
      <AnimatePresence mode="sync">
        <motion.div
          key={item.slug}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 0.85, ease: "easeInOut" } }}
          className="absolute inset-0 transform-gpu"
        >
          {/* Atmospheric blur wash */}
          <PosterArt
            seed={item.backdrop || item.poster}
            title={item.title}
            orientation="landscape"
            priority
            showOverlay={false}
            showSprocket={false}
            fillContainer
            className="absolute inset-0 h-full w-full scale-110 opacity-35 blur-3xl"
          />
          {/* Crisp cinematic cover */}
          <PosterArt
            seed={item.backdrop || item.poster}
            title={item.title}
            orientation="landscape"
            fit="cover"
            showOverlay={false}
            showSprocket={false}
            fillContainer
            className="absolute inset-0 h-full w-full opacity-50 sm:opacity-60"
            imageClassName="object-cover object-center"
          />
        </motion.div>
      </AnimatePresence>

      {/* ─── Layer 2: Multi-stop Cinematic Gradients for Readability ─────── */}
      {/* Bottom heavy vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
      {/* Left-to-right reading gradient */}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent sm:via-background/60" />
      {/* Top subtle fade for header blend */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-background/70 to-transparent" />

      {/* ─── Layer 3: Hero Content Container ─────────────────────────────── */}
      <div className="container-page relative z-10 flex min-h-[480px] flex-col justify-end pb-8 pt-16 sm:min-h-[520px] sm:pb-12 sm:pt-20 md:min-h-[560px] md:flex-row md:items-end md:justify-between lg:min-h-[600px]">
        {/* Left Column: Title, Metadata, CTA */}
        <AnimatePresence mode="wait">
          <motion.div
            key={item.slug}
            variants={containerVariants}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -16, transition: { duration: 0.22, ease: "easeIn" } }}
            className="flex max-w-2xl flex-1 flex-col gap-3.5 sm:gap-4 md:pb-2"
          >
            {/* Spotlight Eyebrow Badge */}
            <motion.div variants={itemVariants} className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-green-primary/40 bg-green-primary/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-green-light shadow-sm">
                <span className="h-2 w-2 rounded-full bg-green-bright animate-pulse" />
                Featured Spotlight
              </span>
              {item.type && (
                <span className="rounded-full bg-surface-elevated px-2.5 py-0.5 text-xs font-semibold text-text-secondary border border-border-line">
                  {item.type}
                </span>
              )}
            </motion.div>

            {/* Anime Title */}
            <motion.h1
              variants={itemVariants}
              className="font-display text-3xl font-black leading-[1.06] tracking-tight text-white drop-shadow-lg sm:text-5xl md:text-6xl"
            >
              {item.title}
            </motion.h1>

            {/* Clean Metadata Row */}
            <motion.div
              variants={itemVariants}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:text-sm"
            >
              {item.rating > 0 && (
                <span className="flex items-center gap-1 font-bold text-green-bright bg-surface/60 px-2 py-0.5 rounded-md border border-green-primary/20">
                  <Star className="h-3.5 w-3.5 fill-green-bright" />
                  {item.rating.toFixed(1)}
                </span>
              )}
              {item.year && item.year > 0 && (
                <span className="font-semibold text-text-secondary">{item.year}</span>
              )}
              {item.status && (
                <Badge tone={item.status === "Ongoing" ? "green" : "outline"} className="text-xs">
                  {item.status}
                </Badge>
              )}
              {item.episodeCount && item.episodeCount > 0 && (
                <span className="font-medium text-text-muted">
                  {item.episodeCount} {item.episodeCount === 1 ? "Episode" : "Episodes"}
                </span>
              )}
            </motion.div>

            {/* Real Genre Badges */}
            {item.genres && item.genres.length > 0 && (
              <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-1.5">
                {item.genres.slice(0, 4).map((g) => (
                  <Link key={g} href={`/genre/${g}`}>
                    <span className="rounded-md border border-border-line bg-surface/80 px-2.5 py-0.5 text-[11px] font-medium capitalize text-text-secondary hover:border-green-primary/50 hover:text-green-light transition-colors">
                      {g.replace("-", " ")}
                    </span>
                  </Link>
                ))}
              </motion.div>
            )}

            {/* Synopsis */}
            {item.synopsis && item.synopsis !== SYNOPSIS_FALLBACK && (
              <motion.p
                variants={itemVariants}
                className="line-clamp-2 max-w-xl text-xs leading-relaxed text-text-secondary sm:line-clamp-3 sm:text-sm md:text-[15px]"
              >
                {item.synopsis}
              </motion.p>
            )}

            {/* Languages */}
            {item.languages && item.languages.length > 0 && (
              <motion.div variants={itemVariants}>
                <LanguageBadges languages={item.languages} max={4} className="text-xs" />
              </motion.div>
            )}

            {/* Action Buttons with Watch Now, Details, and Add to List */}
            <motion.div
              variants={itemVariants}
              className="mt-2 flex flex-wrap items-center gap-2.5 sm:gap-3"
            >
              <ButtonLink
                href={watchHref}
                size="lg"
                icon={<Play className="h-4 w-4 fill-white" />}
                className="font-bold shadow-xl shadow-green-primary/25 active:scale-95"
              >
                WATCH NOW
              </ButtonLink>

              <ButtonLink
                href={`/anime/${item.slug}`}
                variant="secondary"
                size="lg"
                icon={<Info className="h-4 w-4" />}
                className="font-semibold active:scale-95"
              >
                Details
              </ButtonLink>

              <FavoriteButton
                anime={{
                  animeSlug: item.slug,
                  title: item.title,
                  poster: item.poster,
                  rating: item.rating,
                  type: item.type,
                  genres: item.genres,
                  languages: item.languages,
                }}
              />
            </motion.div>

            {/* Carousel Slide Indicators & Arrows */}
            {items.length > 1 && (
              <motion.div
                variants={itemVariants}
                className="mt-3 flex items-center justify-between gap-4 pt-1 max-w-md"
              >
                <div className="flex items-center gap-1.5 sm:gap-2">
                  {items.map((slide, i) => (
                    <button
                      key={slide.slug}
                      onClick={() => goTo(i)}
                      role="tab"
                      aria-selected={i === index}
                      aria-label={`Slide ${i + 1}: ${slide.title}`}
                      className="focus-ring relative h-1.5 w-6 overflow-hidden rounded-full bg-white/20 transition-all sm:w-9"
                    >
                      {i === index ? (
                        <motion.span
                          key={cycleKey}
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: SLIDE_DURATION / 1000, ease: "linear" }}
                          className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-green-bright shadow-[0_0_8px_rgba(34,197,94,0.8)]"
                        />
                      ) : (
                        <span className="absolute inset-0 rounded-full bg-white/20 transition-colors hover:bg-white/40" />
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={prevSlide}
                    aria-label="Previous slide"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border-line bg-surface/60 text-text-muted hover:border-white/20 hover:text-white transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={nextSlide}
                    aria-label="Next slide"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border-line bg-surface/60 text-text-muted hover:border-white/20 hover:text-white transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Right Column: Featured Poster Artwork Card (Desktop & Tablet) */}
        <AnimatePresence mode="wait">
          <motion.div
            key={item.slug}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.22, ease: "easeIn" } }}
            transition={{ duration: 0.42, ease: "easeOut" }}
            className="hidden w-52 shrink-0 self-center md:block lg:w-64 xl:w-72"
          >
            <div className="group relative overflow-hidden rounded-2xl border-2 border-border-line shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] ring-1 ring-green-primary/30 transition-all duration-300 hover:scale-[1.02] hover:border-green-primary/60 hover:shadow-green-primary/10">
              <PosterArt seed={item.poster} title={item.title} orientation="portrait" priority />
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <Link
                  href={watchHref}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-green-bright text-black shadow-[0_0_25px_rgba(34,197,94,0.8)] transition-transform hover:scale-110 active:scale-95"
                >
                  <Play className="h-6 w-6 translate-x-0.5 fill-black" />
                </Link>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
