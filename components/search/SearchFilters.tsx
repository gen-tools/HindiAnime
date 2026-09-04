"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/Select";
import { genres } from "@/lib/mock/genres";
import { languages } from "@/lib/mock/languages";

export function SearchFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.push(`/search?${params.toString()}`);
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        value={searchParams.get("sort") ?? "rating"}
        onChange={(e) => updateParam("sort", e.target.value)}
      >
        <option value="rating">Top Rated</option>
        <option value="year">Newest</option>
        <option value="title">A–Z</option>
      </Select>
    </div>
  );
}
