import { countries } from "@/lib/mock/countries";
import { genres } from "@/lib/mock/genres";
import { languages } from "@/lib/mock/languages";

type SearchParamRecord = Record<string, string | undefined>;

const filterKeys = ["genre", "language", "country", "type", "year", "sort", "page"] as const;

export function normalizeFilterParams(
  input: string | URLSearchParams | SearchParamRecord,
  options: { omit?: string[]; sortOptions?: readonly string[] } = {}
): URLSearchParams {
  const params = new URLSearchParams();
  if (typeof input === "string") {
    new URLSearchParams(input).forEach((value, key) => params.append(key, value));
  } else if (input instanceof URLSearchParams) {
    input.forEach((value, key) => params.append(key, value));
  } else {
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string") params.append(key, value);
    }
  }

  const omitted = new Set(options.omit || []);
  for (const key of filterKeys) {
    if (omitted.has(key)) {
      params.delete(key);
      continue;
    }

    const value = params.get(key);
    if (value === null) continue;
    const valid = key === "genre"
      ? genres.some((genre) => genre.slug === value)
      : key === "language"
        ? languages.some((language) => language.code === value)
        : key === "country"
          ? countries.some((country) => country.code === value)
          : key === "type"
            ? value === "TV" || value === "Movie"
            : key === "year"
              ? /^\d{4}$/.test(value)
              : key === "sort"
                ? (options.sortOptions || ["recent", "rating", "year", "title"]).includes(value)
                : /^[1-9]\d*$/.test(value);

    if (!value || !valid) params.delete(key);
  }

  return params;
}

export function hasFilterParamChanges(
  original: SearchParamRecord,
  normalized: URLSearchParams
): boolean {
  return filterKeys.some((key) => (original[key] ?? null) !== normalized.get(key));
}
