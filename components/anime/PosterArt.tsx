"use client";

import Image from "next/image";
import { useState } from "react";
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

/** Renders verified source artwork. Missing or failed assets remain neutral. */
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
