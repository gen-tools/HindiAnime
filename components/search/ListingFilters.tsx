"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Select } from "@/components/ui/Select";
import { genres } from "@/lib/mock/genres";
import { languages } from "@/lib/mock/languages";

export function ListingFilters({ years }: { years: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Select
        aria-label="Filter by language"
        value={searchParams.get("language") ?? ""}
        onChange={(e) => updateParam("language", e.target.value)}
      >
        <option value="">All Languages</option>
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by genre"
        value={searchParams.get("genre") ?? ""}
        onChange={(e) => updateParam("genre", e.target.value)}
      >
        <option value="">All Genres</option>
        {genres.map((g) => (
          <option key={g.slug} value={g.slug}>
            {g.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by year"
        value={searchParams.get("year") ?? ""}
        onChange={(e) => updateParam("year", e.target.value)}
      >
        <option value="">All Years</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by type"
        value={searchParams.get("type") ?? ""}
        onChange={(e) => updateParam("type", e.target.value)}
      >
        <option value="">All Types</option>
        <option value="TV">TV</option>
        <option value="Movie">Movie</option>
      </Select>

      <Select
        aria-label="Sort results"
        value={searchParams.get("sort") ?? "recent"}
        onChange={(e) => updateParam("sort", e.target.value)}
      >
        <option value="recent">Most Recent</option>
        <option value="rating">Top Rated</option>
        <option value="title">A–Z</option>
      </Select>
    </div>
  );
}
