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

  function updateParam(key: string, value: string) {
    const params = normalizeFilterParams(normalizedParams, {
      sortOptions: ["recent", "rating", "title"],
    });
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    const query = params.toString();
    router.push(`${pathname}${query ? `?${query}` : ""}`);
  }

  function handleGenreChange(newGenre: string) {
    if (!isGenrePage) {
      updateParam("genre", newGenre);
      return;
    }

    const params = normalizeFilterParams(normalizedParams, {
      omit: ["genre"],
      sortOptions: ["recent", "rating", "title"],
    });
    params.delete("page");
    const query = params.toString();
    const suffix = query ? `?${query}` : "";
    router.push(newGenre ? `/genre/${newGenre}${suffix}` : `/search${suffix}`);
  }

  function handleLanguageChange(newLang: string) {
    if (isLanguagePage) {
      const params = normalizeFilterParams(normalizedParams, {
        sortOptions: ["recent", "rating", "title"],
      });
      params.delete("language");
      params.delete("page");
      const qs = params.toString();
      if (newLang) {
        router.push(`/language/${newLang}${qs ? `?${qs}` : ""}`);
      } else {
        router.push(`/search${qs ? `?${qs}` : ""}`);
      }
    } else {
      updateParam("language", newLang);
    }
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
