"use client";

import { useEffect } from "react";
import { recordWatchProgress } from "@/lib/storage/userDataService";

interface WatchTrackerProps {
  animeSlug: string;
  animeTitle: string;
  animePoster: string;
  season: number;
  episode: number;
  episodeId: string;
  episodeTitle: string;
  durationMinutes?: number;
  genres?: string[];
}

export function WatchTracker({
  animeSlug,
  animeTitle,
  animePoster,
  season,
  episode,
  episodeId,
  episodeTitle,
  durationMinutes,
  genres,
}: WatchTrackerProps) {
  useEffect(() => {
    // Record this episode watch into IndexedDB Continue Watching & Watch History
    recordWatchProgress({
      animeSlug,
      animeTitle,
      animePoster,
      season,
      episode,
      episodeId,
      episodeTitle,
      durationMinutes,
      genres,
    }).catch((err) => {
      console.warn("Could not save watch progress to IndexedDB:", err);
    });
  }, [
    animeSlug,
    animeTitle,
    animePoster,
    season,
    episode,
    episodeId,
    episodeTitle,
    durationMinutes,
    genres,
  ]);

  return null; // Headless tracker component
}
