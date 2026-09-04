"use client";

import { useEffect, useState, useCallback } from "react";
import { Play, Info, Star } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import type { Anime } from "@/types/anime";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LanguageBadges } from "./LanguageBadges";
import { PosterArt } from "./PosterArt";
import { SYNOPSIS_FALLBACK } from "@/lib/api/client";

const SLIDE_DURATION = 7000;

const containerVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.07, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -14 },
  show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

export function AnimeHero({ items }: { items: Anime[] }) {
  const [index, setIndex] = useState(0);
  const [cycleKey, setCycleKey] = useState(0);

  const item = items[index];

  const goTo = useCallback((i: number) => {
    setIndex(i);
    setCycleKey((k) => k + 1);
  }, []);

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
    <section className="relative overflow-hidden border-b border-border-line">
      {/*
        Layer 1 — Full-bleed cinematic backdrop.
        The API exposes a portrait poster; we use object-cover to fill the
        entire hero frame so the artwork reads as a proper widescreen backdrop.
        A heavily blurred copy sits underneath to fill any letterbox gaps and
        adds atmospheric colour wash.
      */}
      <AnimatePresence mode="sync">
        <motion.div
          key={item.slug}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 0.9, ease: "easeInOut" } }}
          className="absolute inset-0 transform-gpu"
        >
          {/* Atmospheric blur base — fills any gap colour from the poster palette */}
          <PosterArt
            seed={item.backdrop || item.poster}
            title={item.title}
            orientation="landscape"
            priority
            showOverlay={false}
            showSprocket={false}
            fillContainer
            className="absolute inset-0 h-full w-full scale-110 opacity-40 blur-3xl"
          />
          {/* Sharp full-bleed cover — crops the poster to fill the frame */}
          <PosterArt
            seed={item.backdrop || item.poster}
            title={item.title}
            orientation="landscape"
            fit="cover"
            showOverlay={false}
            showSprocket={false}
            fillContainer
            className="absolute inset-0 h-full w-full opacity-60"
            imageClassName="object-cover object-center"
          />
        </motion.div>
      </AnimatePresence>

      {/*
        Layer 2 — Gradient overlays.
        • Bottom vignette: ensures title / meta text stays readable.
        • Left sweep: keeps the left text block legible.
        • Right fade: pulls back just enough so the poster card on the
          right stands out cleanly against the backdrop.
      */}
      {/* Bottom vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
      {/* Left text readability sweep */}
      <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/60 to-transparent md:from-background/85 md:via-background/45" />
      {/* Subtle top darkening so the logo/nav area isn't blown out */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background/60 to-transparent" />

      {/* Hero Content Container */}
      <div className="container-page relative flex min-h-[460px] flex-col justify-end gap-6 py-10 sm:min-h-[500px] md:min-h-[540px] md:flex-row md:items-end md:justify-between md:py-14 lg:min-h-[580px]">
        {/* Left Text Block */}
        <AnimatePresence mode="wait">
          <motion.div
            key={item.slug}
            variants={containerVariants}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, x: -40, transition: { duration: 0.25, ease: "easeIn" } }}
            className="flex max-w-2xl flex-1 flex-col gap-4 md:pb-2"
          >
            {/* Top Eyebrow Tag */}
            <motion.span
              variants={itemVariants}
              className="eyebrow inline-flex w-fit items-center gap-2 text-xs font-bold text-green-light sm:text-sm"
            >
              <span className="h-2 w-2 rounded-full bg-green-bright animate-pulse" />
              SPOTLIGHT ANIME
            </motion.span>

            {/* Anime Title */}
            <motion.h1
              variants={itemVariants}
              className="font-display text-3xl font-black leading-[1.08] tracking-tight text-white drop-shadow-md sm:text-5xl md:text-6xl"
            >
              {item.title}
            </motion.h1>

            {/* Badges & Meta Info in One Clean Line */}
            <motion.div
              variants={itemVariants}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs sm:text-sm"
            >
              {item.rating > 0 && (
                <span className="flex items-center gap-1 font-bold text-green-bright">
                  <Star className="h-4 w-4 fill-green-bright" />
                  {item.rating.toFixed(1)}
                </span>
              )}
              {item.year > 0 && (
                <span className="font-medium text-text-secondary">{item.year}</span>
              )}
              {item.type && <Badge tone="outline">{item.type}</Badge>}
              {item.status && (
                <Badge tone={item.status === "Ongoing" ? "green" : "outline"}>
                  {item.status}
                </Badge>
              )}
              {item.episodeCount > 0 && (
                <span className="font-medium text-text-secondary">
                  {item.episodeCount} Episodes
                </span>
              )}
            </motion.div>

            {/* Synopsis — only render when the API returned real text */}
            {item.synopsis && item.synopsis !== SYNOPSIS_FALLBACK && (
              <motion.p
                variants={itemVariants}
                className="line-clamp-3 max-w-xl text-xs leading-relaxed text-text-secondary sm:text-sm md:text-[15px]"
              >
                {item.synopsis}
              </motion.p>
            )}

            {/* Languages */}
            {item.languages && item.languages.length > 0 && (
              <motion.div variants={itemVariants}>
                <LanguageBadges languages={item.languages} max={5} className="text-xs sm:text-sm" />
              </motion.div>
            )}

            {/* Action Buttons */}
            <motion.div variants={itemVariants} className="mt-1 flex flex-wrap items-center gap-3">
              <ButtonLink
                href={watchHref}
                size="lg"
                icon={<Play className="h-4 w-4 fill-white" />}
                className="shadow-lg shadow-green-primary/20"
              >
                WATCH NOW
              </ButtonLink>
              <ButtonLink
                href={`/anime/${item.slug}`}
                variant="secondary"
                size="lg"
                icon={<Info className="h-4 w-4" />}
              >
                More Info
              </ButtonLink>
            </motion.div>

            {/* Slide Pagination Bars */}
            {items.length > 1 && (
              <motion.div
                variants={itemVariants}
                className="mt-2 flex items-center gap-2"
                role="tablist"
                aria-label="Featured anime slides"
              >
                {items.map((slide, i) => (
                  <button
                    key={slide.slug}
                    onClick={() => goTo(i)}
                    role="tab"
                    aria-selected={i === index}
                    aria-label={`Show ${slide.title}`}
                    className="focus-ring relative h-1.5 w-8 overflow-hidden rounded-full bg-white/20 transition-all sm:w-10"
                  >
                    {i === index ? (
                      <motion.span
                        key={cycleKey}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: SLIDE_DURATION / 1000, ease: "linear" }}
                        className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-green-bright"
                      />
                    ) : (
                      <span className="absolute inset-0 rounded-full bg-white/20 transition-colors hover:bg-white/40" />
                    )}
                  </button>
                ))}
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Right Anime Poster Card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={item.slug}
            initial={{ opacity: 0, x: 50, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 50, transition: { duration: 0.25, ease: "easeIn" } }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="hidden w-52 shrink-0 self-center md:block lg:w-60 xl:w-64"
          >
            <div className="overflow-hidden rounded-2xl border-2 border-border-line shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)] ring-1 ring-green-primary/30 transition-transform duration-300 hover:scale-[1.02]">
              <PosterArt seed={item.poster} title={item.title} orientation="portrait" />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
