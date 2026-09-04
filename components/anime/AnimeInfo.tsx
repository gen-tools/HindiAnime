import { Play, Star, Clock } from "lucide-react";
import type { Anime } from "@/types/anime";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LanguageBadges } from "./LanguageBadges";
import { PosterArt } from "./PosterArt";
import { formatDuration } from "@/lib/utils";
import Link from "next/link";
import { SYNOPSIS_FALLBACK } from "@/lib/api/client";

export function AnimeInfo({ item, firstEpisodeId }: { item: Anime; firstEpisodeId?: string }) {
  const targetWatchHref = firstEpisodeId
    ? `/watch/${item.slug}/${firstEpisodeId}`
    : `/watch/${item.slug}/ep-1-1`;

  return (
    <div className="container-page relative -mt-28 flex flex-col gap-6 pb-4 sm:-mt-36 md:flex-row md:gap-8">
      <div className="w-36 shrink-0 sm:w-48 md:w-56">
        <PosterArt
          seed={item.poster}
          title={item.title}
          className="rounded-xl border-2 border-border-line shadow-2xl"
        />
      </div>

      <div className="flex flex-1 flex-col gap-4 pt-2">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-text-primary md:text-4xl">{item.title}</h1>
          {item.alternativeTitle && (
            <p className="mt-1 text-sm text-text-muted">{item.alternativeTitle}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {item.rating > 0 && (
            <span className="flex items-center gap-1 font-semibold text-green-light">
              <Star className="h-4 w-4 fill-green-light" />
              {item.rating.toFixed(1)}
            </span>
          )}
          {item.year > 0 && <span className="text-text-secondary">{item.year}</span>}
          {item.type && <Badge tone="outline">{item.type}</Badge>}
          {item.status && <Badge tone={item.status === "Ongoing" ? "green" : "outline"}>{item.status}</Badge>}
          {item.durationMinutes > 0 && (
            <span className="flex items-center gap-1 text-text-secondary">
              <Clock className="h-3.5 w-3.5" />
              {formatDuration(item.durationMinutes)}
            </span>
          )}
          {item.episodeCount > 0 && <span className="text-text-secondary">{item.episodeCount} Episodes</span>}
        </div>

        {item.genres && item.genres.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {item.genres.map((g) => (
              <Link key={g} href={`/genre/${g}`}>
                <Badge className="capitalize hover:border-green-primary/60 hover:text-green-light">
                  {g.replace("-", " ")}
                </Badge>
              </Link>
            ))}
          </div>
        )}

        {item.languages && item.languages.length > 0 && (
          <LanguageBadges languages={item.languages} max={item.languages.length} />
        )}

        {item.synopsis && item.synopsis !== SYNOPSIS_FALLBACK && (
          <p className="max-w-3xl text-sm leading-relaxed text-text-secondary md:text-[15px]">{item.synopsis}</p>
        )}

        <div className="mt-1 flex flex-wrap gap-3">
          <ButtonLink
            href={targetWatchHref}
            size="lg"
            icon={<Play className="h-4 w-4 fill-white" />}
          >
            Watch Now
          </ButtonLink>
        </div>

        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border-line pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-text-muted">Studio</dt>
            <dd className="text-text-secondary">{item.studio || "Anime"}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Seasons</dt>
            <dd className="text-text-secondary">{item.seasons || 1}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Status</dt>
            <dd className="text-text-secondary">{item.status || "Ongoing"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
