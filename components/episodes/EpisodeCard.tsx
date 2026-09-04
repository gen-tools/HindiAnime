import Link from "next/link";
import { Play, Clock } from "lucide-react";
import type { Episode } from "@/types/episode";
import { PosterArt } from "@/components/anime/PosterArt";
import { LanguageBadges } from "@/components/anime/LanguageBadges";
import { Badge } from "@/components/ui/Badge";
import { formatDuration, formatRelativeDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function EpisodeCard({ episode, className }: { episode: Episode; className?: string }) {
  return (
    <Link
      href={`/watch/${episode.animeSlug}/${episode.id}`}
      className={cn(
        "focus-ring group flex h-[104px] sm:h-[114px] w-full items-center gap-3 rounded-xl border border-border-line bg-surface p-2.5 transition-all hover:border-green-primary/60 hover:bg-surface-elevated/40",
        className
      )}
    >
      <div className="relative h-full aspect-video shrink-0 overflow-hidden rounded-lg">
        <PosterArt
          seed={episode.thumbnail}
          title={episode.title}
          orientation="landscape"
          className="h-full w-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <Play className="h-5 w-5 fill-white text-white sm:h-6 sm:w-6" />
        </span>
        {episode.isNew && (
          <Badge tone="green" className="absolute left-1.5 top-1.5 px-1 py-0 text-[9px] sm:text-[10px]">
            NEW
          </Badge>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between h-full py-0.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-text-primary group-hover:text-green-light sm:text-sm">
            {episode.animeTitle}
          </p>
          <p className="truncate text-[11px] text-text-secondary sm:text-xs">
            EP {episode.number} · {episode.title}
          </p>
        </div>
        <div className="truncate">
          <LanguageBadges languages={episode.languages} max={3} className="truncate text-[11px]" />
        </div>
        <div className="flex items-center gap-3 text-[10px] text-text-muted sm:text-[11px]">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(episode.durationMinutes)}
          </span>
          {episode.releasedAt && <span>{formatRelativeDate(episode.releasedAt)}</span>}
        </div>
      </div>
    </Link>
  );
}
