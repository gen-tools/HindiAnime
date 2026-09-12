import Link from "next/link";
import { Play } from "lucide-react";
import type { Anime } from "@/types/anime";
import { PosterArt } from "./PosterArt";
import { RatingBadge } from "@/components/ui/RatingBadge";
import { LanguageBadges } from "./LanguageBadges";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

export function AnimeCard({
  item,
  rank,
  className,
  imageLoading,
}: {
  item: Anime;
  rank?: number;
  className?: string;
  imageLoading?: "lazy" | "eager";
}) {
  return (
    <Link
      href={`/anime/${item.slug}`}
      className={cn(
        "focus-ring group relative block shrink-0 rounded-xl transition-all duration-300 hover:-translate-y-1",
        className
      )}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-border-line bg-surface-card transition-all duration-300 group-hover:border-green-primary/70 group-hover:shadow-[0_10px_30px_-8px_rgba(34,197,94,0.4)]">
        {/* Poster Image with subtle scale */}
        <div className="h-full w-full transition-transform duration-500 ease-out group-hover:scale-105">
          <PosterArt seed={item.poster} title={item.title} loading={imageLoading} className="h-full w-full object-cover" />
        </div>

        {/* Top Badges */}
        <div className="absolute left-2 top-2 z-10 flex items-center gap-1">
          {item.type && <Badge tone="green" className="text-[10px] px-1.5 py-0.5">{item.type}</Badge>}
        </div>
        <div className="absolute right-2 top-2 z-10">
          <RatingBadge rating={item.rating} />
        </div>

        {/* Bottom subtle gradient scrim over image */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

        {/* Bottom metadata snippet */}
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 flex items-center justify-between text-[11px] font-medium text-white/90">
          <span>{item.year || (item.status === "Completed" ? "Full" : item.status || "")}</span>
          {item.episodeCount && item.episodeCount > 1 ? (
            <span className="text-[10px] text-text-secondary">{item.episodeCount} eps</span>
          ) : null}
        </div>

        {/* Hover Play Overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[1px] opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-green-bright text-black shadow-[0_0_20px_rgba(34,197,94,0.8)] transition-transform duration-300 group-hover:scale-110 active:scale-95">
            <Play className="h-5 w-5 translate-x-0.5 fill-black" />
          </span>
        </div>
      </div>

      {/* Ranked number badge for Top Trending / Ranked rows */}
      {rank && (
        <span className="font-eyebrow pointer-events-none absolute -left-1.5 -top-2.5 z-20 text-[54px] leading-none text-black [-webkit-text-stroke:1.5px_#22c55e] opacity-95 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] sm:text-[62px]">
          {String(rank).padStart(2, "0")}
        </span>
      )}

      {/* Card Info Below Poster */}
      <div className="pt-2.5">
        <h3 className="truncate text-sm font-semibold text-text-primary transition-colors group-hover:text-green-light">
          {item.title}
        </h3>
        <div className="mt-1 flex items-center justify-between gap-1">
          <LanguageBadges languages={item.languages} max={2} className="text-[10px]" />
          {item.genres && item.genres[0] && (
            <span className="text-[10px] font-medium text-text-muted capitalize truncate max-w-[70px]">
              {item.genres[0].replace("-", " ")}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
