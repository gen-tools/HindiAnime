"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Select } from "@/components/ui/Select";
import type { SeasonItem } from "@/types/api";

export function SeasonSelector({
  seasons,
  currentSeason = "1",
  onSeasonChange,
  watchAnimeSlug,
}: {
  seasons: number | SeasonItem[];
  currentSeason?: string | number;
  onSeasonChange?: (season: string) => void;
  /** Route directly to the first episode of the chosen watch-page season. */
  watchAnimeSlug?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const seasonList: Array<{ value: string; label: string }> = Array.isArray(seasons)
    ? seasons.map((s) => ({ value: s.season, label: s.text || `Season ${s.season}` }))
    : Array.from({ length: Math.max(1, seasons) }).map((_, i) => ({
        value: String(i + 1),
        label: `Season ${i + 1}`,
      }));

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = e.target.value;
    if (onSeasonChange) {
      onSeasonChange(selected);
    } else if (watchAnimeSlug) {
      router.push(`/watch/${watchAnimeSlug}/ep-${selected}-1`);
    } else {
      const nextParams = new URLSearchParams(searchParams ? searchParams.toString() : "");
      nextParams.set("season", selected);
      router.push(`${pathname}?${nextParams.toString()}`);
    }
  }

  return (
    <Select
      value={String(currentSeason)}
      onChange={handleChange}
      className="w-40"
      aria-label="Select season"
    >
      {seasonList.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </Select>
  );
}
