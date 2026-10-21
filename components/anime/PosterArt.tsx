"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface PosterArtProps {
  seed: string;
  title: string;
  className?: string;
  orientation?: "portrait" | "landscape";
  /** Use a smaller source variant for compact catalog cards. */
  imageSize?: "card" | "poster";
  /** Preserve the source artwork (`contain`) or crop it to fill the frame (`cover`). */
  fit?: "cover" | "contain";
  /** Lets full-bleed callers provide their own frame height instead of an aspect ratio. */
  fillContainer?: boolean;
  imageClassName?: string;
  priority?: boolean;
  loading?: "lazy" | "eager";
  sizes?: string;
  showOverlay?: boolean;
  showSprocket?: boolean;
}

/** Renders verified source artwork. Missing or failed assets remain neutral. */
export function PosterArt({
  seed,
  title,
  className,
  orientation = "portrait",
  imageSize = "poster",
  fit = "cover",
  fillContainer = false,
  imageClassName,
  priority = false,
  loading,
  sizes,
  showOverlay = true,
  showSprocket = true,
}: PosterArtProps) {
  let imageSrc = seed && seed.startsWith("//") ? `https:${seed}` : seed;
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const imageFailed = failedImageSrc === imageSrc;
  const isExternalImage = Boolean(
    imageSrc &&
    !imageSrc.includes("AnimeSalticon") &&
    !imageSrc.includes("cropped-") &&
    !imageSrc.includes("favicon") &&
    !imageSrc.startsWith("data:") &&
    (imageSrc.startsWith("http://") ||
      imageSrc.startsWith("https://") ||
      imageSrc.startsWith("/images/") ||
      imageSrc.startsWith("/uploads/"))
  );

  const isTmdbImage = imageSrc.includes("image.tmdb.org/t/p/");
  const isAniListImage = /(^|\.)anilist\.co$/i.test(
    (() => {
      try {
        return new URL(imageSrc).hostname;
      } catch {
        return "";
      }
    })()
  );

  // Request TMDB's existing sized assets directly. Compact cards use w342,
  // full-size portrait art uses w500, and hero artwork uses w1280.
  if (isTmdbImage) {
    const tmdbSize = orientation === "landscape" ? "w1280" : imageSize === "card" ? "w342" : "w500";
    imageSrc = imageSrc.replace(/\/t\/p\/(?:w\d+|original)\//, `/t/p/${tmdbSize}/`);
  }

  const mobileHeroSrc = isTmdbImage && orientation === "landscape"
    ? imageSrc.replace("/t/p/w1280/", "/t/p/w780/")
    : null;
  const image = (
    <Image
      src={imageSrc}
      alt={title || "Anime poster"}
      fill
      // Let <picture> choose the mobile TMDB size before the request starts.
      // fetchPriority keeps the hero image prioritized without preloading the
      // desktop-sized asset on phones.
      priority={false}
      loading={priority ? "eager" : loading}
      fetchPriority={priority ? "high" : "auto"}
      sizes={sizes || (
        orientation === "landscape"
          ? "(max-width: 768px) 100vw, (max-width: 1280px) 80vw, 1200px"
          : "(max-width: 640px) 45vw, (max-width: 768px) 30vw, (max-width: 1024px) 25vw, (max-width: 1280px) 20vw, 180px"
      )}
      className={cn(fit === "contain" ? "object-contain" : "object-cover", imageClassName)}
      // TMDB and AniList already provide appropriately sized assets. Load
      // them directly to avoid consuming Vercel image transformations.
      unoptimized={
        isTmdbImage ||
        isAniListImage ||
        imageSrc.includes("animesalt.cx") ||
        imageSrc.includes("multishows.top")
      }
      onError={() => setFailedImageSrc(imageSrc)}
    />
  );

  return (
    <div
      className={cn(
        "overflow-hidden bg-surface",
        fillContainer
          ? "absolute inset-0 h-full w-full"
          : cn(
              "relative w-full",
              orientation === "portrait" ? "aspect-[2/3]" : "aspect-video"
            ),
        className
      )}
      aria-hidden="true"
    >
      {isExternalImage && !imageFailed ? (
        mobileHeroSrc ? (
          <picture className="absolute inset-0 block">
            <source media="(max-width: 767px)" srcSet={mobileHeroSrc} />
            {image}
          </picture>
        ) : image
      ) : (
        <div className="absolute inset-0 bg-surface-elevated" />
      )}

      {/* film-sprocket motif along the left edge */}
      {showSprocket && (
        <div className="absolute inset-y-0 left-0 flex w-2.5 flex-col justify-between bg-black/30 py-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <span key={i} className="mx-auto h-1.5 w-1.5 rounded-[2px] bg-black/60" />
          ))}
        </div>
      )}

      {showOverlay && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      )}
      <span className="sr-only">{title} artwork</span>
    </div>
  );
}
