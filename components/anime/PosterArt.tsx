"use client";

import Image from "next/image";
import { useState } from "react";
import { posterPalette } from "@/lib/poster";
import { cn } from "@/lib/utils";

interface PosterArtProps {
  seed: string;
  title: string;
  className?: string;
  orientation?: "portrait" | "landscape";
  /** Preserve the source artwork (`contain`) or crop it to fill the frame (`cover`). */
  fit?: "cover" | "contain";
  /** Lets full-bleed callers provide their own frame height instead of an aspect ratio. */
  fillContainer?: boolean;
  imageClassName?: string;
  priority?: boolean;
  loading?: "lazy" | "eager";
  showOverlay?: boolean;
  showSprocket?: boolean;
}

/**
 * Generates a unique, deterministic duotone "poster" for each anime using only
 * its slug/id as a seed, or renders the real image URL if provided by the API.
 */
export function PosterArt({
  seed,
  title,
  className,
  orientation = "portrait",
  fit = "cover",
  fillContainer = false,
  imageClassName,
  priority = false,
  loading,
  showOverlay = true,
  showSprocket = true,
}: PosterArtProps) {
  const { palette, angle, monogram, hash } = posterPalette(seed || title || "anime");
  const [base, mid, bright] = palette;
  const gradientId = `grad-${hash}`;
  const linesId = `lines-${hash}`;

  let imageSrc = seed && seed.startsWith("//") ? `https:${seed}` : seed;
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const imageFailed = failedImageSrc === imageSrc;

  const isExternalImage = Boolean(
    imageSrc &&
    (imageSrc.startsWith("http://") ||
      imageSrc.startsWith("https://") ||
      imageSrc.startsWith("/images/") ||
      imageSrc.startsWith("/uploads/"))
  );

  // For landscape orientation (hero banners, page headers), upgrade TMDB w500 to original HD
  if (orientation === "landscape" && imageSrc && imageSrc.includes("image.tmdb.org/t/p/w500/")) {
    imageSrc = imageSrc.replace("/w500/", "/original/");
  }

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
        <Image
          src={imageSrc}
          alt={title || "Anime poster"}
          fill
          priority={priority}
          loading={loading}
          sizes={
            orientation === "landscape"
              ? "(max-width: 768px) 100vw, (max-width: 1280px) 80vw, 1200px"
              : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 250px"
          }
          className={cn(fit === "contain" ? "object-contain" : "object-cover", imageClassName)}
          // Use unoptimized for external CDN images (TMDB, animesalt) to
          // avoid Next.js image optimizer 404s when the CDN blocks proxy fetches
          unoptimized={
            imageSrc.includes("image.tmdb.org") ||
            imageSrc.includes("animesalt.cx") ||
            imageSrc.includes("multishows.top") ||
            imageSrc.includes(".webp") ||
            imageSrc.includes(".png") ||
            imageSrc.includes(".jpg") ||
            imageSrc.includes(".jpeg")
          }
          onError={() => setFailedImageSrc(imageSrc)}
        />
      ) : (
        <svg
          viewBox="0 0 300 450"
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient
              id={gradientId}
              gradientTransform={`rotate(${angle} 0.5 0.5)`}
            >
              <stop offset="0%" stopColor={base} />
              <stop offset="55%" stopColor={mid} />
              <stop offset="100%" stopColor={base} />
            </linearGradient>
            <pattern id={linesId} width="40" height="40" patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle})`}>
              <line x1="0" y1="0" x2="0" y2="40" stroke={bright} strokeOpacity="0.06" strokeWidth="40" />
            </pattern>
          </defs>
          <rect width="300" height="450" fill={`url(#${gradientId})`} />
          <rect width="300" height="450" fill={`url(#${linesId})`} />
          <circle cx={hash % 300} cy={(hash * 3) % 200} r="140" fill={bright} opacity="0.12" />
          <text
            x="50%"
            y="58%"
            textAnchor="middle"
            fontFamily="Manrope, sans-serif"
            fontWeight="800"
            fontSize="118"
            fill={bright}
            opacity="0.16"
          >
            {monogram}
          </text>
        </svg>
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
      <span className="sr-only">{title} poster art</span>
    </div>
  );
}
