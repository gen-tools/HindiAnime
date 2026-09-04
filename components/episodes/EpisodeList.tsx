"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { Episode } from "@/types/episode";
import { cn } from "@/lib/utils";
import { deduplicateEpisodes, getEpisodeIdentity } from "@/lib/episodes";

export function EpisodeList({
  episodes,
  animeSlug,
  activeEpisodeId,
}: {
  episodes: Episode[];
  animeSlug: string;
  activeEpisodeId?: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = deduplicateEpisodes(episodes).filter(
    (e) =>
      String(e.number).includes(query) || e.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="rounded-xl border border-border-line bg-surface p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-display text-base font-bold text-text-primary">Episodes</h3>
        <div className="relative w-40">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find episode"
            aria-label="Search episodes"
            className="focus-ring w-full rounded-lg border border-border-line bg-surface-elevated py-1.5 pl-8 pr-2 text-xs text-text-primary placeholder:text-text-muted focus:border-green-bright/70"
          />
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 md:grid-cols-8">
        {filtered.map((ep) => {
          const isActive = ep.id === activeEpisodeId;
          return (
            <Link
              key={getEpisodeIdentity(ep)}
              href={`/watch/${animeSlug}/${ep.id}`}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "focus-ring flex aspect-square items-center justify-center rounded-lg border text-sm font-semibold transition-colors",
                isActive
                  ? "border-green-bright bg-green-primary/20 text-green-light shadow-[0_0_0_1px_rgba(34,197,94,0.4)]"
                  : "border-border-line bg-surface-elevated text-text-secondary hover:border-green-primary/50 hover:text-white"
              )}
            >
              {String(ep.number).padStart(2, "0")}
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="py-6 text-center text-sm text-text-muted">No episodes match &quot;{query}&quot;.</p>
      )}
    </div>
  );
}
