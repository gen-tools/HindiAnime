"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SeasonSelector } from "@/components/episodes/SeasonSelector";
import { EpisodeList } from "@/components/episodes/EpisodeList";
import type { Episode } from "@/types/episode";
import type { EpisodeItem, SeasonItem } from "@/types/api";
import type { LanguageCode } from "@/types/language";

export function AnimeSeasonBrowser({
  initialEpisodes,
  animeSlug,
  animeTitle,
  animePoster,
  languages,
  seasons,
  currentSeason = "1",
}: {
  initialEpisodes: Episode[];
  animeSlug: string;
  animeTitle: string;
  animePoster: string;
  languages: LanguageCode[];
  seasons: SeasonItem[];
  currentSeason?: string;
}) {
  const pathname = usePathname();
  const [episodes, setEpisodes] = useState(initialEpisodes);
  const [selectedSeason, setSelectedSeason] = useState(currentSeason);

  const loadSeason = useCallback(async (season: string, updateUrl: boolean) => {
    setSelectedSeason(season);
    if (updateUrl) {
      const query = season === "1" ? "" : `?season=${encodeURIComponent(season)}`;
      window.history.pushState(null, "", `${pathname}${query}`);
    }
    if (season === "1") {
      setEpisodes(initialEpisodes);
      return;
    }

    try {
      const response = await fetch(
        `/api/anime-episodes?slug=${encodeURIComponent(animeSlug)}&season=${encodeURIComponent(season)}`
      );
      if (!response.ok) return;
      const data = (await response.json()) as { episodes?: EpisodeItem[] };
      if (Array.isArray(data.episodes) && data.episodes.length > 0) {
        setEpisodes(data.episodes.map((item, index) => {
          const parsedNumber = Number.parseInt(item.episode || item.season, 10);
          const number = Number.isFinite(parsedNumber) && parsedNumber > 0 ? parsedNumber : index + 1;
          const thumbnail = typeof item.image === "string" && /^https?:\/\//i.test(item.image) ? item.image : animePoster;
          return {
            id: `ep-${season}-${number}`,
            animeSlug,
            animeTitle,
            animePoster,
            season: Number(season),
            number,
            title: item.title || `Episode ${number}`,
            thumbnail,
            durationMinutes: 24,
            languages,
            releasedAt: "",
          };
        }));
      }
    } catch {
      // Keep the currently displayed episodes if a non-default season is unavailable.
    }
  }, [animeSlug, animePoster, animeTitle, initialEpisodes, languages, pathname]);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("season") || "1";
    if (fromUrl !== "1") void loadSeason(fromUrl, false);
    const onPopState = () => {
      const season = new URLSearchParams(window.location.search).get("season") || "1";
      void loadSeason(season, false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [loadSeason]);

  return (
    <>
      {seasons.length > 1 && (
        <div className="mb-4 flex justify-end">
          <SeasonSelector
            seasons={seasons}
            currentSeason={selectedSeason}
            onSeasonChange={(season) => void loadSeason(season, true)}
          />
        </div>
      )}
      <EpisodeList episodes={episodes} animeSlug={animeSlug} />
    </>
  );
}
