"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Select } from "@/components/ui/Select";
import { genres } from "@/lib/mock/genres";
import { languages } from "@/lib/mock/languages";
import { countries } from "@/lib/mock/countries";
import { normalizeFilterParams } from "@/lib/search-filters";

export function ListingFilters({ years }: { years: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const normalizedParams = normalizeFilterParams(searchParams.toString(), {
    sortOptions: ["recent", "rating", "title"],
  });

  const pathSegments = pathname.split("/").filter(Boolean);
  const isLanguagePage = pathSegments[0] === "language" && Boolean(pathSegments[1]);
  const isGenrePage = pathSegments[0] === "genre" && Boolean(pathSegments[1]);
  const activeLanguage = isLanguagePage
    ? (normalizedParams.get("language") || pathSegments[1])
    : (normalizedParams.get("language") ?? "");
  const activeGenre = isGenrePage
    ? pathSegments[1]
    : (normalizedParams.get("genre") ?? "");

  function handleGenreChange(newGenre: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("genre");
    params.delete("page");
    const query = params.toString() ? `?${params.toString()}` : "";

    if (pathname.startsWith("/genre")) {
      if (newGenre) {
        router.push(`/genre/${newGenre}${query}`);
      } else {
        router.push(`/search${query}`);
      }
      return;
    }

    if (newGenre) params.set("genre", newGenre);
    else params.delete("genre");
    router.push(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  function handleLanguageChange(newLang: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("language");
    params.delete("page");
    const query = params.toString() ? `?${params.toString()}` : "";

    if (pathname.startsWith("/language")) {
      if (newLang) {
        router.push(`/language/${newLang}${query}`);
      } else {
        router.push(`/search${query}`);
      }
      return;
    }

    if (newLang) params.set("language", newLang);
    else params.delete("language");
    router.push(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  function updateParam(key: string, value: string) {
    const params = normalizeFilterParams(normalizedParams, {
      sortOptions: ["recent", "rating", "title"],
    });
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    const query = params.toString() ? `?${params.toString()}` : "";
    router.push(`${pathname}${query}`);
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Select
        aria-label="Filter by language"
        value={activeLanguage}
        onChange={(e) => handleLanguageChange(e.target.value)}
      >
        <option value="">All Languages</option>
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by country"
        value={normalizedParams.get("country") ?? ""}
        onChange={(e) => updateParam("country", e.target.value)}
      >
        <option value="">All Countries</option>
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by genre"
        value={activeGenre}
        onChange={(e) => handleGenreChange(e.target.value)}
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
        value={normalizedParams.get("year") ?? ""}
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
        value={normalizedParams.get("type") ?? ""}
        onChange={(e) => updateParam("type", e.target.value)}
      >
        <option value="">All Types</option>
        <option value="TV">TV</option>
        <option value="Movie">Movie</option>
      </Select>

      <Select
        aria-label="Sort results"
        value={normalizedParams.get("sort") ?? "recent"}
        onChange={(e) => updateParam("sort", e.target.value)}
      >
        <option value="recent">Most Recent</option>
        <option value="rating">Top Rated</option>
        <option value="title">A–Z</option>
      </Select>
    </div>
  );
}
