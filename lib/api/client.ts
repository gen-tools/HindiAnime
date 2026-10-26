import type {
  AnimeSearchResponse,
  AnimeInfoResponse,
  EpisodeResponse,
  StreamResponse,
  AnimeInfoData,
  AnimeListItem,
  AnimeSearchResult,
  EpisodeItem,
  AnimeCatalogResponse,
  HomepageApiResponse,
  HomepageFreshDropItem,
  HomepageRankedItem,
  LatestEpisodesResponse,
  LatestEpisodeItem,
  MovieInfoData,
  MovieInfoResponse,
} from "@/types/api";
import type { Anime } from "@/types/anime";
import type { Episode } from "@/types/episode";
import type { LanguageCode } from "@/types/language";
import { cache } from "react";
import { SYNOPSIS_FALLBACK } from "@/lib/api/constants";
import { BLOCKED_STREAM_DOMAINS, isValidEmbedUrl } from "@/lib/api/stream-validation";
export { SYNOPSIS_FALLBACK, BLOCKED_STREAM_DOMAINS, isValidEmbedUrl };
import { deduplicateEpisodes } from "@/lib/episodes";
import { fuzzySearch, fuzzyScore, COMMON_ACRONYMS } from "@/lib/fuzzy-search";
import { anime, getAnimeBySlug, getAnimeByGenre, getAnimeByLanguage, getAnimeByCountry } from "@/lib/mock/anime";
import { matchesCountry } from "@/lib/mock/countries";
import { shareInFlightRequest } from "@/lib/api/in-flight";
import { MOCK_ARTWORK_URL } from "@/lib/mock/artwork";

function isLegacyApiEnabled(): boolean {
  return typeof window === "undefined" && process.env.LEGACY_API_FALLBACK_ENABLED === "true";
}

function getLegacyApiBaseUrl(): string | null {
  if (!isLegacyApiEnabled()) return null;
  const configuredUrl = process.env.LEGACY_API_URL?.trim().replace(/\/+$/, "");
  return configuredUrl || null;
}

function logDataSource(feature: string, source: string, outcome: "success" | "empty" | "error"): void {
  if (typeof window === "undefined" && process.env.DATA_SOURCE_LOGGING === "true") {
    console.info("[Data source]", { feature, source, outcome });
  }
}

const CATALOG_CACHE_SECONDS = 21600;
const SEARCH_CACHE_SECONDS = 21600;
const SCRAPER_NEGATIVE_CACHE_MS = 3 * 60 * 1000;
const scraperNegativeCache = new Map<string, number>();

function normalizeApiSearchQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function rethrowNextControlFlow(error: unknown): void {
  if (typeof window !== "undefined") return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unstable_rethrow } = require("next/navigation") as typeof import("next/navigation");
  unstable_rethrow(error);
}

async function cacheValidatedScraperResult<T>(
  keyParts: string[],
  revalidateSeconds: number,
  load: () => Promise<T | null>,
  isValid: (result: T | null) => result is T
): Promise<T | null> {
  if (typeof window !== "undefined") return load();

  const cacheKey = keyParts.join("\u0000");
  const sourceName = keyParts[0] === "anilist-metadata" ? "anilist" : "animesalt-worker-or-direct";
  const failedUntil = scraperNegativeCache.get(cacheKey);
  if (failedUntil && failedUntil > Date.now()) return null;
  if (failedUntil) scraperNegativeCache.delete(cacheKey);

  // Cache parsed/validated domain data, not raw HTML. Invalid pages, challenges,
  // empty results, and failed requests throw before an entry is stored.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unstable_cache } = require("next/cache") as typeof import("next/cache");
  const cachedLoad = unstable_cache(
    async () => {
      const result = await load();
      if (!isValid(result)) throw new Error("Scraper returned no valid parsed result");
      return result;
    },
    ["validated-animesalt-parsed-v1", ...keyParts],
    { revalidate: revalidateSeconds }
  ) as () => Promise<T>;

  try {
    const result = await cachedLoad();
    scraperNegativeCache.delete(cacheKey);
    logDataSource(keyParts[0] || "scraper", sourceName, "success");
    return result;
  } catch (error) {
    rethrowNextControlFlow(error);
    logDataSource(keyParts[0] || "scraper", sourceName, "error");
    if (scraperNegativeCache.size > 2000) {
      for (const [key, expiry] of scraperNegativeCache) {
        if (expiry <= Date.now()) scraperNegativeCache.delete(key);
      }
    }
    scraperNegativeCache.set(cacheKey, Date.now() + SCRAPER_NEGATIVE_CACHE_MS);
    return null;
  }
}

async function fetchLegacyValidated<T>(
  feature: string,
  cacheKey: string,
  path: string,
  isValid: (data: unknown) => data is T,
  revalidateSeconds = 21600
): Promise<T | null> {
  const baseUrl = getLegacyApiBaseUrl();
  if (!baseUrl) return null;

  // Cache only validated JSON. Throwing on HTTP errors, malformed JSON, and
  // empty payloads prevents those responses from being retained for six hours.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unstable_cache } = require("next/cache") as typeof import("next/cache");
  const load = unstable_cache(
    async () => {
      const response = await fetch(`${baseUrl}${path}`);
      if (!response.ok) throw new Error(`Legacy API returned ${response.status}`);
      const data: unknown = await response.json();
      if (!isValid(data)) throw new Error("Legacy API returned an invalid or empty payload");
      return data;
    },
    ["validated-legacy-api-v1", feature, cacheKey, baseUrl, path],
    { revalidate: revalidateSeconds }
  ) as () => Promise<T>;

  try {
    const result = await load();
    logDataSource(feature, "legacy-api", "success");
    return result;
  } catch (error) {
    rethrowNextControlFlow(error);
    logDataSource(feature, "legacy-api", "error");
    return null;
  }
}

type CachedCatalogFetch = (kind: "series" | "movies", page: number) => Promise<AnimeCatalogResponse>;
type CachedSearchFetch = (query: string, page: number) => Promise<AnimeSearchResponse>;
let cachedCatalogApiFetch: CachedCatalogFetch | undefined;
let cachedAnimeSearchFetch: CachedSearchFetch | undefined;
const animeSearchResultCache = new Map<
  string,
  { expiresAt: number; data: AnimeSearchResponse }
>();
const animeSearchInFlight = new Map<string, Promise<AnimeSearchResponse | null>>();

function getCachedAnimeSearchFetch(): CachedSearchFetch {
  if (!cachedAnimeSearchFetch) {
    cachedAnimeSearchFetch = async (query: string, page: number) => {
      const data = await fetchLegacyValidated(
        "search",
        `${normalizeApiSearchQuery(query)}:${page}`,
        `/api/search?s=${encodeURIComponent(query)}&page=${page}`,
        (value): value is AnimeSearchResponse => {
          const candidate = value as AnimeSearchResponse | null;
          return Array.isArray(candidate?.results?.results) && candidate.results.results.length > 0;
        }
      );
      if (!data) throw new Error("Legacy search is disabled or unavailable");
      return data;
    };
  }
  return cachedAnimeSearchFetch;
}

function getCachedCatalogApiFetch(): CachedCatalogFetch {
  if (!cachedCatalogApiFetch) {
    cachedCatalogApiFetch = async (kind: "series" | "movies", page: number) => {
      const data = await fetchLegacyValidated(
        "catalog",
        `${kind}:${page}`,
        `/api/${kind}?page=${page}`,
        (value): value is AnimeCatalogResponse => {
          const candidate = value as AnimeCatalogResponse | null;
          return Array.isArray(candidate?.results?.results) && candidate.results.results.length > 0;
        }
      );
      if (!data) throw new Error("Legacy catalog is disabled or unavailable");
      return data;
    };
  }
  return cachedCatalogApiFetch;
}

async function fetchCachedAnimeSearch(
  query: string,
  page: number
): Promise<AnimeSearchResponse | null> {
  // Keep a bounded process cache and share concurrent misses; Next's persistent
  // cache below stores only validated, nonempty API results.
  const key = `${query}\u0000${page}`;
  const cached = animeSearchResultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) animeSearchResultCache.delete(key);

  const pending = animeSearchInFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const data = await getCachedAnimeSearchFetch()(query, page);

      if (animeSearchResultCache.size >= 200) {
        const oldestKey = animeSearchResultCache.keys().next().value;
        if (oldestKey) animeSearchResultCache.delete(oldestKey);
      }
      animeSearchResultCache.set(key, {
        data,
        expiresAt: Date.now() + SEARCH_CACHE_SECONDS * 1000,
      });
      return data;
    } catch (error) {
      rethrowNextControlFlow(error);
      return null;
    } finally {
      animeSearchInFlight.delete(key);
    }
  })();

  animeSearchInFlight.set(key, request);
  return request;
}

const KNOWN_LANGUAGES: Record<string, LanguageCode> = {
  hindi: "hindi",
  english: "english",
  japanese: "japanese",
  tamil: "tamil",
  telugu: "telugu",
};

export function parseLanguages(langStr?: string): LanguageCode[] {
  if (!langStr) return ["hindi"];
  const list = langStr
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);

  const matched: LanguageCode[] = [];
  for (const l of list) {
    if (KNOWN_LANGUAGES[l]) {
      matched.push(KNOWN_LANGUAGES[l]);
    }
  }
  return matched;
}

export function parseDurationMinutes(durationStr?: string): number {
  if (!durationStr) return 24;
  const match = durationStr.match(/(\d+)\s*min/i);
  if (match) return parseInt(match[1], 10);
  const hourMatch = durationStr.match(/(\d+)\s*h/i);
  if (hourMatch) return parseInt(hourMatch[1], 10) * 60;
  return 24;
}

/**
 * Clean slug helper — normalises any upstream URL form to a bare slug.
 *
 * Handles:
 *   https://animesalt.cx/series/naruto-shippuden/  → naruto-shippuden
 *   https:/animesalt.cx/series/naruto-shippuden/   → naruto-shippuden  (single-slash bug in API)
 *   /series/naruto-shippuden/                      → naruto-shippuden
 *   naruto-shippuden                               → naruto-shippuden
 */
export function cleanAnimeSlug(rawId?: string): string {
  if (!rawId) return "";
  return rawId
    // The homepage feed sometimes omits slashes from Animesalt URLs, e.g.
    // https:animesalt.cxseriesmy-title. Normalize both valid and malformed forms.
    .replace(/^https?:\/*animesalt\.cx\/?(?:series|movies|anime)?\/?/, "")
    // Strip any protocol + optional slashes + domain (handles both https:// and https:/)
    .replace(/^https?:\/*[^/]+\//, "")
    // Strip leading slash + path segment: /series/, /movies/, /anime/
    .replace(/^\/(series|movies|anime)\//, "")
    // Strip leading path segments without slash: series/, movies/, anime/
    .replace(/^(series|movies|anime)\//, "")
    // Strip any remaining leading slashes
    .replace(/^\/+/, "")
    // Strip trailing slashes
    .replace(/\/+$/, "")
    .trim();
}

/**
 * Strips any double-encoding and percent-encodings to produce a plain string slug.
 */
export function normalizeSlug(slug: string): string {
  if (!slug) return "";
  let s = cleanAnimeSlug(slug) || slug;
  try {
    while (s.includes("%")) {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    }
  } catch {}
  return s.trim();
}

/**
 * Converts a raw slug or title into a clean, legible display title.
 * Removes Japanese/Asian brackets (【 】, [ ]), cleans hyphens, decodes percent characters,
 * and capitalizes words cleanly.
 */
export function formatDisplayTitle(titleOrSlug?: string): string {
  if (!titleOrSlug) return "";
  let s = titleOrSlug;
  try {
    while (s.includes("%")) {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    }
  } catch {}
  // Strip Japanese/Asian fullwidth brackets 【 】, [ ], or ( )
  s = s.replace(/[【】\[\]]/g, " ").trim();
  // If slug-like with hyphens, convert to spaces
  if (s.includes("-") && !s.includes(" ")) {
    s = s.replace(/-/g, " ");
  }
  // Remove excess spaces
  s = s.replace(/\s+/g, " ").trim();
  // Capitalize words nicely
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getAnimeBackdrop(_slug: string, fallbackUrl?: string): string {
  // The API does not expose a backdrop field. Reuse its real poster instead of
  // substituting title-specific artwork.
  return fallbackUrl || "";
}

export function isUsableImageUrl(value?: string | null): value is string {
  if (!value || typeof value !== "string") return false;
  const image = value.trim();
  if (!image || image.startsWith("data:") || image.includes("data:image")) return false;
  if (
    image.includes("cropped-AnimeSalticon") ||
    image.includes("AnimeSalticon") ||
    image.includes("favicon") ||
    image.includes("default-avatar") ||
    image.includes("ui-avatars.com")
  ) {
    return false;
  }
  try {
    const url = new URL(image.startsWith("//") ? `https:${image}` : image);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const SYNOPSIS_EMPTY_VALUES = new Set([
  "",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "not found",
  "no synopsis available.",
  "no description available.",
  "no overview available.",
]);

function parsePossiblyJson<T>(value: T | string | null | undefined): T | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return null;
    }
  }
  return value;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** Convert API HTML (or mixed markup) into readable plain text. */
export function stripHtmlToText(value: string): string {
  const withBreaks = value
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*p\s*>/gi, "\n")
    .replace(/<\s*\/\s*div\s*>/gi, "\n")
    .replace(/<\s*\/\s*li\s*>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(withoutTags)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function textFromUnknown(value: unknown, depth = 0): string {
  if (value == null || depth > 4) return "";
  if (typeof value === "string") {
    const parsed = parsePossiblyJson<unknown>(value);
    if (parsed && typeof parsed === "object") {
      return textFromUnknown(parsed, depth + 1);
    }
    return stripHtmlToText(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => textFromUnknown(entry, depth + 1))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of [
      "overview",
      "description",
      "synopsis",
      "plot",
      "story",
      "storyline",
      "about",
      "content",
      "text",
      "html",
    ]) {
      const nested = textFromUnknown(record[key], depth + 1);
      if (nested) return nested;
    }
  }
  return "";
}

function isUsableSynopsis(text: string): boolean {
  if (!text) return false;
  return !SYNOPSIS_EMPTY_VALUES.has(text.toLowerCase());
}

/**
 * Pulls plot text from /api/info and /api/movie payloads.
 * The documented field is `overview`; some responses wrap it in `data`/`results`
 * or Redis-stringified JSON, and the scraper may leave HTML in the string.
 */
export function extractApiSynopsis(data: unknown): string {
  const root = parsePossiblyJson<unknown>(data as string) ?? data;
  const text = textFromUnknown(root);
  return isUsableSynopsis(text) ? text : "";
}

export function getApiSynopsis(data: unknown): string {
  return extractApiSynopsis(data) || SYNOPSIS_FALLBACK;
}

export function resolveAnimeInfoData(
  payload: AnimeInfoResponse | null
): AnimeInfoData | null {
  if (!payload) return null;
  return parsePossiblyJson<AnimeInfoData>(payload.data);
}

export function resolveMovieInfoData(
  payload: MovieInfoResponse | null
): MovieInfoData | null {
  if (!payload) return null;
  return parsePossiblyJson<MovieInfoData>(payload.results ?? null);
}

/**
 * Maps an API search item to the internal Anime model.
 * The search endpoint is the reliable source for title and poster.
 */
export function mapSearchItemToAnime(
  item: AnimeSearchResult,
  requestedType?: Anime["type"]
): Anime {
  let sourceSection = "";
  try {
    sourceSection = new URL(item.anime_id).pathname.split("/").filter(Boolean)[0] || "";
  } catch {
    sourceSection = "";
  }
  const type = requestedType || (sourceSection === "movies" ? "Movie" : "TV");
  const cleanSlug =
    cleanAnimeSlug(item.anime_id) ||
    item.title.toLowerCase().replace(/\s+/g, "-");
  const mock = getAnimeBySlug(cleanSlug);

  // poster may be null from API — only use if it's a real http URL
  const poster = mock?.isMock
    ? MOCK_ARTWORK_URL
    : isUsableImageUrl(item.poster)
    ? item.poster
    : "";

  const backdrop = mock?.isMock
    ? MOCK_ARTWORK_URL
    : getAnimeBackdrop(cleanSlug, poster || undefined);
  const genres = mock?.genres && mock.genres.length > 0 ? [...mock.genres] : [];

  const rawTitleLower = (item.title || "").toLowerCase();
  const slugLower = cleanSlug.toLowerCase();
  const detectedLanguages: LanguageCode[] = [];

  if (rawTitleLower.includes("tamil") || slugLower.includes("tamil")) detectedLanguages.push("tamil");
  if (rawTitleLower.includes("telugu") || slugLower.includes("telugu")) detectedLanguages.push("telugu");
  if (rawTitleLower.includes("hindi") || slugLower.includes("hindi")) detectedLanguages.push("hindi");

  if (mock?.languages && mock.languages.length > 0) {
    for (const l of mock.languages) {
      if (!detectedLanguages.includes(l)) detectedLanguages.push(l);
    }
  }

  // Fallback to Hindi — the primary language of all anime on Hindi Anime
  if (detectedLanguages.length === 0) {
    detectedLanguages.push("hindi");
  }

  const KNOWN_GENRE_KEYWORDS = [
    "action", "adventure", "fantasy", "romance", "comedy", "horror",
    "thriller", "sports", "mystery", "sci-fi", "isekai", "slice-of-life",
    "psychological", "supernatural", "drama", "shounen", "school",
  ];
  if (genres.length === 0) {
    for (const gk of KNOWN_GENRE_KEYWORDS) {
      if (rawTitleLower.includes(gk) || slugLower.includes(gk)) {
        genres.push(gk);
      }
    }
  }

  return {
    id: cleanSlug,
    slug: cleanSlug,
    title: item.title || cleanSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    synopsis: mock?.synopsis || SYNOPSIS_FALLBACK,
    poster,
    backdrop: mock?.isMock ? MOCK_ARTWORK_URL : backdrop,
    rating: mock?.rating || 0,
    year: mock?.year || 0,
    type,
    status: type === "Movie" ? "Completed" : "Ongoing",
    durationMinutes: mock?.durationMinutes || 0,
    episodeCount: mock?.episodeCount || 0,
    genres,
    languages: detectedLanguages,
    country: mock?.country,
    seasons: mock?.seasons || 0,
    studio: mock?.studio || "",
    updatedAt: mock?.updatedAt || "",
    ...(mock?.isMock ? { isMock: true } : {}),
  };
}

function normalizeCatalogTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Keeps the existing browse-page taxonomy and filters, but replaces a mock
 * poster identifier only when the same title is present in the real API
 * catalog with a usable poster URL. Items absent from the live catalog retain
 * no poster: browse pages can exclude unsupported mock-only records rather
 * than displaying a broken or invented image.
 */
export function applyCatalogPosters(items: Anime[], catalog: Anime[]): Anime[] {
  const bySlug = new Map<string, Anime>();
  const byTitle = new Map<string, Anime>();

  for (const catalogItem of catalog) {
    if (!isUsableImageUrl(catalogItem.poster)) continue;
    bySlug.set(catalogItem.slug, catalogItem);
    byTitle.set(normalizeCatalogTitle(catalogItem.title), catalogItem);
  }

  return items.map((item) => {
    if (item.isMock) {
      return { ...item, poster: MOCK_ARTWORK_URL, backdrop: MOCK_ARTWORK_URL };
    }

    const source =
      bySlug.get(item.slug) ?? byTitle.get(normalizeCatalogTitle(item.title));

    if (!source) {
      return { ...item, poster: "", backdrop: "" };
    }

    return {
      ...item,
      poster: source.poster,
      backdrop: source.backdrop || source.poster,
    };
  });
}

export function getCatalogPosterItems(items: Anime[], catalog: Anime[]): Anime[] {
  return applyCatalogPosters(items, catalog).filter((item) =>
    item.isMock || isUsableImageUrl(item.poster)
  );
}

export function getHomepagePosterCatalog(data: HomepageData): Anime[] {
  return uniqueBySlug([
    ...data.heroItems,
    ...data.trendingItems,
    ...data.popularItems,
    ...data.movieItems,
    ...data.seriesItems,
    ...data.upcomingItems,
  ]);
}

/**
 * Maps API info data to the internal Anime model.
 *
 * IMPORTANT: /api/info often returns:
 *   - title: "" (empty — scraper failure)
 *   - language: undefined (field missing)
 *   - poster: "https:data:image/svg+xml;..." (malformed SVG, not usable)
 *   - genres: [] (empty)
 *   - overview: "" (empty)
 *
 * Always pass fallbackPoster and fallbackTitle from /api/search results.
 */
export function mapApiInfoToAnime(
  data: AnimeInfoData,
  fallbackPoster?: string,
  fallbackTitle?: string
): Anime {
  const cleanSlug =
    cleanAnimeSlug(data.anime_id) ||
    (data.title ? data.title.toLowerCase().replace(/\s+/g, "-") : "");

  const parsedRating = parseFloat(data.rating) || 0;
  const parsedYear = parseInt(data.year, 10) || 0;
  const parsedSeasons = parseInt(data.seasons, 10) || 0;
  const parsedEpisodes = parseInt(data.episodes, 10) || 0;
  const parsedDuration = parseDurationMinutes(data.runningTime);

  // language field may be undefined in response — parseLanguages handles undefined
  const languages = parseLanguages(data.language);

  // Title: prefer non-empty API value, then fallback from search, then slug-derived
  const title =
    (data.title && data.title.trim()) ||
    fallbackTitle ||
    cleanSlug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  // Poster: API often returns "https:data:image/svg..." — only use real http URL
  const mock = getAnimeBySlug(cleanSlug);
  const poster = mock?.isMock
    ? MOCK_ARTWORK_URL
    : isUsableImageUrl(data.poster)
    ? data.poster
    : isUsableImageUrl(fallbackPoster)
    ? fallbackPoster
    : "";

  const backdrop = mock?.isMock
    ? MOCK_ARTWORK_URL
    : getAnimeBackdrop(cleanSlug, poster || undefined);

  // Genres: API returns [] when it fails — use action as default
  const genres =
    data.genres && data.genres.length > 0
      ? data.genres.map((g) => g.toLowerCase().replace(/\s+/g, "-"))
      : [];

  const synopsis = getApiSynopsis(data);

  // Quality field ("" or "Movie") — determine type
  const type =
    data.format?.toUpperCase() === "MOVIE" || data.quality?.toUpperCase().includes("MOVIE")
      ? "Movie"
      : "TV";

  return {
    id: cleanSlug,
    slug: cleanSlug,
    title,
    synopsis,
    poster,
    backdrop,
    rating: parsedRating,
    year: parsedYear,
    type,
    status: "Ongoing",
    durationMinutes: data.runningTime ? parsedDuration : 0,
    episodeCount: parsedEpisodes,
    genres,
    languages,
    seasons: parsedSeasons,
    studio: "",
    updatedAt: "",
    ...(mock?.isMock ? { isMock: true } : {}),
  };
}

export function mapMovieInfoToAnime(
  data: MovieInfoData,
  fallbackPoster?: string,
  fallbackTitle?: string
): Anime {
  const slug = cleanAnimeSlug(data.anime_id);
  const title = data.title?.trim() || fallbackTitle || slug.replace(/-/g, " ");
  const mock = getAnimeBySlug(slug);
  const poster = mock?.isMock
    ? MOCK_ARTWORK_URL
    : isUsableImageUrl(data.poster)
    ? data.poster
    : isUsableImageUrl(fallbackPoster)
    ? fallbackPoster
    : "";

  return {
    id: slug,
    slug,
    title,
    synopsis: getApiSynopsis(data),
    poster,
    backdrop: mock?.isMock ? MOCK_ARTWORK_URL : getAnimeBackdrop(slug, poster || undefined),
    rating: Number(data.rating) || 0,
    year: Number(data.year) || 0,
    type: "Movie",
    status: "Completed",
    durationMinutes: parseDurationMinutes(data.run_time || data.runningTime),
    episodeCount: 1,
    genres: data.genres?.map((genre) => genre.toLowerCase().replace(/\s+/g, "-")) || [],
    languages: parseLanguages(data.languages?.join(",")),
    seasons: 1,
    studio: "",
    updatedAt: "",
    ...(mock?.isMock ? { isMock: true } : {}),
  };
}

/**
 * Maps API episode item to the internal Episode model.
 *
 * CRITICAL: The upstream API does NOT have an `episode` field.
 * The `season` field in each episode object actually contains the EPISODE number.
 * Example: { title: "Homecoming", season: "1", image: "..." } = Season 1, Episode 1
 *          { title: "...",         season: "2", image: "..." } = Season 1, Episode 2
 *
 * The real season number comes from the ?season= query param (seasonOverride).
 */
export function mapApiEpisodeToEpisode(
  item: EpisodeItem,
  animeSlug: string,
  animeTitle: string,
  animePoster: string,
  languages: LanguageCode[] = ["hindi", "japanese"],
  seasonOverride: number = 1,
  arrayIndex: number = 0
): Episode {
  const mock = getAnimeBySlug(animeSlug);
  if (mock?.isMock) animePoster = MOCK_ARTWORK_URL;
  // item.episode does not exist in the real API — item.season is the episode number
  // If parsed number is 0 or NaN, fall back to 1-based array index
  const parsedNum = parseInt(item.episode || item.season, 10);
  const epNum = isNaN(parsedNum) || parsedNum < 1 ? arrayIndex + 1 : parsedNum;
  const seasonNum = seasonOverride;
  // Use arrayIndex as tie-breaker to guarantee globally unique IDs across the list
  const episodeId = `ep-${seasonNum}-${epNum}`;

  // Use the episode image if it's a real URL, otherwise fall back to animePoster
  const thumbnail =
    mock?.isMock
      ? MOCK_ARTWORK_URL
      : isUsableImageUrl(item.image)
      ? item.image
      : animePoster;

  return {
    id: episodeId,
    animeSlug,
    animeTitle,
    animePoster,
    season: seasonNum,
    number: epNum,
    title: item.title || `Episode ${epNum}`,
    thumbnail,
    durationMinutes: 24,
    languages,
    releasedAt: "",
    ...(mock?.isMock ? { isMock: true } : {}),
  };
}

export const DEFAULT_SCRAPER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://animesalt.cx/",
};

export const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

// ─── Direct Catalog Scraper for /series/ and /movies/ ───────────────────────

interface CatalogPageResult {
  results: AnimeSearchResult[];
  totalPages: number;
  currentPage: number;
}

export interface GlobalAnimeSearchResponse {
  results: { item: Anime; score: number }[];
  totalPages: number;
}

const GLOBAL_SEARCH_PAGE_SIZE = 12;

const catalogPageCache = new Map<string, { data: CatalogPageResult; timestamp: number }>();

export function parseAnimeSaltArticles(
  html: string,
  page: number,
  pagination?: { totalPages?: number; pageSize?: number }
): CatalogPageResult | null {
  if (/<rss\b/i.test(html)) {
    const decodeFeedText = (value: string) =>
      decodeHtmlEntities(value).replace(/&#(x[\da-f]+|\d+);/gi, (entity, code: string) => {
        const point = code[0].toLowerCase() === "x"
          ? Number.parseInt(code.slice(1), 16)
          : Number.parseInt(code, 10);
        return Number.isSafeInteger(point) && point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      });
    const results: AnimeSearchResult[] = [];
    const items = html.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi);
    for (const item of items) {
      const itemHtml = item[1];
      const rawTitle = itemHtml.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1] || "";
      const rawLink = itemHtml.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i)?.[1] || "";
      const title = decodeFeedText(rawTitle.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
      const link = decodeFeedText(rawLink.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
      const slug = cleanAnimeSlug(link);
      if (!title || !slug || !/^https?:\/\//i.test(link)) continue;
      results.push({ title, anime_id: link, poster: null });
    }

    if (results.length === 0) return null;
    const reportedTotalPages = pagination?.totalPages;
    const reportedPageSize = pagination?.pageSize;
    const totalPages = Number.isSafeInteger(reportedTotalPages) && reportedTotalPages! > 0
      ? reportedTotalPages!
      : Number.isSafeInteger(reportedPageSize) && reportedPageSize! > 0 && results.length < reportedPageSize!
        ? page
        : page + 1;
    return { results, totalPages, currentPage: page };
  }

  const results: AnimeSearchResult[] = [];
  const artRegex = /<article[^>]*class=["'][^"']*post[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;

  while ((match = artRegex.exec(html)) !== null) {
    const artHtml = match[1];
    const link = artHtml.match(/href=["']([^"']+)["']/)?.[1] || "";
    if (!link) continue;

    const slug = cleanAnimeSlug(link);
    if (!slug) continue;

    const posterMatch =
      artHtml.match(/data-src=["']([^"']+)["']/) ||
      artHtml.match(/src=["'](https?:[^"']+\.(?:jpg|png|webp)[^"']*?)["']/i);
    let poster: string | null = posterMatch ? posterMatch[1] : null;
    if (poster?.startsWith("//")) poster = "https:" + poster;
    if (poster?.startsWith("data:")) poster = null;

    const rawTitle =
      artHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ||
      artHtml.match(/alt=["']([^"']+)["']/)?.[1]?.trim() ||
      slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

    results.push({
      title: decodeHtmlEntities(rawTitle),
      anime_id: link,
      poster,
    });
  }

  if (results.length === 0) return null;

  const pageNums = [...html.matchAll(/\/page\/(\d+)\//g)].map((m) => parseInt(m[1], 10));
  const totalPages = pageNums.length > 0 ? Math.max(...pageNums) : page;

  return { results, totalPages, currentPage: page };
}

/**
 * Scrapes animesalt.cx/series/ or /movies/ catalog pages directly.
 * Each page returns 12 items. Series has ~38 pages (2,543 total), movies ~23 pages (2,531 total).
 */
async function scrapeAnimeSaltCatalogUncached(
  kind: "series" | "movies",
  page = 1
): Promise<CatalogPageResult | null> {
  const cacheKey = `${kind}:${page}`;
  const cached = catalogPageCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url =
      page <= 1
        ? `https://animesalt.cx/${kind}/`
        : `https://animesalt.cx/${kind}/page/${page}/`;

    let html: string | null = null;
    let pagination: { totalPages?: number; pageSize?: number } | undefined;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(buildServerWorkerCatalogUrl(kind, page), {
          headers: getServerWorkerHeaders(DEFAULT_SCRAPER_HEADERS),
          signal: controller.signal,
        });
        const contentType = response.headers.get("content-type")?.toLowerCase() || "";
        if (response.ok && /(?:text\/html|application\/(?:rss\+xml|xml)|text\/xml)/.test(contentType)) {
          const candidate = await response.text();
          if (!is404Html(candidate) && (/<rss\b/i.test(candidate) || /<article\b/i.test(candidate))) {
            html = candidate;
          }
          if (html) {
            const totalPagesHeader = Number(response.headers.get("x-catalog-total-pages"));
            const pageSizeHeader = Number(response.headers.get("x-catalog-page-size"));
            pagination = {
              totalPages: Number.isSafeInteger(totalPagesHeader) && totalPagesHeader > 0 ? totalPagesHeader : undefined,
              pageSize: Number.isSafeInteger(pageSizeHeader) && pageSizeHeader > 0 ? pageSizeHeader : undefined,
            };
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Preserve the existing general-proxy/direct fallback if the restricted route is unavailable.
    }

    if (!html) html = await fetchHtmlWithWorkerFallback(url);
    if (!html) return null;
    const result = parseAnimeSaltArticles(html, page, pagination);
    if (result) {
      catalogPageCache.set(cacheKey, { data: result, timestamp: Date.now() });
    }
    return result;
  } catch (err) {
    rethrowNextControlFlow(err);
    console.error(`[Scraper] Error scraping ${kind} catalog page ${page}:`, err);
    return null;
  }
}

export function scrapeAnimeSaltCatalog(
  kind: "series" | "movies",
  page = 1
): Promise<CatalogPageResult | null> {
  return cacheValidatedScraperResult(
    ["catalog", kind, String(page)],
    21600,
    () => scrapeAnimeSaltCatalogUncached(kind, page),
    (result): result is CatalogPageResult => Boolean(result?.results.length)
  );
}

/**
 * Scrapes animesalt.cx search results directly. Searches full database of 2,500+ anime.
 */
async function scrapeAnimeSaltSearchUncached(
  keyword: string,
  page = 1
): Promise<CatalogPageResult | null> {
  const cleanKeyword = keyword.trim();
  if (!cleanKeyword) return null;
  const cacheKey = `search:${cleanKeyword}:${page}`;
  const cached = catalogPageCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url =
      page <= 1
        ? `https://animesalt.cx/?s=${encodeURIComponent(cleanKeyword)}`
        : `https://animesalt.cx/page/${page}/?s=${encodeURIComponent(cleanKeyword)}`;

    const html = await fetchHtmlWithWorkerFallback(url);
    if (!html) return null;
    const result = parseAnimeSaltArticles(html, page);
    if (result) {
      catalogPageCache.set(cacheKey, { data: result, timestamp: Date.now() });
    }
    return result;
  } catch (err) {
    rethrowNextControlFlow(err);
    console.error(`[Scraper] Error searching AnimeSalt for "${cleanKeyword}":`, err);
    return null;
  }
}

export function scrapeAnimeSaltSearch(
  keyword: string,
  page = 1
): Promise<CatalogPageResult | null> {
  const cleanKeyword = normalizeApiSearchQuery(keyword);
  if (!cleanKeyword) return Promise.resolve(null);
  return cacheValidatedScraperResult(
    ["search", cleanKeyword, String(page)],
    21600,
    () => scrapeAnimeSaltSearchUncached(cleanKeyword, page),
    (result): result is CatalogPageResult => Boolean(result?.results.length)
  );
}

/**
 * Scrapes animesalt.cx/category/genre/[slug]/ directly across the full anime library.
 */
async function scrapeAnimeSaltGenreUncached(
  genreSlug: string,
  page = 1
): Promise<CatalogPageResult | null> {
  const cleanGenre = genreSlug.toLowerCase().trim();
  if (!cleanGenre) return null;
  const cacheKey = `genre:${cleanGenre}:${page}`;
  const cached = catalogPageCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url =
      page <= 1
        ? `https://animesalt.cx/category/${cleanGenre}/`
        : `https://animesalt.cx/category/${cleanGenre}/page/${page}/`;

    const html = await fetchHtmlWithWorkerFallback(url);
    if (!html) return null;
    const result = parseAnimeSaltArticles(html, page);
    if (result) {
      catalogPageCache.set(cacheKey, { data: result, timestamp: Date.now() });
    }
    return result;
  } catch (err) {
    rethrowNextControlFlow(err);
    console.error(`[Scraper] Error scraping genre "${cleanGenre}" page ${page}:`, err);
    return null;
  }
}

export function scrapeAnimeSaltGenre(
  genreSlug: string,
  page = 1
): Promise<CatalogPageResult | null> {
  const cleanGenre = genreSlug.toLowerCase().trim();
  if (!cleanGenre) return Promise.resolve(null);
  return cacheValidatedScraperResult(
    ["genre", cleanGenre, String(page)],
    21600,
    () => scrapeAnimeSaltGenreUncached(cleanGenre, page),
    (result): result is CatalogPageResult => Boolean(result?.results.length)
  );
}

/**
 * Scrapes animesalt.cx/category/[language]/ directly across the full anime library.
 */
async function scrapeAnimeSaltLanguageUncached(
  languageCode: string,
  page = 1
): Promise<CatalogPageResult | null> {
  const cleanLang = languageCode.toLowerCase().trim();
  if (!cleanLang) return null;
  const cacheKey = `language:${cleanLang}:${page}`;
  const cached = catalogPageCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url =
      page <= 1
        ? `https://animesalt.cx/category/${cleanLang}/`
        : `https://animesalt.cx/category/${cleanLang}/page/${page}/`;

    const html = await fetchHtmlWithWorkerFallback(url);
    if (!html) return null;
    const result = parseAnimeSaltArticles(html, page);
    if (result) {
      catalogPageCache.set(cacheKey, { data: result, timestamp: Date.now() });
    }
    return result;
  } catch (err) {
    rethrowNextControlFlow(err);
    console.error(`[Scraper] Error scraping language "${cleanLang}" page ${page}:`, err);
    return null;
  }
}

export function scrapeAnimeSaltLanguage(
  languageCode: string,
  page = 1
): Promise<CatalogPageResult | null> {
  const cleanLang = languageCode.toLowerCase().trim();
  if (!cleanLang) return Promise.resolve(null);
  return cacheValidatedScraperResult(
    ["language", cleanLang, String(page)],
    21600,
    () => scrapeAnimeSaltLanguageUncached(cleanLang, page),
    (result): result is CatalogPageResult => Boolean(result?.results.length)
  );
}

/**
 * Scrapes animesalt.cx/category/type/cartoon/?type=series or ?type=movies directly.
 * Contains Western/USA animated series and movies.
 */
async function scrapeAnimeSaltCartoonUncached(
  kind: "series" | "movies",
  page = 1
): Promise<CatalogPageResult | null> {
  const cacheKey = `cartoon:${kind}:${page}`;
  const cached = catalogPageCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url =
      page <= 1
        ? `https://animesalt.cx/category/type/cartoon/?type=${kind}`
        : `https://animesalt.cx/category/type/cartoon/page/${page}/?type=${kind}`;

    const html = await fetchHtmlWithWorkerFallback(url);
    if (!html) return null;
    const result = parseAnimeSaltArticles(html, page);
    if (result) {
      catalogPageCache.set(cacheKey, { data: result, timestamp: Date.now() });
    }
    return result;
  } catch (err) {
    rethrowNextControlFlow(err);
    console.error(`[Scraper] Error scraping cartoon ${kind} page ${page}:`, err);
    return null;
  }
}

export function scrapeAnimeSaltCartoon(
  kind: "series" | "movies",
  page = 1
): Promise<CatalogPageResult | null> {
  return cacheValidatedScraperResult(
    ["cartoon", kind, String(page)],
    21600,
    () => scrapeAnimeSaltCartoonUncached(kind, page),
    (result): result is CatalogPageResult => Boolean(result?.results.length)
  );
}


export async function getGenreCatalog(
  genreSlug: string,
  page = 1
): Promise<{ results: Anime[]; totalPages: number }> {
  const cleanSlug = genreSlug.toLowerCase().trim();
  try {
    const res = await scrapeAnimeSaltGenre(cleanSlug, page);
    if (res && res.results.length > 0) {
      const items = res.results.map((item) => {
        const mapped = mapSearchItemToAnime(item);
        if (!mapped.genres.includes(cleanSlug)) {
          mapped.genres.push(cleanSlug);
        }
        return mapped;
      });
      return {
        results: items,
        totalPages: res.totalPages,
      };
    }
  } catch (err) {
    rethrowNextControlFlow(err);
    console.error(`getGenreCatalog error for ${cleanSlug}:`, err);
  }

  // Fallback to mock + homepage data
  const PAGE_SIZE = 12;
  const mockMatches = getAnimeByGenre(cleanSlug);
  const homepageData = await getHomepageData();
  const fallbackItems = getCatalogPosterItems(mockMatches, getHomepagePosterCatalog(homepageData));
  const totalPages = Math.max(1, Math.ceil(fallbackItems.length / PAGE_SIZE));
  const paged = fallbackItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return {
    results: paged,
    totalPages,
  };
}

export async function getLanguageCatalog(
  languageCode: string,
  page = 1
): Promise<{ results: Anime[]; totalPages: number }> {
  const cleanCode = languageCode.toLowerCase().trim();
  try {
    const res = await scrapeAnimeSaltLanguage(cleanCode, page);
    if (res && res.results.length > 0) {
      const items = res.results.map((item) => {
        const mapped = mapSearchItemToAnime(item);
        if (!mapped.languages.includes(cleanCode as never)) {
          mapped.languages.push(cleanCode as never);
        }
        return mapped;
      });
      return {
        results: items,
        totalPages: res.totalPages,
      };
    }
  } catch (err) {
    console.error(`getLanguageCatalog error for ${cleanCode}:`, err);
  }

  // Fallback to mock + homepage data
  const PAGE_SIZE = 12;
  const mockMatches = getAnimeByLanguage(cleanCode);
  const homepageData = await getHomepageData();
  const fallbackItems = getCatalogPosterItems(mockMatches, getHomepagePosterCatalog(homepageData));
  const totalPages = Math.max(1, Math.ceil(fallbackItems.length / PAGE_SIZE));
  const paged = fallbackItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return {
    results: paged,
    totalPages,
  };
}

export async function getCountryCatalog(
  countryCode: string,
  page = 1,
  type?: string
): Promise<{ results: Anime[]; totalPages: number }> {
  const cleanCode = countryCode.toLowerCase().trim();
  const PAGE_SIZE = 12;

  // 1. Japan = fetch the main series/movies catalog and ensure items match Japan
  if (cleanCode === "japan") {
    try {
      const kind = type === "Movie" ? "movies" : "series";
      const pagesToFetch = [page, page + 1].slice(0, 2);
      const fetchedPages = await Promise.all(
        pagesToFetch.map((p) => getCatalog(kind, p).catch(() => null))
      );

      const liveItems: Anime[] = [];
      const seenSlugs = new Set<string>();
      let maxTotalPages = 1;

      for (const res of fetchedPages) {
        const rawList = res?.results?.results ?? [];
        maxTotalPages = Math.max(maxTotalPages, res?.results?.totalPages ?? 1);
        for (const raw of rawList) {
          const mapped = mapSearchItemToAnime(raw, type === "Movie" ? "Movie" : "TV");
          if (!seenSlugs.has(mapped.slug) && matchesCountry(mapped, "japan") && isUsableImageUrl(mapped.poster)) {
            mapped.country = "japan";
            seenSlugs.add(mapped.slug);
            liveItems.push(mapped);
          }
        }
      }

      if (liveItems.length > 0) {
        const totalPages = Math.max(1, Math.ceil(liveItems.length / PAGE_SIZE));
        const paged = liveItems.slice(0, PAGE_SIZE);
        return { results: paged, totalPages: Math.max(totalPages, maxTotalPages) };
      }
    } catch (err) {
      console.error(`getCountryCatalog[japan] error:`, err);
    }
  }

  // 2. United States (USA) = scrape cartoon series, cartoon movies, and US films from movies catalog
  if (cleanCode === "usa" || cleanCode === "united-states") {
    try {
      const fetchSeries = !type || type === "TV";
      const fetchMovies = !type || type === "Movie";

      const [seriesRes, moviesRes, generalMoviesRes] = await Promise.all([
        fetchSeries ? scrapeAnimeSaltCartoon("series", page).catch(() => null) : Promise.resolve(null),
        fetchMovies ? scrapeAnimeSaltCartoon("movies", page).catch(() => null) : Promise.resolve(null),
        fetchMovies ? scrapeAnimeSaltCatalog("movies", page).catch(() => null) : Promise.resolve(null),
      ]);

      const seenSlugs = new Set<string>();
      const seriesList: Anime[] = [];
      const movieList: Anime[] = [];

      // 2a. Cartoon Series
      if (fetchSeries && seriesRes?.results) {
        for (const raw of seriesRes.results) {
          const mapped = mapSearchItemToAnime(raw, "TV");
          mapped.country = "usa";
          if (!seenSlugs.has(mapped.slug) && isUsableImageUrl(mapped.poster)) {
            seenSlugs.add(mapped.slug);
            seriesList.push(mapped);
          }
        }
      }

      // 2b. Cartoon Movies
      if (fetchMovies && moviesRes?.results) {
        for (const raw of moviesRes.results) {
          const mapped = mapSearchItemToAnime(raw, "Movie");
          mapped.country = "usa";
          if (!seenSlugs.has(mapped.slug) && isUsableImageUrl(mapped.poster)) {
            seenSlugs.add(mapped.slug);
            movieList.push(mapped);
          }
        }
      }

      // 2c. General Movies that are US productions (How to Train Your Dragon, The Bad Guys, Lilo & Stitch, Elio, Sinbad, etc.)
      if (fetchMovies && generalMoviesRes?.results) {
        for (const raw of generalMoviesRes.results) {
          const mapped = mapSearchItemToAnime(raw, "Movie");
          if (matchesCountry(mapped, "usa")) {
            mapped.country = "usa";
            if (!seenSlugs.has(mapped.slug) && isUsableImageUrl(mapped.poster)) {
              seenSlugs.add(mapped.slug);
              movieList.push(mapped);
            }
          }
        }
      }

      // Assemble results based on type filter
      let usaItems: Anime[] = [];
      if (type === "Movie") {
        usaItems = movieList;
      } else if (type === "TV") {
        usaItems = seriesList;
      } else {
        // Interleave series and movies so user gets a rich mix of both
        const maxLen = Math.max(seriesList.length, movieList.length);
        for (let i = 0; i < maxLen; i++) {
          if (i < seriesList.length) usaItems.push(seriesList[i]);
          if (i < movieList.length) usaItems.push(movieList[i]);
        }
      }

      // 2d. Supplement with top USA searches if catalog has room on initial pages
      if (usaItems.length < PAGE_SIZE) {
        const topUsaQueries = [
          "how to train your dragon", "arcane", "castlevania", "ben 10",
          "batman", "the bad guys", "invincible", "blood of zeus", "dragon prince"
        ];
        const searchResps = await Promise.all(
          topUsaQueries.map((q) => searchAnime(q, 1).catch(() => null))
        );
        for (const resp of searchResps) {
          for (const raw of resp?.results?.results ?? []) {
            const mapped = mapSearchItemToAnime(raw);
            if (matchesCountry(mapped, "usa")) {
              if (type && mapped.type !== type) continue;
              mapped.country = "usa";
              if (!seenSlugs.has(mapped.slug) && isUsableImageUrl(mapped.poster)) {
                seenSlugs.add(mapped.slug);
                usaItems.push(mapped);
              }
            }
          }
        }
      }

      // 2e. Local mock matches
      const mockUsa = getAnimeByCountry("usa");
      for (const mock of mockUsa) {
        if (type && mock.type !== type) continue;
        if (!seenSlugs.has(mock.slug) && isUsableImageUrl(mock.poster)) {
          seenSlugs.add(mock.slug);
          usaItems.push(mock);
        }
      }

      if (usaItems.length > 0) {
        const totalPages = Math.max(
          seriesRes?.totalPages ?? 1,
          moviesRes?.totalPages ?? 1,
          generalMoviesRes?.totalPages ?? 1,
          Math.ceil(usaItems.length / PAGE_SIZE)
        );
        return {
          results: usaItems.slice(0, PAGE_SIZE),
          totalPages,
        };
      }
    } catch (err) {
      console.error("getCountryCatalog[usa] error:", err);
    }
  }

  // 3. China (Donghua) = fetch Chinese Donghua series, movies, and franchises
  if (cleanCode === "china") {
    try {
      const chinaQueries = [
        "immortal", "lord of mysteries", "heaven official",
        "monkey king", "to be hero", "donghua", "link click",
        "cultivation", "soul land"
      ];

      const seenSlugs = new Set<string>();
      const chinaItems: Anime[] = [];

      // 3a. Search responses for all known Chinese Donghua franchises
      const searchResps = await Promise.all(
        chinaQueries.map((q) => searchAnime(q, 1).catch(() => null))
      );

      for (const resp of searchResps) {
        for (const raw of resp?.results?.results ?? []) {
          const mapped = mapSearchItemToAnime(raw);
          if (matchesCountry(mapped, "china")) {
            if (type && mapped.type !== type) continue;
            mapped.country = "china";
            if (!seenSlugs.has(mapped.slug) && isUsableImageUrl(mapped.poster)) {
              seenSlugs.add(mapped.slug);
              chinaItems.push(mapped);
            }
          }
        }
      }

      // 3b. Also check live catalog pages for any additional Chinese Donghua
      const [seriesCat, moviesCat] = await Promise.all([
        (!type || type === "TV") ? scrapeAnimeSaltCatalog("series", page).catch(() => null) : Promise.resolve(null),
        (!type || type === "Movie") ? scrapeAnimeSaltCatalog("movies", page).catch(() => null) : Promise.resolve(null),
      ]);

      for (const raw of seriesCat?.results ?? []) {
        const mapped = mapSearchItemToAnime(raw, "TV");
        if (matchesCountry(mapped, "china")) {
          mapped.country = "china";
          if (!seenSlugs.has(mapped.slug) && isUsableImageUrl(mapped.poster)) {
            seenSlugs.add(mapped.slug);
            chinaItems.push(mapped);
          }
        }
      }

      for (const raw of moviesCat?.results ?? []) {
        const mapped = mapSearchItemToAnime(raw, "Movie");
        if (matchesCountry(mapped, "china")) {
          mapped.country = "china";
          if (!seenSlugs.has(mapped.slug) && isUsableImageUrl(mapped.poster)) {
            seenSlugs.add(mapped.slug);
            chinaItems.push(mapped);
          }
        }
      }

      // 3c. Local mock items matching China
      const mockChina = getAnimeByCountry("china");
      for (const mock of mockChina) {
        if (type && mock.type !== type) continue;
        if (!seenSlugs.has(mock.slug) && isUsableImageUrl(mock.poster)) {
          seenSlugs.add(mock.slug);
          chinaItems.push(mock);
        }
      }

      if (chinaItems.length > 0) {
        const totalPages = Math.max(1, Math.ceil(chinaItems.length / PAGE_SIZE));
        const paged = chinaItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        return {
          results: paged,
          totalPages,
        };
      }
    } catch (err) {
      console.error("getCountryCatalog[china] error:", err);
    }
  }

  // 4. For other non-Japan countries (Korea, India) use targeted searches + movie catalog filtering
  const countryQueries: Record<string, string[]> = {
    korea: [
      "solo leveling", "tower of god", "lookism", "the god of high school",
      "noblesse", "sweet home", "viral hit", "dr stone", "black clover",
    ],
    india: [
      "chhota bheem", "motu patlu", "roll no 21", "little singham",
      "legend of hanuman", "mighty raju", "baahubali", "krishna",
    ],
  };


  const queries = countryQueries[cleanCode] || [cleanCode];
  const liveResults: Anime[] = [];
  const seenSlugs = new Set<string>();

  try {
    const [searchResponses, moviesCatalogRes] = await Promise.all([
      Promise.all(queries.map((q) => searchAnime(q, 1).catch(() => null))),
      scrapeAnimeSaltCatalog("movies", page).catch(() => null),
    ]);

    for (const resp of searchResponses) {
      for (const raw of resp?.results?.results ?? []) {
        const mapped = mapSearchItemToAnime(raw);
        if (!seenSlugs.has(mapped.slug) && matchesCountry(mapped, cleanCode) && isUsableImageUrl(mapped.poster)) {
          mapped.country = cleanCode;
          seenSlugs.add(mapped.slug);
          liveResults.push(mapped);
        }
      }
    }

    // Also pick up country movies from the movies catalog (e.g. Indian animation films)
    for (const raw of moviesCatalogRes?.results ?? []) {
      const mapped = mapSearchItemToAnime(raw, "Movie");
      if (!seenSlugs.has(mapped.slug) && matchesCountry(mapped, cleanCode) && isUsableImageUrl(mapped.poster)) {
        mapped.country = cleanCode;
        seenSlugs.add(mapped.slug);
        liveResults.push(mapped);
      }
    }
  } catch (err) {
    console.error(`getCountryCatalog search error for ${cleanCode}:`, err);
  }

  // 4. Also include mock anime that match this country
  try {
    const mockMatches = getAnimeByCountry(cleanCode);
    const homepageData = await getHomepageData().catch(() => null);
    const posterCatalog: Anime[] = homepageData ? getHomepagePosterCatalog(homepageData) : [];
    const fallbackItems = posterCatalog.length > 0
      ? getCatalogPosterItems(mockMatches, posterCatalog)
      : mockMatches.filter((a) => isUsableImageUrl(a.poster));

    for (const item of fallbackItems) {
      if (!seenSlugs.has(item.slug)) {
        seenSlugs.add(item.slug);
        liveResults.push(item);
      }
    }
  } catch (err) {
    console.error(`getCountryCatalog mock error for ${cleanCode}:`, err);
  }

  if (liveResults.length > 0) {
    const totalPages = Math.max(1, Math.ceil(liveResults.length / PAGE_SIZE));
    const paged = liveResults.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    return { results: paged, totalPages };
  }

  // 5. Final fallback: fetch the series catalog and filter if possible
  try {
    const seriesRes = await getCatalog("series", page);

    const items = (seriesRes?.results?.results ?? [])
      .map((item) => mapSearchItemToAnime(item, "TV"))
      .filter((item) => isUsableImageUrl(item.poster));

    if (items.length > 0) {
      return {
        results: items,
        totalPages: seriesRes?.results?.totalPages ?? 1,
      };
    }
  } catch (err) {
    console.error(`getCountryCatalog catalog fallback error for ${cleanCode}:`, err);
  }

  return { results: [], totalPages: 1 };
}

export async function getCatalog(
  kind: "series" | "movies",
  page = 1,
  options: { allowHomepageFallback?: boolean; signal?: AbortSignal } = {}
): Promise<AnimeCatalogResponse | null> {
  // AnimeSalt is the primary catalog source. Fetch only the requested page.
  if (typeof window === "undefined" && !options.signal?.aborted) {
    const scraped = await scrapeAnimeSaltCatalog(kind, page);
    if (scraped?.results.length) {
      logDataSource(`${kind}-catalog`, "animesalt-worker-or-direct", "success");
      return {
        success: true,
        results: {
          currentPage: scraped.currentPage,
          totalPages: scraped.totalPages,
          results: scraped.results,
        },
      };
    }
    logDataSource(`${kind}-catalog`, "animesalt-worker-or-direct", "empty");
  }

  // Optional migration fallback. Disabled unless a server-only flag and URL
  // are explicitly configured; never read from browser code.
  if (isLegacyApiEnabled()) {
    try {
      const data = await getCachedCatalogApiFetch()(kind, page);
      if (data) return data;
    } catch (err) {
      rethrowNextControlFlow(err);
      console.error(`getCatalog ${kind} legacy fallback error:`, err);
    }
  }

  // Last resort: the catalog API's own homepage feed (page 1 only, limited set).
  if (page === 1 && options.allowHomepageFallback !== false) {
    try {
      const feed = await getHomepageFeed();
      const sections = feed?.data?.results;
      if (sections) {
        const rawItems =
          kind === "series"
            ? [...sections.mostWatched_Series, ...sections.on_air_series]
            : [...sections.mostWatched_Films, ...sections.latest_animeMovies];

        const seen = new Set<string>();
        const results: AnimeSearchResult[] = [];
        for (const item of rawItems) {
          const slug = cleanAnimeSlug(item.anime_id);
          if (slug && !seen.has(slug)) {
            seen.add(slug);
            results.push({
              title: item.title,
              anime_id: item.anime_id,
              poster: item.poster,
            });
          }
        }

        if (results.length > 0) {
          return {
            success: true,
            results: {
              currentPage: 1,
              totalPages: 1,
              results,
            },
          };
        }
      }
    } catch (fallbackErr) {
      console.error(`getCatalog ${kind} homepage fallback error:`, fallbackErr);
    }
  }

  return null;
}

/**
 * Searches the API first, then AnimeSalt's single search-results page if the
 * API is unavailable or returns no matches. Autocomplete uses its own bounded
 * one-page fallback and does not scan the full catalog.
 */
export async function searchGlobalAnime(
  query: string,
  page = 1
): Promise<GlobalAnimeSearchResponse> {
  const cleanQ = query.trim();
  if (!cleanQ) {
    return { results: [], totalPages: 1 };
  }

  const aliasTerm = COMMON_ACRONYMS[cleanQ.toLowerCase()];

  // 1. Query live search for both query and alias (e.g. jjk -> jujutsu kaisen)
  const [searchResp, aliasResp] = await Promise.all([
    searchAnimeScraperFirst(cleanQ, page),
    aliasTerm && aliasTerm !== cleanQ.toLowerCase()
      ? searchAnimeScraperFirst(aliasTerm, page)
      : Promise.resolve(null),
  ]);

  const rawResults = [
    ...(searchResp?.results ?? []),
    ...(aliasResp?.results ?? []),
  ];

  if (rawResults.length > 0) {
    const seenSlugs = new Set<string>();
    const allAnime: Anime[] = [];

    for (const raw of rawResults) {
      const mapped = mapSearchItemToAnime(raw);
      if (!seenSlugs.has(mapped.slug)) {
        seenSlugs.add(mapped.slug);
        allAnime.push(mapped);
      }
    }

    // Score and rank all live results with fuzzyScore against query and alias
    const scored = allAnime.map((item) => {
      const s1 = fuzzyScore(cleanQ, item.title);
      const s2 = aliasTerm ? fuzzyScore(aliasTerm, item.title) : { score: 0, reasons: [] };
      const sSlug = fuzzyScore(cleanQ, item.slug.replace(/-/g, " "));
      const bestScore = Math.max(s1.score, s2.score, sSlug.score);
      return {
        item,
        score: bestScore > 0 ? bestScore : 0.4,
      };
    });

    // Sort by relevance descending
    scored.sort((a, b) => b.score - a.score);

    const totalPages = Math.max(
      searchResp?.totalPages ?? 1,
      aliasResp?.totalPages ?? 1,
      Math.ceil(scored.length / GLOBAL_SEARCH_PAGE_SIZE)
    );

    return {
      results: scored,
      totalPages,
    };
  }

  // Keep typo/no-match fallback local if both the API and AnimeSalt search fail.
  const ranked = fuzzySearch(cleanQ, anime, 0.4);
  const currentPage = Math.max(1, page);
  const start = (currentPage - 1) * GLOBAL_SEARCH_PAGE_SIZE;

  return {
    results: ranked.slice(start, start + GLOBAL_SEARCH_PAGE_SIZE).map((result) => ({
      item: result.item,
      score: result.score,
    })),
    totalPages: Math.max(1, Math.ceil(ranked.length / GLOBAL_SEARCH_PAGE_SIZE)),
  };
}

type SearchSuggestion = {
  slug: string;
  title: string;
  poster: string;
  year: number;
  type: string;
  languages: LanguageCode[];
  score: number;
};

/** Typeahead uses the search API, with one AnimeSalt results-page fallback on a miss. */
export async function getSearchSuggestions(query: string): Promise<SearchSuggestion[]> {
  const state = getSearchSuggestions as typeof getSearchSuggestions & {
    cache?: Map<string, { results: SearchSuggestion[]; timestamp: number }>;
    inFlight?: Map<string, Promise<SearchSuggestion[]>>;
  };
  const cache = state.cache ?? (state.cache = new Map());
  const inFlight = state.inFlight ?? (state.inFlight = new Map());
  const cleanQuery = query.trim().replace(/\s+/g, " ").slice(0, 100);
  if (cleanQuery.length < 2) return [];

  const cacheKey = cleanQuery.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 15_000) {
    return cached.results;
  }

  return shareInFlightRequest(inFlight, cacheKey, async () => {
    const alias = COMMON_ACRONYMS[cacheKey];
    const queries = alias && alias !== cacheKey ? [cleanQuery, alias] : [cleanQuery];
    const responses = await Promise.all(
      queries.map(async (term) => {
        const response = await searchAnimeScraperFirst(term, 1);
        return response?.results ?? [];
      })
    );
    const seen = new Set<string>();
    const scored: SearchSuggestion[] = [];

    for (const response of responses) {
      for (const raw of response) {
        const item = mapSearchItemToAnime(raw);
        if (!item.slug || seen.has(item.slug)) continue;
        seen.add(item.slug);
        const titleScore = fuzzyScore(cleanQuery, item.title).score;
        const slugScore = fuzzyScore(cleanQuery, item.slug.replace(/-/g, " ")).score;
        scored.push({
          slug: item.slug,
          title: item.title,
          poster: item.poster,
          year: item.year,
          type: item.type,
          languages: item.languages,
          score: Math.max(titleScore, slugScore),
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    let results = scored.slice(0, 8);

    // If both live sources are unavailable, retain useful suggestions from
    // the bundled real-anime catalog without surfacing generated mock entries.
    if (results.length === 0) {
      results = fuzzySearch(cleanQuery, anime.filter((item) => !item.isMock), 0.4)
        .slice(0, 8)
        .map(({ item, score }) => ({
          slug: item.slug,
          title: item.title,
          poster: item.poster,
          year: item.year,
          type: item.type,
          languages: item.languages,
          score,
        }));
    }

    // Keep negative results retryable; only cache actual matches.
    if (results.length > 0) {
      cache.set(cacheKey, { results, timestamp: Date.now() });
    }
    return results;
  });
}

export async function getLatestEpisodes(): Promise<LatestEpisodesResponse | null> {
  // AnimeSalt homepage fresh drops are primary; old endpoints are opt-in only.
  try {
    const feed = await getHomepageFeed();
    const drops = feed?.data?.results?.fresh_drops;
    if (drops && Array.isArray(drops) && drops.length > 0) {
      logDataSource("latest-episodes", "animesalt-homepage", "success");
      return {
        success: true,
        results: drops,
      };
    }
  } catch (err) {
    rethrowNextControlFlow(err);
    console.error("getLatestEpisodes AnimeSalt error:", err);
  }

  const legacy = await fetchLegacyValidated(
    "latest-episodes",
    "newadded",
    "/api/newadded",
    (value): value is LatestEpisodesResponse => {
      const candidate = value as LatestEpisodesResponse | null;
      return Array.isArray(candidate?.results) && candidate.results.length > 0;
    }
  );
  if (legacy) return legacy;

  return null;
}

let homepageFeedCache: { data: HomepageApiResponse; timestamp: number } | null = null;
let homepageFeedInFlight: Promise<HomepageApiResponse | null> | null = null;

type HomepageSectionCounts = {
  freshDrops: number;
  latestAnimeMovies: number;
  mostWatchedFilms: number;
  mostWatchedSeries: number;
  onAirSeries: number;
};

function getHomepageSectionCounts(feed: HomepageApiResponse | null | undefined): HomepageSectionCounts {
  const results = feed?.data?.results;
  const count = (items: unknown) => Array.isArray(items) ? items.length : 0;
  return {
    freshDrops: count(results?.fresh_drops),
    latestAnimeMovies: count(results?.latest_animeMovies),
    mostWatchedFilms: count(results?.mostWatched_Films),
    mostWatchedSeries: count(results?.mostWatched_Series),
    onAirSeries: count(results?.on_air_series),
  };
}

function logHomepageSsr(
  enabled: boolean,
  details: {
    source: string;
    attempt: string;
    outcome: string;
    status?: number | null;
    contentType?: string | null;
    cacheStatus?: string | null;
    responseBytes?: number | null;
    elapsedMs?: number | null;
    errorCategory?: string | null;
    sectionCounts?: HomepageSectionCounts;
    finalCounts?: Record<string, number>;
  }
): void {
  if (!enabled) return;
  console.info(`[homepage-ssr] ${JSON.stringify({
    source: details.source,
    attempt: details.attempt,
    outcome: details.outcome,
    status: details.status ?? null,
    contentType: details.contentType ?? null,
    cacheStatus: details.cacheStatus ?? null,
    responseBytes: details.responseBytes ?? null,
    elapsedMs: details.elapsedMs ?? null,
    errorCategory: details.errorCategory ?? null,
    ...(details.sectionCounts ? { sectionCounts: details.sectionCounts } : {}),
    ...(details.finalCounts ? { finalCounts: details.finalCounts } : {}),
  })}`);
}

function hasHomepageItems(feed: HomepageApiResponse | null | undefined): boolean {
  const sections = feed?.data?.results;
  if (!sections) return false;

  return [
    sections.fresh_drops,
    sections.latest_animeMovies,
    sections.mostWatched_Films,
    sections.mostWatched_Series,
    sections.on_air_series,
  ].some((items) => Array.isArray(items) && items.length > 0);
}

type HomepageFetchDiagnostic = {
  status: number;
  contentType: string | null;
  responseBytes: number;
};

function extractImgSrc(htmlSnippet: string): string | null {
  const m =
    htmlSnippet.match(/data-src=["']([^"']+)["']/) ||
    htmlSnippet.match(/src=["']([^"']+)["']/);
  let src = m ? m[1] : null;
  if (src && src.startsWith("//")) src = "https:" + src;
  return src && !src.startsWith("data:") ? src : null;
}

function extractTitle(htmlSnippet: string, fallbackSlug: string = ""): string {
  const chartTitle = htmlSnippet.match(/<div class="chart-title"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (chartTitle) return decodeHtmlEntities(chartTitle.trim());
  const entryTitle = htmlSnippet.match(/<h2[^>]*class=["']entry-title["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  if (entryTitle) return decodeHtmlEntities(entryTitle.trim());
  const altTitle =
    htmlSnippet.match(/alt="Image\s*([^"]*)"/i)?.[1] ||
    htmlSnippet.match(/alt='Image\s*([^']*)'/i)?.[1];
  if (altTitle) return decodeHtmlEntities(altTitle.trim());
  if (fallbackSlug) {
    return fallbackSlug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return "";
}

function parseHomepageCharts(html: string, sectionName: string): HomepageRankedItem[] {
  const idx = html.indexOf(sectionName);
  if (idx === -1) return [];
  const sectionHtml = html.substring(idx, idx + 40000);
  const endIdx = sectionHtml.indexOf('class="section-title', 50);
  const chunk = endIdx > 0 ? sectionHtml.substring(0, endIdx) : sectionHtml;

  const items: HomepageRankedItem[] = [];
  const itemRegex =
    /<div class="chart-item">([\s\S]*?)(?=<div class="chart-item">|<\/div>\s*<\/div>\s*<\/div>|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(chunk)) !== null) {
    const itemHtml = match[1];
    const rank =
      itemHtml.match(/<div class="chart-number">(\d+)<\/div>/)?.[1] ||
      String(items.length + 1);
    const link = itemHtml.match(/href=["']([^"']+)["']/)?.[1] || "";
    const poster = extractImgSrc(itemHtml);
    const title = extractTitle(itemHtml);
    if (link && poster) {
      items.push({
        rank,
        anime_id: link,
        title: title || "Anime",
        poster,
      });
    }
  }
  return items;
}

function parseHomepageArticles(
  html: string,
  sectionName: string,
  isFreshDrop: boolean = false
): (HomepageFreshDropItem | AnimeListItem)[] {
  const idx = html.indexOf(sectionName);
  if (idx === -1) return [];
  const sectionHtml = html.substring(idx, idx + 40000);
  const endIdx = sectionHtml.indexOf('class="section-title', 50);
  const chunk = endIdx > 0 ? sectionHtml.substring(0, endIdx) : sectionHtml;

  const items: (HomepageFreshDropItem | AnimeListItem)[] = [];
  const artRegex = /<article[^>]*class=["']post[^"']*["']>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;
  while ((match = artRegex.exec(chunk)) !== null) {
    const artHtml = match[1];
    const poster = extractImgSrc(artHtml);
    const link = artHtml.match(/href=["']([^"']+)["']/)?.[1] || "";
    const slug = cleanAnimeSlug(link);
    const title = extractTitle(artHtml, slug);
    const seasonMatch = artHtml
      .match(/<span[^>]*class=["']post-ql["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]
      ?.trim();
    const yearMatch = artHtml
      .match(/<span[^>]*class=["']year["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]
      ?.trim();

    let season = "1";
    if (seasonMatch) {
      const sNum = seasonMatch.match(/\d+/);
      if (sNum) season = sNum[0];
    }
    let episode = "1";
    if (yearMatch) {
      const epNum = yearMatch.match(/EP:\s*(\d+(?:-\d+)?)/i) || yearMatch.match(/\d+/);
      if (epNum) episode = epNum[1] || epNum[0];
    }

    if (link && poster) {
      if (isFreshDrop) {
        items.push({
          anime_id: link,
          title,
          poster,
          season,
          episode,
        } as HomepageFreshDropItem);
      } else {
        items.push({
          anime_id: link,
          title,
          poster,
        } as AnimeListItem);
      }
    }
  }
  return items;
}

export function parseHomepageSourceHtml(
  html: string,
  diagnostics = false,
  fetchDiagnostic?: HomepageFetchDiagnostic
): HomepageApiResponse | null {
  const parseStartedAt = Date.now();
  const mostWatched_Series = parseHomepageCharts(html, "Most-Watched Series");
  const mostWatched_Films = parseHomepageCharts(html, "Most-Watched Films");
  const fresh_drops = parseHomepageArticles(html, "Fresh Drops", true) as HomepageFreshDropItem[];
  const on_air_series = parseHomepageArticles(html, "On-Air Series") as AnimeListItem[];
  const latest_animeMovies = parseHomepageArticles(html, "Latest Anime Movies") as AnimeListItem[];
  const sectionCounts: HomepageSectionCounts = {
    freshDrops: fresh_drops.length,
    latestAnimeMovies: latest_animeMovies.length,
    mostWatchedFilms: mostWatched_Films.length,
    mostWatchedSeries: mostWatched_Series.length,
    onAirSeries: on_air_series.length,
  };

  if (
    mostWatched_Series.length === 0 &&
    mostWatched_Films.length === 0 &&
    fresh_drops.length === 0
  ) {
    logHomepageSsr(diagnostics, {
      source: "animesalt-homepage",
      attempt: "parse",
      outcome: "parse-failure",
      ...fetchDiagnostic,
      elapsedMs: Date.now() - parseStartedAt,
      errorCategory: "no-recognized-homepage-sections",
      sectionCounts,
    });
    return null;
  }

  logHomepageSsr(diagnostics, {
    source: "animesalt-homepage",
    attempt: "parse",
    outcome: "success",
    ...fetchDiagnostic,
    elapsedMs: Date.now() - parseStartedAt,
    sectionCounts,
  });

  return {
    success: true,
    data: {
      success: true,
      results: { mostWatched_Series, mostWatched_Films, fresh_drops, on_air_series, latest_animeMovies },
    },
  };
}

async function scrapeDirectHomepageFeedUncached(diagnostics = false): Promise<HomepageApiResponse | null> {
  if (homepageFeedCache && Date.now() - homepageFeedCache.timestamp < CACHE_TTL_MS) {
    return homepageFeedCache.data;
  }

  const startedAt = Date.now();
  try {
    let fetchDiagnostic: HomepageFetchDiagnostic | undefined;
    const html = await fetchHtmlWithWorkerFallback("https://animesalt.cx/", diagnostics, (details) => {
      fetchDiagnostic = details;
    });
    if (!html) {
      logHomepageSsr(diagnostics, {
        source: "animesalt-homepage",
        attempt: "fetch-chain",
        outcome: "unavailable",
        errorCategory: "all-fetch-attempts-failed",
        elapsedMs: Date.now() - startedAt,
        sectionCounts: { freshDrops: 0, latestAnimeMovies: 0, mostWatchedFilms: 0, mostWatchedSeries: 0, onAirSeries: 0 },
      });
      return null;
    }
    const feed = parseHomepageSourceHtml(html, diagnostics, fetchDiagnostic);
    if (!feed) return null;

    homepageFeedCache = { data: feed, timestamp: Date.now() };
    return feed;
  } catch (err) {
    rethrowNextControlFlow(err);
    if (!diagnostics) {
      console.error("[Scraper] Error scraping direct homepage feed:", err);
      return null;
    }
    return null;
  }
}

export function scrapeDirectHomepageFeed(diagnostics = false): Promise<HomepageApiResponse | null> {
  if (diagnostics) return scrapeDirectHomepageFeedUncached(true);
  return cacheValidatedScraperResult(
    ["homepage"],
    900,
    () => scrapeDirectHomepageFeedUncached(false),
    (result): result is HomepageApiResponse => hasHomepageItems(result)
  );
}

export function getHomepageFeed(diagnostics = false): Promise<HomepageApiResponse | null> {
  // Reuse a verified feed before repeating the API → AnimeSalt fallback chain.
  if (homepageFeedCache && Date.now() - homepageFeedCache.timestamp < CACHE_TTL_MS) {
    return Promise.resolve(homepageFeedCache.data);
  }
  if (homepageFeedInFlight) return homepageFeedInFlight;

  const request = getHomepageFeedUnshared(diagnostics);
  homepageFeedInFlight = request;
  const cleanup = () => {
    if (homepageFeedInFlight === request) homepageFeedInFlight = null;
  };
  void request.then(cleanup, cleanup);
  return request;
}

async function getHomepageFeedUnshared(diagnostics = false): Promise<HomepageApiResponse | null> {
  if (typeof window !== "undefined") {
    // In-browser: return cached feed or null rather than attempting direct CORS fetch to external API
    return homepageFeedCache?.data ?? null;
  }

  // Primary source: validated AnimeSalt homepage data through Worker/direct fetch.
  const scrapedFeed = await scrapeDirectHomepageFeed(diagnostics);
  if (hasHomepageItems(scrapedFeed)) {
    homepageFeedCache = { data: scrapedFeed!, timestamp: Date.now() };
    logDataSource("homepage", "animesalt-worker-or-direct", "success");
    return scrapedFeed;
  }
  logDataSource("homepage", "animesalt-worker-or-direct", "empty");

  // Optional, disabled-by-default old-backend fallback. Validation occurs
  // inside unstable_cache, so failed or empty responses are never cached.
  const legacyFeed = await fetchLegacyValidated(
    "homepage",
    "feed",
    "/api",
    (value): value is HomepageApiResponse => {
      const candidate = value as HomepageApiResponse | null;
      return Boolean(candidate && candidate.data?.success !== false && hasHomepageItems(candidate));
    }
  );
  if (legacyFeed) {
    homepageFeedCache = { data: legacyFeed, timestamp: Date.now() };
    logHomepageSsr(diagnostics, {
      source: "legacy-api-homepage",
      attempt: "validated-fallback",
      outcome: "success",
      sectionCounts: getHomepageSectionCounts(legacyFeed),
    });
    return legacyFeed;
  }

  // Last resort: reuse a previously verified in-memory feed.
  const cachedFeed = homepageFeedCache?.data;
  if (hasHomepageItems(cachedFeed)) {
    logHomepageSsr(diagnostics, {
      source: "homepage-memory-cache",
      attempt: "stale-fallback",
      outcome: "hit",
      sectionCounts: getHomepageSectionCounts(cachedFeed),
    });
    return cachedFeed ?? null;
  }

  logHomepageSsr(diagnostics, {
    source: "homepage-feed",
    attempt: "fallback-chain",
    outcome: "empty",
    errorCategory: "no-valid-feed",
    sectionCounts: { freshDrops: 0, latestAnimeMovies: 0, mostWatchedFilms: 0, mostWatchedSeries: 0, onAirSeries: 0 },
  });
  return null;
}

function mapHomepageItem(
  item: AnimeListItem,
  type: Anime["type"],
  rank?: number
): Anime {
  const mapped = mapSearchItemToAnime(item, type);
  return {
    ...mapped,
    popularityRank: rank,
    trendingRank: rank,
  };
}

function mapFreshDropToEpisode(item: HomepageFreshDropItem): Episode {
  const animeSlug = cleanAnimeSlug(item.anime_id);
  const episodeNumbers = String(item.episode)
    .split(/\D+/)
    .map(Number)
    .filter((number) => Number.isFinite(number));
  const episodeNumber = episodeNumbers.length ? Math.max(...episodeNumbers) : 1;
  const season = Number(item.season) || 1;
  const mock = getAnimeBySlug(animeSlug);
  const poster = mock?.isMock
    ? MOCK_ARTWORK_URL
    : isUsableImageUrl(item.poster)
    ? item.poster
    : "";

  return {
    id: `ep-${season}-${episodeNumber}`,
    animeSlug,
    animeTitle: item.title,
    animePoster: poster,
    season,
    number: episodeNumber,
    title: `Episode ${item.episode}`,
    thumbnail: poster,
    durationMinutes: 0,
    languages: [],
    releasedAt: "",
    isNew: true,
    ...(mock?.isMock ? { isMock: true } : {}),
  };
}

function uniqueBySlug(items: Anime[]): Anime[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.slug || seen.has(item.slug)) return false;
    seen.add(item.slug);
    return true;
  });
}

export function mapLatestEpisodeToEpisode(item: LatestEpisodeItem): Episode {
  const animeSlug = cleanAnimeSlug(item.anime_id);
  const episodeNumbers = String(item.episode || "")
    .split(/\D+/)
    .map(Number)
    .filter((number) => Number.isFinite(number));
  const episodeNumber = episodeNumbers.length ? Math.max(...episodeNumbers) : 1;
  const season = Number(item.season) || 1;
  const mock = getAnimeBySlug(animeSlug);
  const poster = mock?.isMock
    ? MOCK_ARTWORK_URL
    : isUsableImageUrl(item.poster)
    ? item.poster
    : "";
  const displayTitle = item.episode ? `Episode ${item.episode}` : `Episode ${episodeNumber}`;
  return {
    id: `ep-${season}-${episodeNumber}`,
    animeSlug,
    animeTitle: item.title || animeSlug,
    animePoster: poster,
    season,
    number: episodeNumber,
    title: displayTitle,
    thumbnail: poster,
    durationMinutes: 24,
    languages: ["hindi", "english"],
    releasedAt: "",
    isNew: true,
    ...(mock?.isMock ? { isMock: true } : {}),
  };
}

/** Searches AnimeSalt first; the old backend is an opt-in migration fallback. */
export async function searchAnime(
  keyword: string,
  page: number = 1,
  options: { allowScraperFallback?: boolean } = {}
): Promise<AnimeSearchResponse | null> {
  const cleanKeyword = normalizeApiSearchQuery(keyword || "");
  if (!cleanKeyword) return null;

  if (options.allowScraperFallback !== false) {
    try {
      const scraped = await scrapeAnimeSaltSearch(cleanKeyword, page);
      if (scraped?.results.length) {
        logDataSource("search", "animesalt-worker-or-direct", "success");
        return { success: true, results: scraped };
      }
      logDataSource("search", "animesalt-worker-or-direct", "empty");
    } catch (err) {
      rethrowNextControlFlow(err);
      console.error("searchAnime AnimeSalt error:", err);
    }
  }

  if (isLegacyApiEnabled()) {
    const data = await fetchCachedAnimeSearch(cleanKeyword, page);
    if (data) return data;
  }

  return null;
}

/** Prefer AnimeSalt; optionally consult the disabled-by-default legacy API. */
async function searchAnimeScraperFirst(
  keyword: string,
  page: number
): Promise<{ results: AnimeSearchResult[]; totalPages: number } | null> {
  const scraped = await scrapeAnimeSaltSearch(keyword, page);
  if (scraped?.results.length) {
    logDataSource("search", "animesalt-worker-or-direct", "success");
    return { results: scraped.results, totalPages: scraped.totalPages };
  }

  const apiResult = await searchAnime(keyword, page, { allowScraperFallback: false });
  if (!Array.isArray(apiResult?.results?.results) || apiResult.results.results.length === 0) {
    return null;
  }
  return {
    results: apiResult.results.results,
    totalPages: apiResult.results.totalPages || 1,
  };
}

/**
 * Fetches anime details by slug.
 * NOTE: This endpoint often returns empty title, poster, language, genres.
 * Always enrich with searchAnime() for poster + title.
 */
/**
 * Fetches rich anime details via AniList GraphQL (synopsis, cover, banner, genres, score)
 * Fast, reliable, public API with no rate-limit blocking.
 */
async function fetchAniListMetaUncached(
  slugOrTitle: string
): Promise<AnimeInfoData | null> {
  const clean = formatDisplayTitle(slugOrTitle).replace(/-/g, " ").trim();
  if (!clean) return null;

  const query = `
    query ($s: String) {
      Media(search: $s, type: ANIME) {
        id
        title { romaji english native }
        description(asHtml: false)
        coverImage { extraLarge large }
        bannerImage
        genres
        averageScore
        seasonYear
        episodes
        status
        format
        relations {
          edges {
            relationType
            node {
              id
              format
              title { english romaji }
              episodes
            }
          }
        }
      }
    }
  `;

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4500);
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { s: clean } }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = await res.json();
    const m = json.data?.Media;
    if (!m) return null;

    // ── Relevance Guard: verify the returned anime actually matches our search ──
    // AniList uses fuzzy search — it may return a completely different anime when
    // the exact title isn't indexed (e.g., searching "Oni Girl" returns "Demon Slayer").
    // We check that at least one keyword from the input appears in the returned titles.
    const returnedEnglish = (m.title?.english || "").toLowerCase();
    const returnedRomaji  = (m.title?.romaji  || "").toLowerCase();
    const returnedNative  = (m.title?.native  || "").toLowerCase();
    // Split search into meaningful keywords (≥3 chars, skip numbers/filler)
    const searchWords = clean
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    // At least one keyword must appear in any returned title
    const isRelevant =
      searchWords.length === 0 ||
      searchWords.some(
        (w) =>
          returnedEnglish.includes(w) ||
          returnedRomaji.includes(w) ||
          returnedNative.includes(w)
      );
    if (!isRelevant) {
      console.warn(
        `[AniList] Fuzzy mismatch: searched "${clean}" but got "${m.title?.english || m.title?.romaji}". Discarding.`
      );
      return null;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const poster = m.coverImage?.extraLarge || m.coverImage?.large || "";
    const backdrop = m.bannerImage || poster;
    const rawDesc = m.description || "";
    const overview = rawDesc.replace(/<[^>]*>/g, "").trim();

    // Calculate total TV seasons from sequel relations
    const sequelCount = (m.relations?.edges || []).filter(
      (e: { relationType: string; node?: { format?: string } }) =>
        e.relationType === "SEQUEL" && (e.node?.format === "TV" || !e.node?.format)
    ).length;
    const computedSeasons = Math.max(1 + sequelCount, 1);

    // Prefer English title UNLESS it is all-caps (e.g. AniList stores "JUJUTSU KAISEN")
    // In that case, use romaji which is always properly cased (e.g. "Jujutsu Kaisen")
    const englishTitle = m.title?.english || "";
    const romajiTitle  = m.title?.romaji  || "";
    const isAllCaps = englishTitle.length > 0 && englishTitle === englishTitle.toUpperCase();
    const resolvedTitle = (isAllCaps ? (romajiTitle || englishTitle) : (englishTitle || romajiTitle)) || clean;

    return {
      title: resolvedTitle,
      anime_id: slugOrTitle,
      format: m.format,
      poster,
      backdrop,
      overview,
      genres: m.genres || [],
      year: String(m.seasonYear || ""),
      rating: m.averageScore ? String((m.averageScore / 10).toFixed(1)) : "8.5",
      seasons: String(computedSeasons),
      episodes: String(m.episodes || "12"),
      language: "hindi, english, japanese",
    };
  } catch (error) {
    rethrowNextControlFlow(error);
    return null;
  }
}

export function fetchAniListMeta(slugOrTitle: string): Promise<AnimeInfoData | null> {
  const normalized = normalizeApiSearchQuery(slugOrTitle);
  if (!normalized) return Promise.resolve(null);
  return cacheValidatedScraperResult(
    ["anilist-metadata", normalized],
    21600,
    () => fetchAniListMetaUncached(slugOrTitle),
    (result): result is AnimeInfoData => Boolean(result?.title && result.poster && result.overview)
  );
}

/** Fetches AnimeSalt detail first, with AniList as metadata fallback. */
export async function getAnimeInfo(
  animeId: string
): Promise<AnimeInfoResponse | null> {
  if (!animeId) return null;
  const cleanId = cleanAnimeSlug(animeId) || animeId;

  // 1. AnimeSalt detail page is the primary content source.
  try {
    const scraped = await scrapeDirectSeriesData(cleanId);
    const knownTv = getAnimeBySlug(cleanId)?.type === "TV";
    const wrongMovieDetail = Boolean(
      knownTv && (scraped?.isMovie || isKnownTvMovieTitleCollision(cleanId, scraped?.title))
    );
    if (scraped && !wrongMovieDetail && (scraped.title || scraped.poster || scraped.synopsis)) {
      logDataSource("anime-info", "animesalt-worker-or-direct", "success");
      return {
        success: true,
        data: {
          title: scraped.title || formatDisplayTitle(cleanId),
          anime_id: cleanId,
          poster: scraped.poster || "",
          backdrop: scraped.backdrop || scraped.poster || "",
          overview: scraped.synopsis || "",
          genres: scraped.genres || [],
          year: "",
          rating: "8.5",
          seasons: String(scraped.seasons.length || 1),
          episodes: String(scraped.s1Episodes.length || 12),
          language: "hindi, english, japanese",
        },
      };
    }
  } catch (error) {
    rethrowNextControlFlow(error);
  }

  // 2. AniList supplies metadata if AnimeSalt has no usable detail page.
  const aniMeta = await fetchAniListMeta(cleanId);
  if (aniMeta?.overview && aniMeta.poster) {
    logDataSource("anime-info", "anilist", "success");
    return { success: true, data: aniMeta };
  }

  // 3. Optional old-backend fallback, disabled by default.
  try {
    const data = await fetchLegacyValidated(
      "anime-info",
      cleanId,
      `/api/info?id=${encodeURIComponent(cleanId)}`,
      (value): value is AnimeInfoResponse => {
        const candidate = value as AnimeInfoResponse | null;
        const resolved = candidate ? resolveAnimeInfoData(candidate) : null;
        return Boolean(resolved && (resolved.title || resolved.overview || resolved.poster));
      }
    );
    if (data) {
      const resolved = resolveAnimeInfoData(data);
      if (resolved && (!resolved.title || !resolved.overview)) {
        const mock = getAnimeBySlug(cleanId);
        if (mock) {
          resolved.title = resolved.title || mock.title;
          resolved.overview = resolved.overview || mock.synopsis;
          resolved.poster = isUsableImageUrl(resolved.poster) ? resolved.poster : mock.poster;
          resolved.genres = resolved.genres?.length ? resolved.genres : mock.genres;
        }
        return { success: true, data: resolved };
      }
      return data;
    }
  } catch (err) {
    rethrowNextControlFlow(err);
    console.error("getAnimeInfo API error:", err);
  }

  // 4. Fallback to local bundled records.
  const mock = getAnimeBySlug(cleanId);
  if (mock) {
    return {
      success: true,
      data: {
        title: mock.title,
        anime_id: cleanId,
        poster: mock.poster,
        backdrop: mock.backdrop,
        overview: mock.synopsis,
        genres: mock.genres,
        year: String(mock.year),
        rating: String(mock.rating),
        seasons: String(mock.seasons),
        episodes: String(mock.episodeCount),
        language: mock.languages.join(", "),
      },
    };
  }

  return null;
}

export async function getMovieInfo(
  movieId: string
): Promise<MovieInfoResponse | null> {
  if (!movieId) return null;
  const cleanId = cleanAnimeSlug(movieId) || movieId;

  // 1. AnimeSalt's exact movie page is the primary source.
  const scraped = await scrapeDirectSeriesData(cleanId).catch((error) => {
    rethrowNextControlFlow(error);
    return null;
  });
  if (scraped?.isMovie && (scraped.title || scraped.poster || scraped.synopsis)) {
    logDataSource("movie-info", "animesalt-worker-or-direct", "success");
    return {
      success: true,
      results: {
        title: scraped.title || formatDisplayTitle(cleanId),
        anime_id: cleanId,
        poster: scraped.poster,
        backdrop: scraped.backdrop || scraped.poster,
        overview: scraped.synopsis || "",
        genres: scraped.genres || [],
        year: "",
        rating: "8.5",
        format: "MOVIE",
        languages: ["hindi", "english", "japanese"],
      },
    };
  }

  // 2. AniList is the metadata fallback when AnimeSalt has no movie detail.
  try {
    const aniMeta = await fetchAniListMeta(cleanId);
    if (aniMeta && aniMeta.overview) {
      logDataSource("movie-info", "anilist", "success");
      return {
        success: true,
        results: {
          title: aniMeta.title,
          anime_id: cleanId,
          format: aniMeta.format,
          poster: aniMeta.poster,
          backdrop: aniMeta.backdrop,
          overview: aniMeta.overview,
          genres: aniMeta.genres,
          year: aniMeta.year,
          rating: aniMeta.rating,
          languages: ["hindi", "english", "japanese"],
        },
      };
    }
  } catch (error) {
    rethrowNextControlFlow(error);
  }

  try {
    const data = await fetchLegacyValidated(
      "movie-info",
      cleanId,
      `/api/movie?id=${encodeURIComponent(cleanId)}`,
      (value): value is MovieInfoResponse => {
        const candidate = value as MovieInfoResponse | null;
        const resolved = candidate ? resolveMovieInfoData(candidate) : null;
        return Boolean(resolved && (resolved.title || resolved.overview || resolved.poster));
      }
    );
    if (data) return data;
  } catch (err) {
    rethrowNextControlFlow(err);
    console.error("getMovieInfo API error:", err);
  }
  return null;
}

/**
 * Catalog endpoints only return titles and posters. Enrich visible cards with
 * the overview from their detail endpoint without replacing their catalog
 * metadata when the upstream scraper returns an incomplete detail response.
 */
export async function enrichAnimeSynopses(items: Anime[]): Promise<Anime[]> {
  return Promise.all(
    items.map(async (item) => {
      // Catalog mapping may already provide a real synopsis from the existing
      // exact-slug metadata. Avoid per-item detail and scraper requests then.
      if (item.synopsis && item.synopsis !== SYNOPSIS_FALLBACK) return item;

      try {
        const data =
          item.type === "Movie"
            ? (await getMovieInfo(item.slug))?.results
            : (await getAnimeInfo(item.slug))?.data;

        if (data) {
          const synopsis = getApiSynopsis(data);
          if (synopsis && synopsis !== SYNOPSIS_FALLBACK) {
            return { ...item, synopsis };
          }
        }
      } catch {
        // upstream detail API failed
      }

      // Fallback: direct scrape overview from upstream page
      try {
        const meta = await scrapeDirectSeriesData(item.slug);
        if (meta?.synopsis && meta.synopsis !== SYNOPSIS_FALLBACK) {
          return { ...item, synopsis: meta.synopsis };
        }
      } catch {}

      // Fallback 2: mock item synopsis
      const mock = getAnimeBySlug(item.slug);
      if (mock?.synopsis && mock.synopsis !== SYNOPSIS_FALLBACK) {
        return { ...item, synopsis: mock.synopsis };
      }

      return item;
    })
  );
}

// ─── Direct Upstream Scraper for Episodes & Seasons ─────────────────────────

export interface ScrapedSeriesMeta {
  postId: string;
  seasons: number[];
  s1Episodes: EpisodeItem[];
  synopsis?: string;
  title?: string;
  poster?: string;
  backdrop?: string;
  isMovie?: boolean;
  genres?: string[];
}

function isKnownTvMovieTitleCollision(slug: string, title?: string): boolean {
  if (!title) return false;
  const known = getAnimeBySlug(slug);
  if (known?.type !== "TV") return false;

  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const expected = normalize(known.title);
  // AnimeSalt may resolve the shared Jujutsu Kaisen slug to Jujutsu Kaisen 0.
  return Boolean(expected && normalize(title) === `${expected}0`);
}

const seriesScrapeCache = new Map<string, { data: ScrapedSeriesMeta; timestamp: number }>();
const seriesScrapeInFlight = new Map<string, Promise<ScrapedSeriesMeta | null>>();

function parseEpisodesFromHtml(html: string): EpisodeItem[] {
  const episodes: EpisodeItem[] = [];
  const articleRegex =
    /<article[^>]*class=["'][^"']*episodes[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = articleRegex.exec(html)) !== null) {
    const art = match[1];

    // Thumbnail
    let thumbnail = "";
    const imgMatch =
      art.match(/data-src=["']([^"']+)["']/) ||
      art.match(/src=["']([^"']+)["']/);
    if (imgMatch && !imgMatch[1].startsWith("data:")) {
      thumbnail = imgMatch[1];
    }

    // Episode number
    const numMatch = art.match(
      /<span[^>]*class=["']num-epi["'][^>]*>([^<]+)<\/span>/i
    );
    const rawEpNum = numMatch ? numMatch[1].trim() : "";

    // Title
    const titleMatch = art.match(
      /<h2[^>]*class=["']entry-title["'][^>]*>([^<]+)<\/h2>/i
    );
    const title = titleMatch
      ? titleMatch[1].trim()
      : rawEpNum
      ? `Episode ${rawEpNum}`
      : `Episode ${idx + 1}`;

    // Link e.g. https://animesalt.cx/episode/naruto-shippuden-1x1/
    const linkMatch = art.match(
      /href=["'](https:\/\/animesalt\.cx\/episode\/[^"']+)["']/i
    );
    const link = linkMatch ? linkMatch[1] : "";

    let epNum = rawEpNum ? parseInt(rawEpNum, 10) : NaN;
    if (isNaN(epNum) && link) {
      const matchX = link.match(/-(\d+)x(\d+)\/?/);
      if (matchX) {
        epNum = parseInt(matchX[2], 10);
      }
    }
    if (isNaN(epNum) || epNum < 1) {
      epNum = idx + 1;
    }

    episodes.push({
      title,
      season: String(epNum), // Upstream convention: season field contains episode number
      image: thumbnail,
    });
    idx++;
  }

  return episodes;
}

const WORKER_SECRET_HEADER = "x-hindianime-proxy-secret";

function getServerWorkerBaseUrl(): string {
  if (typeof window !== "undefined") throw new Error("Authenticated Worker requests are server-only.");
  const { ALLOWED_WORKER_HOSTS, DEFAULT_WORKER_BASE_URL } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@/lib/api/worker-config") as typeof import("@/lib/api/worker-config");
  // Vercel deployments sometimes have only the public Worker URL configured.
  // The hostname is still allowlisted below; the shared secret remains
  // server-only in getServerWorkerHeaders().
  const configuredUrls = [process.env.CF_PROXY_URL, process.env.NEXT_PUBLIC_CF_PROXY_URL]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const candidates = [...new Set([...configuredUrls, DEFAULT_WORKER_BASE_URL])];

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.split("?")[0].replace(/\/+$/, ""));
      const validQuery =
        url.search === "" ||
        (url.searchParams.size === 1 && url.searchParams.has("url") && url.searchParams.get("url") === "");
      if (
        url.protocol === "https:" &&
        ALLOWED_WORKER_HOSTS.has(url.hostname) &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        validQuery &&
        !url.hash
      ) {
        return url.origin;
      }
    } catch {
      // Try the next configured, allowlisted Worker URL.
    }
  }

  console.error("[worker-auth] No valid allowlisted Worker URL; using the configured default.");
  return DEFAULT_WORKER_BASE_URL;
}

function buildServerWorkerProxyUrl(targetUrl: string): string {
  return `${getServerWorkerBaseUrl()}/?url=${encodeURIComponent(targetUrl)}`;
}

function buildServerWorkerCatalogUrl(kind: "series" | "movies", page: number): string {
  const url = new URL(`${getServerWorkerBaseUrl()}/catalog`);
  url.searchParams.set("kind", kind);
  url.searchParams.set("page", String(page));
  return url.toString();
}

function getServerWorkerHeaders(headers?: HeadersInit): Headers {
  if (typeof window !== "undefined") throw new Error("Authenticated Worker requests are server-only.");
  const secret = process.env.CF_PROXY_SHARED_SECRET;
  if (!secret) {
    console.error("[worker-auth] CF_PROXY_SHARED_SECRET is missing; protected Worker request was not sent.");
    throw new Error("CF_PROXY_SHARED_SECRET is required for authenticated Worker requests.");
  }
  const result = new Headers(headers);
  result.set(WORKER_SECRET_HEADER, secret);
  return result;
}

function is404Html(text: string): boolean {
  if (!text || text.length < 500) return true;
  // Cloudflare challenge / verification / security check
  if (
    text.includes("Just a moment...") ||
    text.includes("cf-chl-widget") ||
    text.includes("id=\"challenge-stage\"") ||
    text.includes("id=\"challenge-form\"") ||
    text.includes("_cf_chl_opt") ||
    text.includes("cf-browser-verification") ||
    text.includes("Attention Required! | Cloudflare") ||
    text.includes("security check")
  ) {
    return true;
  }
  if (/<title>[\s\S]*?(?:404|not found|page not found)[\s\S]*?<\/title>/i.test(text)) return true;
  if (/class=["'][^"']*error404[^"']*["']/i.test(text)) return true;
  // The Worker can turn a source 404 into HTTP 200. AnimeSalt's compact 404
  // document does not consistently label its <title> or CSS class, so also
  // recognise its visible error copy before treating it as a detail page.
  const visibleText = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (/(?:page you (?:are looking for|requested) (?:does not exist|could not be found)|sorry,? (?:this )?page (?:does not exist|cannot be found)|error 404|nothing found)/i.test(visibleText)) {
    return true;
  }
  return false;
}

function isAnimeDetailHtml(html: string | null): html is string {
  if (!html || is404Html(html)) return false;
  // AnimeSalt does not use one stable heading class for every movie/series
  // template. The URL is already an exact title URL at this stage, so once a
  // disguised 404 has been ruled out, keep the page for its real artwork.
  return true;
}

async function fetchHtmlTextAttempt(
  requestUrl: string,
  timeoutMs: number,
  headers: HeadersInit,
  deadlineAt?: number
): Promise<string | null> {
  const remainingMs = deadlineAt ? Math.min(timeoutMs, deadlineAt - Date.now()) : timeoutMs;
  if (remainingMs <= 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remainingMs);
  try {
    const response = await fetch(requestUrl, { headers, signal: controller.signal });
    if (!response.ok) return null;
    // Keep the abort timer active while consuming the response body too.
    const html = await response.text();
    return is404Html(html) ? null : html;
  } catch (error) {
    rethrowNextControlFlow(error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtmlUncached(url: string, deadlineAt?: number): Promise<string | null> {
  if (url.includes("animesalt.cx")) {
    try {
      const proxyUrl = buildServerWorkerProxyUrl(url);
      console.log(`[Worker Request Outbound] Proxying: ${url}`);
      const workerHtml = await fetchHtmlTextAttempt(proxyUrl, 6000, DEFAULT_SCRAPER_HEADERS, deadlineAt);
      if (workerHtml) return workerHtml;
    } catch (error) {
      rethrowNextControlFlow(error);
      // If the Worker is unavailable or returns an invalid response, try direct.
    }
  }

  return fetchHtmlTextAttempt(url, 3500, DEFAULT_SCRAPER_HEADERS, deadlineAt);
}

async function fetchHtmlWithWorkerFallback(
  url: string,
  diagnostics = false,
  onSuccessfulFetch?: (details: HomepageFetchDiagnostic) => void,
  deadlineAt?: number
): Promise<string | null> {
  if (!diagnostics) return fetchHtmlUncached(url, deadlineAt);

  const fetchAttempt = async (
    source: "worker-primary" | "direct-animesalt" | "worker-retry",
    requestUrl: string,
    timeoutMs: number
  ): Promise<string | null> => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status: number | null = null;
    let contentType: string | null = null;
    try {
      console.log(`[Worker Request Outbound] Diagnostics fetch: ${requestUrl}`);
      const response = await fetch(requestUrl, {
        headers: DEFAULT_SCRAPER_HEADERS,
        signal: controller.signal,
      });
      status = response.status;
      contentType = response.headers.get("content-type");
      if (!response.ok) {
        const responseBytes = diagnostics
          ? await response.clone().arrayBuffer().then((body) => body.byteLength).catch(() => null)
          : null;
        logHomepageSsr(diagnostics, {
          source,
          attempt: "fetch",
          outcome: "non-ok-status",
          status,
          contentType,
          responseBytes,
          elapsedMs: Date.now() - startedAt,
          errorCategory: "http-status",
        });
        return null;
      }

      const html = await response.text();
      const responseBytes = new TextEncoder().encode(html).byteLength;
      if (is404Html(html)) {
        logHomepageSsr(diagnostics, {
          source,
          attempt: "fetch",
          outcome: "invalid-response",
          status,
          contentType,
          responseBytes,
          elapsedMs: Date.now() - startedAt,
          errorCategory: "challenge-or-not-found-html",
        });
        return null;
      }

      const details = { status: response.status, contentType, responseBytes };
      onSuccessfulFetch?.(details);
      logHomepageSsr(diagnostics, {
        source,
        attempt: "fetch",
        outcome: "success",
        ...details,
        elapsedMs: Date.now() - startedAt,
      });
      return html;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logHomepageSsr(diagnostics, {
        source,
        attempt: "fetch",
        outcome: "error",
        status,
        contentType,
        elapsedMs: Date.now() - startedAt,
        errorCategory: controller.signal.aborted || error.name === "AbortError" || error.name === "TimeoutError"
          ? "timeout"
          : "request-error",
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // For animesalt.cx requests, query via Worker proxy first to bypass Cloudflare challenge
  if (url.includes("animesalt.cx")) {
    const remaining = deadlineAt ? deadlineAt - Date.now() : 6000;
    const proxyHtml = remaining > 0
      ? await fetchAttempt("worker-primary", buildServerWorkerProxyUrl(url), Math.min(6000, remaining))
      : null;
    if (proxyHtml) return proxyHtml;
    const directRemaining = deadlineAt ? deadlineAt - Date.now() : 3500;
    if (directRemaining > 0) {
      return fetchAttempt("direct-animesalt", url, Math.min(3500, directRemaining));
    }
  }

  return null;
}

export function scrapeDirectSeriesData(slug: string): Promise<ScrapedSeriesMeta | null> {
  const cleanId = cleanAnimeSlug(slug) || slug;
  if (!cleanId) return Promise.resolve(null);

  const cached = seriesScrapeCache.get(cleanId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return Promise.resolve(cached.data);
  }

  const pending = seriesScrapeInFlight.get(cleanId);
  if (pending) return pending;

  // Jujutsu Kaisen's movie URL redirects to Jujutsu Kaisen 0, while the
  // series has the same base slug. Refresh only this ambiguous cached result
  // so an older movie classification cannot keep winning for six hours.
  const cacheVersion = cleanId === "jujutsu-kaisen" ? "series-first-v2" : "v1";
  const request = cacheValidatedScraperResult(
    ["series-detail", cleanId, cacheVersion],
    21600,
    () => scrapeDirectSeriesDataUnshared(cleanId),
    (result): result is ScrapedSeriesMeta => Boolean(
      result &&
      (result.poster || result.synopsis || result.s1Episodes.length > 0 || (result.postId && result.seasons.length > 0))
    )
  );
  seriesScrapeInFlight.set(cleanId, request);
  const cleanup = () => {
    if (seriesScrapeInFlight.get(cleanId) === request) {
      seriesScrapeInFlight.delete(cleanId);
    }
  };
  void request.then(cleanup, cleanup);
  return request;
}

async function scrapeDirectSeriesDataUnshared(cleanId: string): Promise<ScrapedSeriesMeta | null> {
  try {
    const decodedSlug = normalizeSlug(cleanId);
    const deadlineAt = Date.now() + 20_000;
    let html: string | null = null;
    let isMovie = false;

    // Try exact series and movie URLs concurrently, preserving series preference.
    const seriesUrl = `https://animesalt.cx/series/${encodeURIComponent(decodedSlug)}/`;
    const movieUrl = `https://animesalt.cx/movies/${encodeURIComponent(decodedSlug)}/`;
    const [seriesHtml, movieHtml] = await Promise.all([
      fetchHtmlWithWorkerFallback(seriesUrl, false, undefined, deadlineAt),
      fetchHtmlWithWorkerFallback(movieUrl, false, undefined, deadlineAt),
    ]);
    if (isAnimeDetailHtml(seriesHtml)) html = seriesHtml;
    else if (isAnimeDetailHtml(movieHtml)) {
      html = movieHtml;
      isMovie = true;
    }

    // 3. Fallback: Search AnimeSalt by keyword if direct fetch failed
    if (!html) {
      const searchKw = decodedSlug.replace(/[【】\[\]]/g, " ").replace(/-/g, " ").trim();
      if (searchKw) {
        try {
          const sUrl = `https://animesalt.cx/?s=${encodeURIComponent(searchKw)}`;
          const sHtml = await fetchHtmlWithWorkerFallback(sUrl, false, undefined, deadlineAt);
          if (sHtml) {
            const links = [...sHtml.matchAll(/href=["'](https:\/\/animesalt\.cx\/(?:series|movies)\/[^"']+)["']/gi)];
            const exactLink = links.find(
              (match) => cleanAnimeSlug(match[1]) === decodedSlug
            );
            if (exactLink) {
              const targetUrl = exactLink[1];
              html = await fetchHtmlWithWorkerFallback(targetUrl, false, undefined, deadlineAt);
              if (isAnimeDetailHtml(html)) {
                isMovie = targetUrl.includes("/movies/");
              } else {
                html = null;
              }
            }
          }
        } catch (error) {
          rethrowNextControlFlow(error);
          // search fallback error ignored
        }
      }
    }

    if (!html) {
      return null;
    }

    // Parse Synopsis / Overview
    let synopsis: string | undefined;
    const overviewMatch =
      html.match(/id=["']overview-text["'][^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]*class=["'][^"']*(?:description|entry-content|synopsis)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (overviewMatch) {
      // Pick the first <p> or the whole block
      const pMatch = overviewMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const rawText = pMatch ? pMatch[1] : overviewMatch[1];
      const clean = decodeHtmlEntities(
        rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      );
      if (clean && clean.length > 15 && !clean.toLowerCase().startsWith("language:")) {
        synopsis = clean;
      }
    }

    // Fallback: meta og:description or description
    if (!synopsis) {
      const metaDesc =
        html.match(/<meta\s+(?:property=["']og:description["']\s+content=["']([^"']+)["']|content=["']([^"']+)["']\s+property=["']og:description["'])/i) ||
        html.match(/<meta\s+(?:name=["']description["']\s+content=["']([^"']+)["']|content=["']([^"']+)["']\s+name=["']description["'])/i);
      if (metaDesc) {
        const clean = decodeHtmlEntities(metaDesc[1] || metaDesc[2] || "").trim();
        if (clean && clean.length > 15) {
          synopsis = clean;
        }
      }
    }

    // Parse Title & clean brackets
    const titleMatch =
      html.match(/<h1[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([^<]+)<\/h1>/i) ||
      html.match(/<title>([^<]+)<\/title>/i);
    let title: string | undefined;
    if (titleMatch) {
      const rawTitle = decodeHtmlEntities(titleMatch[1])
        .replace(/\s*-\s*Anime\s*Salt.*$/i, "")
        .trim();
      const unbracketed = rawTitle.replace(/^[【\[\s]+|[】\]\s]+$/g, "").trim();
      title = unbracketed || rawTitle;
      if (title && (title.toLowerCase().includes("404") || title.toLowerCase().includes("not found"))) {
        title = undefined;
      }
    }

    // Parse Poster
    let poster: string | undefined;

    // ── Strategy 1: JavaScript variable on the detail page ───────────────────
    // AnimeSalt injects: let image = "//image.tmdb.org/t/p/w500/<hash>.jpg";
    // This variable is always scoped to the current title — it is the most
    // reliable single-poster signal and is set before the recommendation grid.
    {
      const scriptVarMatch =
        html.match(/(?:let|var)\s+image\s*=\s*["']((?:https:)?\/\/[^"']+)["']/i);
      if (scriptVarMatch) {
        let p = scriptVarMatch[1];
        if (p.startsWith("//")) p = "https:" + p;
        if (p && !p.startsWith("data:") && !p.includes("logo") && !p.includes("icon")) {
          poster = p.replace(/\/w(?:185|342|200|300)\//, "/w500/");
        }
      }
    }

    // ── Strategy 2: Hero inline-styled poster img (above <h1>) ───────────────
    // AnimeSalt renders the detail-page poster with inline style="height: 14rem".
    // This image always belongs to the current title and appears before the
    // recommendation section so there is no cross-contamination from other cards.
    if (!poster) {
      const heroImgMatch =
        // Matches: <img style="height: 14rem; ..." data-src="..." ...>
        html.match(/<img[^>]+style=["'][^"']*14rem[^"']*["'][^>]+data-src=["']((?:https:)?\/\/[^"']+)["']/i) ||
        html.match(/<img[^>]+data-src=["']((?:https:)?\/\/[^"']+)["'][^>]+style=["'][^"']*14rem[^"']*["']/i) ||
        // Matches: <img alt="Image Title"> which is unique to the main hero poster
        html.match(/<img[^>]+alt=["']Image\s+[^"']{3,80}["'][^>]+data-src=["']((?:https:)?\/\/[^"']+)["']/i) ||
        html.match(/<img[^>]+data-src=["']((?:https:)?\/\/[^"']+)["'][^>]+alt=["']Image\s+[^"']{3,80}["']/i);

      if (heroImgMatch) {
        let p = heroImgMatch[1];
        if (p.startsWith("//")) p = "https:" + p;
        if (p && !p.startsWith("data:") && !p.includes("logo") && !p.includes("icon") && !p.includes("AnimeSalt")) {
          poster = p.replace(/\/w(?:185|342|200|300)\//, "/w500/");
        }
      }
    }

    // ── Strategy 3: TPostImg class (series/movie theme image class) ───────────
    if (!poster) {
      const tPostImgMatch =
        html.match(/<img[^>]+class=["'][^"']*TPostImg[^"']*["'][^>]+(?:data-src|src)=["']([^"']+)["']/i);
      if (tPostImgMatch) {
        let p = tPostImgMatch[1];
        if (p.startsWith("//")) p = "https:" + p;
        if (p && !p.startsWith("data:")) {
          poster = p.replace(/\/w(?:185|342|200|300)\//, "/w500/");
        }
      }
    }

    // ── Strategy 4: og:image (last resort) ───────────────────────────────────
    // WARNING: AnimeSalt's WordPress theme sometimes sets og:image to the site
    // logo (AnimeSalticon.png) instead of the post image; filter those out.
    if (!poster) {
      const ogImageMatch = html.match(
        /<meta\s+(?:property=["']og:image["']\s+content=["']([^"']+)["']|content=["']([^"']+)["']\s+property=["']og:image["'])/i
      );
      if (ogImageMatch) {
        let p = (ogImageMatch[1] || ogImageMatch[2] || "").trim();
        if (p.startsWith("//")) p = "https:" + p;
        if (
          p &&
          !p.startsWith("data:") &&
          !p.includes("AnimeSalticon") &&
          !p.includes("cropped-") &&
          !p.includes("favicon") &&
          !p.includes("logo")
        ) {
          poster = p;
        }
      }
    }

    // ── Strategy 5: raw src on TMDB images (very last resort) ─────────────────
    if (!poster) {
      const pSrcMatch =
        html.match(/src=["']((?:https:)?\/\/image\.tmdb\.org\/t\/p\/w(?:342|500)\/[^"']+)["']/i) ||
        html.match(/src=["']((?:https:)?\/\/image\.tmdb\.org\/t\/p\/[^"']+)["']/i);
      if (pSrcMatch) {
        let p = pSrcMatch[1];
        if (p.startsWith("//")) p = "https:" + p;
        if (!p.startsWith("data:")) {
          poster = p.replace(/\/w(?:185|342|200|300)\//, "/w500/");
        }
      }
    }

    // Parse Backdrop: Look for data-src on TPostBg or TMDB w1280 / original
    let backdrop: string | undefined;
    const bDataMatch =
      html.match(/<img[^>]+class=["'][^"']*TPostBg[^"']*["'][^>]+data-src=["']([^"']+)["']/i) ||
      html.match(/<img[^>]+data-src=["']([^"']+)["'][^>]+class=["'][^"']*TPostBg[^"']*["']/i) ||
      html.match(/data-src=["']((?:https:)?\/\/image\.tmdb\.org\/t\/p\/(?:w1280|original)\/[^"']+)["']/i);

    if (bDataMatch) {
      let b = bDataMatch[1];
      if (b.startsWith("//")) b = "https:" + b;
      if (!b.startsWith("data:")) backdrop = b;
    }

    if (!backdrop) {
      const bSrcMatch = html.match(
        /src=["']((?:https:)?\/\/image\.tmdb\.org\/t\/p\/(?:w1280|original)\/[^"']+)["']/i
      );
      if (bSrcMatch) {
        let b = bSrcMatch[1];
        if (b.startsWith("//")) b = "https:" + b;
        if (!b.startsWith("data:")) backdrop = b;
      }
    }

    // Some title pages publish only the wide hero image. It still belongs to
    // this exact anime, so use it for the portrait card (cropped by the UI)
    // instead of falling back to an unrelated legacy API poster.
    if (!poster && backdrop) {
      poster = backdrop;
    }

    if (!backdrop && poster) {
      backdrop = poster;
    }

    // Parse Genres
    const genreMatches = [...html.matchAll(/\/category\/genre\/([a-zA-Z0-9_-]+)/gi)];
    const nonGenreTags = new Set(["animation", "adult-cast", "award-winning", "subbed", "dubbed", "hindi", "english"]);
    const scrapedGenres = [...new Set(genreMatches.map((m) => m[1].toLowerCase().trim()))].filter(
      (g) => g && !nonGenreTags.has(g) && !g.startsWith("page")
    );
    const mockGenres = getAnimeBySlug(cleanId)?.genres || [];
    const genres = scrapedGenres.length > 0 ? scrapedGenres : mockGenres;

    if (isMovie) {
      const meta: ScrapedSeriesMeta = {
        postId: "",
        seasons: [1],
        s1Episodes: [
          {
            title: "Full Movie",
            season: "1",
            image: poster || "",
          },
        ],
        synopsis,
        title,
        poster,
        backdrop: backdrop || poster,
        isMovie: true,
        genres,
      };
      seriesScrapeCache.set(cleanId, { data: meta, timestamp: Date.now() });
      return meta;
    }

    // Parse all season buttons:
    const btnRegex = /<a[^>]*class=["'][^"']*season-btn[^"']*["'][^>]*>/gi;
    let btnTag: RegExpExecArray | null;
    const seasons: number[] = [];
    let postId = "";

    while ((btnTag = btnRegex.exec(html)) !== null) {
      const tag = btnTag[0];
      const sMatch = tag.match(/data-season=["'](\d+)["']/);
      const pMatch = tag.match(/data-post=["'](\d+)["']/);
      if (sMatch) {
        const sNum = parseInt(sMatch[1], 10);
        if (pMatch && !postId) postId = pMatch[1];
        if (!seasons.includes(sNum)) seasons.push(sNum);
      }
    }
    if (!postId) {
      const postMatch =
        html.match(/id=['"]post-(\d+)['"]/i) ||
        html.match(/data-post=['"](\d+)['"]/i) ||
        html.match(/wp-post-(\d+)/i) ||
        html.match(/name=['"]post['"]\s+value=['"](\d+)['"]/i);
      if (postMatch) postId = postMatch[1];
    }
    seasons.sort((a, b) => a - b);

    const s1Episodes = parseEpisodesFromHtml(html);
    if (seasons.length === 0 && s1Episodes.length > 0) {
      seasons.push(1);
    } else if (seasons.length === 0) {
      seasons.push(1);
    }

    const meta: ScrapedSeriesMeta = {
      postId,
      seasons,
      s1Episodes,
      synopsis,
      title,
      poster,
      backdrop: backdrop || poster,
      isMovie: false,
      genres,
    };
    seriesScrapeCache.set(cleanId, { data: meta, timestamp: Date.now() });
    return meta;
  } catch (err) {
    rethrowNextControlFlow(err);
    console.error(`[Scraper] Error scraping series data for ${cleanId}:`, err);
    return null;
  }
}

async function scrapeDirectSeasonEpisodesUncached(slug: string, season: number): Promise<EpisodeItem[]> {
  const cleanId = cleanAnimeSlug(slug) || slug;
  if (!cleanId) return [];

  const seriesMeta = await scrapeDirectSeriesData(cleanId);
  if (!seriesMeta) return [];

  if (season === 1 || season <= 0) {
    return seriesMeta.s1Episodes;
  }

  // Season > 1: Query admin-ajax.php
  const postId = seriesMeta.postId;
  if (!postId) {
    return [];
  }

  try {
    const ajaxUrl = `https://animesalt.cx/wp-admin/admin-ajax.php?action=action_select_season&season=${season}&post=${postId}`;
    const html = await fetchHtmlWithWorkerFallback(ajaxUrl);
    if (!html) return [];
    return parseEpisodesFromHtml(html);
  } catch (err) {
    rethrowNextControlFlow(err);
    console.error(`[Scraper] Error fetching season ${season} for ${cleanId}:`, err);
    return [];
  }
}

async function scrapeDirectSeasonEpisodes(slug: string, season: number): Promise<EpisodeItem[]> {
  const cleanId = cleanAnimeSlug(slug) || slug;
  const episodes = await cacheValidatedScraperResult(
    ["season-episodes", cleanId, String(season), cleanId === "jujutsu-kaisen" ? "series-episode-v2" : "v1"],
    21600,
    () => scrapeDirectSeasonEpisodesUncached(cleanId, season),
    (result): result is EpisodeItem[] => Boolean(result?.length)
  );
  return episodes ?? [];
}

/**
 * Fetches episodes for an anime and season directly from the upstream API
 * with complete lists and zero artificial limits.
 */
export async function getEpisodes(
  animeId: string,
  season: number | string = 1
): Promise<EpisodeResponse | null> {
  if (!animeId) return null;
  const cleanId = cleanAnimeSlug(animeId) || animeId;
  const seasonNum = typeof season === "string" ? parseInt(season, 10) || 1 : season;

  // 1. AnimeSalt episode pages are the primary source.
  try {
    const meta = await scrapeDirectSeriesData(cleanId);
    const episodes = await scrapeDirectSeasonEpisodes(cleanId, seasonNum);
    const allSeasons = meta?.seasons && meta.seasons.length > 0 ? meta.seasons : await getAvailableSeasons(cleanId);
    const seasonsList = allSeasons.length > 0 ? allSeasons : [seasonNum];
    const onlyMovieEntry = Boolean(
      getAnimeBySlug(cleanId)?.type === "TV" &&
      seasonNum === 1 &&
      episodes?.length === 1 &&
      /^full\s+movie$/i.test(episodes[0].title.trim())
    );

    if (episodes && episodes.length > 0 && !onlyMovieEntry) {
      logDataSource("episodes", "animesalt-worker-or-direct", "success");
      return {
        success: true,
        results: {
          totalSeasons: String(seasonsList.length || 1),
          seasons: seasonsList.map((s) => ({
            season: String(s),
            text: `Season ${s}`,
          })),
          episodes,
        },
      };
    }
  } catch (err) {
    rethrowNextControlFlow(err);
    console.error(`[getEpisodes] Error fetching episodes for ${cleanId} s${seasonNum}:`, err);
  }

  // 2. AniList metadata determines a conservative episode/season fallback.
  const aniMeta = await fetchAniListMeta(cleanId);

  // 3. Optional migration fallback to the retired episode API.
  const legacyEpisodes = await fetchLegacyValidated(
    "episodes",
    `${cleanId}:${seasonNum}`,
    `/api/episode?id=${encodeURIComponent(cleanId)}&season=${seasonNum}`,
    (value): value is EpisodeResponse => {
      const candidate = value as EpisodeResponse | null;
      return Boolean(candidate?.results?.episodes?.length);
    }
  );
  if (legacyEpisodes) return legacyEpisodes;

  // 4. Synthesize a fallback episode list from AniList / bundled metadata.
  try {
    const mock = getAnimeBySlug(cleanId);
    const allSeasons = await getAvailableSeasons(cleanId);
    const seasonsList = allSeasons.length > 0 ? allSeasons : [seasonNum];
    const totalEp = parseInt(aniMeta?.episodes || "", 10) || mock?.episodeCount || 12;
    if (totalEp > 0) {
      const episodes: EpisodeItem[] = Array.from({ length: totalEp }, (_, i) => ({
        title: `Episode ${i + 1}`,
        season: String(seasonNum),
        episode: String(i + 1),
        image: aniMeta?.poster || mock?.poster || "",
      }));
      return {
        success: true,
        results: {
          totalSeasons: String(seasonsList.length),
          seasons: seasonsList.map((s) => ({
            season: String(s),
            text: `Season ${s}`,
          })),
          episodes,
        },
      };
    }
  } catch (error) {
    rethrowNextControlFlow(error);
    // fallback error
  }

  return null;
}

/**
 * Fetches all available seasons for an anime series directly from the API.
 * Returns the exact season numbers (e.g. [1, 2, 3, ..., 22]).
 */
export const getAvailableSeasons = cache(async (
  animeId: string
): Promise<number[]> => {
  if (!animeId) return [];
  const cleanId = cleanAnimeSlug(animeId) || animeId;

  // 1. AnimeSalt detail page contains the actual season list.
  const meta = await scrapeDirectSeriesData(cleanId);
  const knownTvMovieCollision = Boolean(
    getAnimeBySlug(cleanId)?.type === "TV" &&
    (meta?.isMovie || isKnownTvMovieTitleCollision(cleanId, meta?.title))
  );
  if (!knownTvMovieCollision && meta && meta.seasons && meta.seasons.length > 0) {
    logDataSource("seasons", "animesalt-worker-or-direct", "success");
    return meta.seasons;
  }

  // 2. AniList metadata can estimate sequel seasons if scraping has no list.
  const ani = await fetchAniListMeta(cleanId);
  const aniSeasons = parseInt(ani?.seasons || "1", 10);
  if (aniSeasons > 1) return Array.from({ length: aniSeasons }, (_, i) => i + 1);

  // 3. Optional migration fallback to the old episode API.
  const legacy = await fetchLegacyValidated(
    "seasons",
    cleanId,
    `/api/episode?id=${encodeURIComponent(cleanId)}&season=1`,
    (value): value is EpisodeResponse => {
      const candidate = value as EpisodeResponse | null;
      return Boolean(candidate?.results?.seasons?.length || Number(candidate?.results?.totalSeasons) > 0);
    }
  );
  if (legacy) {
    const sNums = legacy.results?.seasons
      ?.map((item) => parseInt(item.season, 10))
      .filter((number) => Number.isFinite(number) && number > 0) ?? [];
    const total = parseInt(legacy.results?.totalSeasons || "", 10);
    if (sNums.length) return [...new Set(sNums)].sort((a, b) => a - b);
    if (total > 0) return Array.from({ length: total }, (_, index) => index + 1);
  }

  // 4. Last resort: use curated bundled metadata.
  const mock = getAnimeBySlug(cleanId);
  if (mock?.seasons && mock.seasons > 1) return Array.from({ length: mock.seasons }, (_, i) => i + 1);

  return [1];
});

/**
 * Fetches stream sources for a specific episode.
 *
 * GET /api/stream?id={animeId}&season={season}&ep={episode}
 *
 * Note: The backend currently returns {"embed":"Not Found"} and {"embed":"Error loading"}
 * for most episodes. Always validate each result with isValidEmbedUrl() before use.
 */
export async function getEpisodeStreams(
  animeId: string,
  season: number,
  episode: number
): Promise<StreamResponse | null> {
  const cleanId = cleanAnimeSlug(animeId) || animeId;
  if (!cleanId) return null;
  return fetchLegacyValidated(
    "legacy-streams",
    `${cleanId}:${season}:${episode}`,
    `/api/stream?id=${encodeURIComponent(cleanId)}&season=${season}&ep=${episode}`,
    (value): value is StreamResponse => {
      const candidate = value as StreamResponse | null;
      return Boolean(candidate?.results?.some((item) => isValidEmbedUrl(item.embed || item.url)));
    },
    30
  );
}

export interface HomepageData {
  heroItems: Anime[];
  latestEpisodes: Episode[];
  trendingItems: Anime[];
  popularItems: Anime[];
  movieItems: Anime[];
  seriesItems: Anime[];
  upcomingItems: Anime[];
}

export function getFallbackHomepageData(): HomepageData {
  const rankedAnime = [...anime].sort(
    (a, b) => (a.trendingRank ?? 99) - (b.trendingRank ?? 99)
  ).filter((item) => !item.isMock);

  // These sections claim to reflect current upstream activity. Never fill them
  // with curated rankings or synthetic episodes when AnimeSalt is unavailable.
  const heroItems = rankedAnime.slice(0, 6);
  const trendingItems: Anime[] = [];
  const popularItems = rankedAnime
    .filter((a) => a.type === "TV")
    .sort((a, b) => (a.popularityRank ?? 99) - (b.popularityRank ?? 99));
  const movieItems = rankedAnime.filter((a) => a.type === "Movie");
  const seriesItems = rankedAnime.filter((a) => a.type === "TV");
  const upcomingItems = rankedAnime.filter(
    (a) => a.status === "Upcoming" || a.status === "Ongoing"
  );

  const latestEpisodes: Episode[] = [];

  return {
    heroItems,
    latestEpisodes,
    trendingItems,
    popularItems,
    movieItems,
    seriesItems,
    upcomingItems,
  };
}

export function mapHomepageFeedToData(feed: HomepageApiResponse): HomepageData {
  const sections = feed.data?.results;
  if (!sections) return getFallbackHomepageData();

  const latestEpisodes = deduplicateEpisodes(
    (sections.fresh_drops || []).map(mapFreshDropToEpisode)
  );
  const movieItems = uniqueBySlug(
    (sections.latest_animeMovies || []).map((item) => mapHomepageItem(item, "Movie"))
  );
  const popularItems = uniqueBySlug(
    (sections.mostWatched_Series || []).map((item) =>
      mapHomepageItem(item, "TV", Number(item.rank) || undefined)
    )
  );
  const trendingItems = uniqueBySlug(
    [
      ...(sections.mostWatched_Series || []).map((item) =>
        mapHomepageItem(item, "TV", Number(item.rank) || undefined)
      ),
      ...(sections.mostWatched_Films || []).map((item) =>
        mapHomepageItem(item, "Movie", Number(item.rank) || undefined)
      ),
    ].sort((a, b) => (a.trendingRank ?? Infinity) - (b.trendingRank ?? Infinity))
  );
  const seriesItems = uniqueBySlug(
    (sections.on_air_series || []).map((item) => mapHomepageItem(item, "TV"))
  );
  const latestSlugs = new Set(latestEpisodes.map((episode) => episode.animeSlug));

  return {
    heroItems: trendingItems.slice(0, 6),
    latestEpisodes,
    trendingItems,
    popularItems,
    movieItems,
    seriesItems,
    upcomingItems: seriesItems.filter((item) => !latestSlugs.has(item.slug)),
  };
}

/**
 * Maps the API's purpose-built homepage feed. It already contains the latest,
 * most-watched, movie, and on-air lists, so one request avoids duplicated
 * catalog calls and preserves the API's own ordering and ranks.
 *
 * If upstream is down, empty, or blocked, seamlessly falls back to the rich catalog.
 */
export async function getHomepageData(options: { diagnostics?: boolean } = {}): Promise<HomepageData> {
  const diagnostics = options.diagnostics === true;
  let feed: HomepageApiResponse | null = null;
  try {
    feed = await getHomepageFeed(diagnostics);
  } catch (err) {
    rethrowNextControlFlow(err);
    const error = err instanceof Error ? err : new Error(String(err));
    if (diagnostics) {
      logHomepageSsr(true, {
        source: "homepage-data",
        attempt: "feed-resolution",
        outcome: "error",
        errorCategory: error.name === "AbortError" || error.name === "TimeoutError" ? "timeout" : "feed-error",
      });
    } else {
      console.error("getHomepageData: getHomepageFeed failed, using fallback:", err);
    }
  }

  if (!feed || !hasHomepageItems(feed)) {
    const fallback = getFallbackHomepageData();
    logHomepageSsr(diagnostics, {
      source: "homepage-data",
      attempt: "map",
      outcome: "empty-fallback",
      errorCategory: "no-feed-items",
      finalCounts: getHomepageDataCounts(fallback),
    });
    return fallback;
  }

  let mapped: HomepageData;
  try {
    mapped = mapHomepageFeedToData(feed);
  } catch (err) {
    rethrowNextControlFlow(err);
    const error = err instanceof Error ? err : new Error(String(err));
    logHomepageSsr(diagnostics, {
      source: "homepage-data",
      attempt: "map",
      outcome: "error",
      errorCategory: `mapping-failure-${error.name}`,
      sectionCounts: getHomepageSectionCounts(feed),
    });
    throw err;
  }

  const result = {
    // Do not delay the initial Hero render on optional per-title synopsis APIs.
    heroItems: mapped.heroItems,
    latestEpisodes: mapped.latestEpisodes,
    trendingItems: mapped.trendingItems,
    popularItems: mapped.popularItems,
    movieItems: mapped.movieItems,
    seriesItems: mapped.seriesItems,
    upcomingItems: mapped.upcomingItems,
  };
  logHomepageSsr(diagnostics, {
    source: "homepage-data",
    attempt: "map",
    outcome: "success",
    sectionCounts: getHomepageSectionCounts(feed),
    finalCounts: getHomepageDataCounts(result),
  });
  return result;
}

function getHomepageDataCounts(data: HomepageData): Record<string, number> {
  return {
    heroItems: data.heroItems.length,
    latestEpisodes: data.latestEpisodes.length,
    trendingItems: data.trendingItems.length,
    popularItems: data.popularItems.length,
    movieItems: data.movieItems.length,
    seriesItems: data.seriesItems.length,
    upcomingItems: data.upcomingItems.length,
  };
}
