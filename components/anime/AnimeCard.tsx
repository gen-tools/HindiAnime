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
        "focus-ring group relative block shrink-0 rounded-xl transition-transform duration-300 hover:-translate-y-1",
        className
      )}
    >
      <div className="relative overflow-hidden rounded-xl border border-border-line transition-colors duration-300 group-hover:border-green-primary/70 group-hover:shadow-[0_0_28px_-6px_rgba(34,197,94,0.45)]">
        <div className="transition-transform duration-500 ease-out group-hover:scale-110">
          <PosterArt seed={item.poster} title={item.title} loading={imageLoading} />
        </div>

        <div className="absolute left-2 top-2">
          <Badge tone="green">{item.type}</Badge>
        </div>
        <div className="absolute right-2 top-2">
          <RatingBadge rating={item.rating} />
        </div>

        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-bright text-black shadow-[0_0_20px_rgba(34,197,94,0.7)]">
            <Play className="h-5 w-5 translate-x-0.5 fill-black" />
          </span>
        </div>
      </div>

      {/* Rendered outside the overflow-hidden poster box so the top of the
          number doesn't get clipped by the card's rounded corners. */}
      {rank && (
        <span className="font-eyebrow pointer-events-none absolute -left-1 -top-2 z-10 text-[56px] leading-none text-black [-webkit-text-stroke:1.5px_#22c55e] opacity-90 drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] sm:text-[64px]">
          {String(rank).padStart(2, "0")}
        </span>
      )}

      <div className="pt-2.5">
        <h3 className="truncate text-sm font-semibold text-text-primary group-hover:text-green-light">
          {item.title}
        </h3>
        <LanguageBadges languages={item.languages} max={3} className="mt-1" />
      </div>
    </Link>
  );
}
