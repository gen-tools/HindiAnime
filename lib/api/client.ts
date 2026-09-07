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
import { deduplicateEpisodes } from "@/lib/episodes";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://anime-api-gilt-beta.vercel.app";

const KNOWN_LANGUAGES: Record<string, LanguageCode> = {
  hindi: "hindi",
  english: "english",
  japanese: "japanese",
  tamil: "tamil",
  telugu: "telugu",
  bengali: "bengali",
  malayalam: "malayalam",
  kannada: "kannada",
  marathi: "marathi",
  korean: "korean",
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
  return matched.length > 0 ? matched : ["hindi"];
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

export const SYNOPSIS_FALLBACK = "No synopsis available.";

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
  type: Anime["type"] = "TV"
): Anime {
  const cleanSlug =
    cleanAnimeSlug(item.anime_id) ||
    item.title.toLowerCase().replace(/\s+/g, "-");

  // poster may be null from API — only use if it's a real http URL
  const poster = isUsableImageUrl(item.poster) ? item.poster : "";

  const backdrop = getAnimeBackdrop(cleanSlug, poster || undefined);

  return {
    id: cleanSlug,
    slug: cleanSlug,
    title: item.title || cleanSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    synopsis: SYNOPSIS_FALLBACK,
    poster,
    backdrop,
    rating: 0,
    year: 0,
    type,
    status: type === "Movie" ? "Completed" : "Ongoing",
    durationMinutes: 0,
    episodeCount: 0,
    genres: [],
    languages: [],
    seasons: 0,
    studio: "",
    updatedAt: "",
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
    isUsableImageUrl(item.poster)
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
  const poster = isUsableImageUrl(data.poster)
    ? data.poster
    : isUsableImageUrl(fallbackPoster)
    ? fallbackPoster
    : "";

  const backdrop = getAnimeBackdrop(cleanSlug, poster || undefined);

  // Genres: API returns [] when it fails — use action as default
  const genres =
    data.genres && data.genres.length > 0
      ? data.genres.map((g) => g.toLowerCase().replace(/\s+/g, "-"))
      : [];

  const synopsis = getApiSynopsis(data);

  // Quality field ("" or "Movie") — determine type
  const type = data.quality?.toUpperCase().includes("MOVIE") ? "Movie" : "TV";

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
  };
}

export function mapMovieInfoToAnime(
  data: MovieInfoData,
  fallbackPoster?: string,
  fallbackTitle?: string
): Anime {
  const slug = cleanAnimeSlug(data.anime_id);
  const title = data.title?.trim() || fallbackTitle || slug.replace(/-/g, " ");
  const poster = isUsableImageUrl(data.poster)
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
    backdrop: getAnimeBackdrop(slug, poster || undefined),
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
  // item.episode does not exist in the real API — item.season is the episode number
  // If parsed number is 0 or NaN, fall back to 1-based array index
  const parsedNum = parseInt(item.episode || item.season, 10);
  const epNum = isNaN(parsedNum) || parsedNum < 1 ? arrayIndex + 1 : parsedNum;
  const seasonNum = seasonOverride;
  // Use arrayIndex as tie-breaker to guarantee globally unique IDs across the list
  const episodeId = `ep-${seasonNum}-${epNum}`;

  // Use the episode image if it's a real URL, otherwise fall back to animePoster
  const thumbnail =
    isUsableImageUrl(item.image)
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

const catalogPageCache = new Map<string, { data: CatalogPageResult; timestamp: number }>();

/**
 * Scrapes animesalt.cx/series/ or /movies/ catalog pages directly.
 * Each page returns 12 items. Series has ~38 pages (2,543 total), movies ~23 pages (2,531 total).
 */
export async function scrapeAnimeSaltCatalog(
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

    const res = await fetch(url, {
      headers: DEFAULT_SCRAPER_HEADERS,
      next: { revalidate: 300 },
    });

    if (!res.ok) return null;

    const html = await res.text();
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

    const result: CatalogPageResult = { results, totalPages, currentPage: page };
    catalogPageCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (err) {
    console.error(`[Scraper] Error scraping ${kind} catalog page ${page}:`, err);
    return null;
  }
}

export async function getCatalog(
  kind: "series" | "movies",
  page = 1
): Promise<AnimeCatalogResponse | null> {
  // 1. Try upstream JSON API first
  try {
    const res = await fetch(`${API_BASE_URL}/api/${kind}?page=${page}`, {
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const data = (await res.json()) as AnimeCatalogResponse;
      if (data?.results?.results && Array.isArray(data.results.results) && data.results.results.length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.error(`getCatalog ${kind} API error:`, err);
  }

  // 2. Fallback: Direct scraper from animesalt.cx catalog pages (2,500+ titles, paginated)
  try {
    const scraped = await scrapeAnimeSaltCatalog(kind, page);
    if (scraped && scraped.results.length > 0) {
      return {
        success: true,
        results: {
          currentPage: scraped.currentPage,
          totalPages: scraped.totalPages,
          results: scraped.results,
        },
      };
    }
  } catch (scrapedErr) {
    console.error(`getCatalog ${kind} catalog scraper error:`, scrapedErr);
  }

  // 3. Last resort: homepage feed data (page 1 only, limited set)
  if (page === 1) {
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

export async function getLatestEpisodes(): Promise<LatestEpisodesResponse | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/newadded`, {
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const data = (await res.json()) as LatestEpisodesResponse;
      if (data?.results && Array.isArray(data.results) && data.results.length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.error("getLatestEpisodes API error:", err);
  }

  // Fallback: The upstream /api/newadded endpoint can fail (e.g. 500 server error).
  // The primary homepage endpoint (/api) or direct scraper provides `fresh_drops` with the latest episodes.
  try {
    const feed = await getHomepageFeed();
    const drops = feed?.data?.results?.fresh_drops;
    if (drops && Array.isArray(drops) && drops.length > 0) {
      return {
        success: true,
        results: drops,
      };
    }
  } catch (err) {
    console.error("getLatestEpisodes fallback error:", err);
  }

  return null;
}

// ─── Direct Upstream Scraper for Homepage Feed ──────────────────────────────

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

let homepageFeedCache: { data: HomepageApiResponse; timestamp: number } | null = null;

export async function scrapeDirectHomepageFeed(): Promise<HomepageApiResponse | null> {
  if (homepageFeedCache && Date.now() - homepageFeedCache.timestamp < CACHE_TTL_MS) {
    return homepageFeedCache.data;
  }

  try {
    const res = await fetch("https://animesalt.cx/", {
      headers: DEFAULT_SCRAPER_HEADERS,
      next: { revalidate: 60 },
    });

    if (!res.ok) return null;

    const html = await res.text();
    const mostWatched_Series = parseHomepageCharts(html, "Most-Watched Series");
    const mostWatched_Films = parseHomepageCharts(html, "Most-Watched Films");
    const fresh_drops = parseHomepageArticles(
      html,
      "Fresh Drops",
      true
    ) as HomepageFreshDropItem[];
    const on_air_series = parseHomepageArticles(
      html,
      "On-Air Series"
    ) as AnimeListItem[];
    const latest_animeMovies = parseHomepageArticles(
      html,
      "Latest Anime Movies"
    ) as AnimeListItem[];

    if (
      mostWatched_Series.length === 0 &&
      mostWatched_Films.length === 0 &&
      fresh_drops.length === 0
    ) {
      return null;
    }

    const feed: HomepageApiResponse = {
      success: true,
      data: {
        success: true,
        results: {
          mostWatched_Series,
          mostWatched_Films,
          fresh_drops,
          on_air_series,
          latest_animeMovies,
        },
      },
    };

    homepageFeedCache = { data: feed, timestamp: Date.now() };
    return feed;
  } catch (err) {
    console.error("[Scraper] Error scraping direct homepage feed:", err);
    return null;
  }
}

export async function getHomepageFeed(): Promise<HomepageApiResponse | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api`, {
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const data = (await res.json()) as HomepageApiResponse;
      if (data?.data?.results) {
        homepageFeedCache = { data, timestamp: Date.now() };
        return data;
      }
    }
  } catch (err) {
    console.error("getHomepageFeed API error:", err);
  }

  // Fallback 1: Direct upstream scraper from animesalt.cx
  const scrapedFeed = await scrapeDirectHomepageFeed();
  if (scrapedFeed?.data?.results) {
    return scrapedFeed;
  }

  // Fallback 2: Cached in-memory feed if available
  if (homepageFeedCache?.data?.data?.results) {
    return homepageFeedCache.data;
  }

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
  const poster = isUsableImageUrl(item.poster) ? item.poster : "";

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
  const poster = isUsableImageUrl(item.poster) ? item.poster : "";
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
  };
}

/**
 * Searches anime via the deployed API.
 * This is the RELIABLE source for anime title and TMDB poster.
 */
export async function searchAnime(
  keyword: string,
  page: number = 1
): Promise<AnimeSearchResponse | null> {
  if (!keyword || !keyword.trim()) return null;
  try {
    const url = `${API_BASE_URL}/api/search?s=${encodeURIComponent(keyword.trim())}&page=${page}`;
    const res = await fetch(url, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data: AnimeSearchResponse = await res.json();
    return data;
  } catch (err) {
    console.error("searchAnime API error:", err);
    return null;
  }
}

/**
 * Fetches anime details by slug.
 * NOTE: This endpoint often returns empty title, poster, language, genres.
 * Always enrich with searchAnime() for poster + title.
 */
export async function getAnimeInfo(
  animeId: string
): Promise<AnimeInfoResponse | null> {
  if (!animeId) return null;
  const cleanId = cleanAnimeSlug(animeId) || animeId;
  try {
    const url = `${API_BASE_URL}/api/info?id=${encodeURIComponent(cleanId)}`;
    const res = await fetch(url, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data: AnimeInfoResponse = await res.json();
    return data;
  } catch (err) {
    console.error("getAnimeInfo API error:", err);
    return null;
  }
}

export async function getMovieInfo(
  movieId: string
): Promise<MovieInfoResponse | null> {
  if (!movieId) return null;
  const cleanId = cleanAnimeSlug(movieId) || movieId;
  try {
    const res = await fetch(`${API_BASE_URL}/api/movie?id=${encodeURIComponent(cleanId)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as MovieInfoResponse;
  } catch (err) {
    console.error("getMovieInfo API error:", err);
    return null;
  }
}

/**
 * Catalog endpoints only return titles and posters. Enrich visible cards with
 * the overview from their detail endpoint without replacing their catalog
 * metadata when the upstream scraper returns an incomplete detail response.
 */
export async function enrichAnimeSynopses(items: Anime[]): Promise<Anime[]> {
  return Promise.all(
    items.map(async (item) => {
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
}

const seriesScrapeCache = new Map<string, { data: ScrapedSeriesMeta; timestamp: number }>();

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

const WORKER_PROXY_URL =
  process.env.NEXT_PUBLIC_CF_PROXY_URL ||
  "https://wispy-cherry-6934.shahazaibseo038.workers.dev/?url=";

function is404Html(text: string): boolean {
  if (!text || text.length < 500) return true;
  if (/<title>[\s\S]*?(?:404|not found|page not found)[\s\S]*?<\/title>/i.test(text)) return true;
  if (/class=["'][^"']*error404[^"']*["']/i.test(text)) return true;
  return false;
}

async function fetchHtmlWithWorkerFallback(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: DEFAULT_SCRAPER_HEADERS,
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const text = await res.text();
      if (!is404Html(text)) return text;
    }
  } catch {
    // direct fetch error
  }

  try {
    const proxyUrl = `${WORKER_PROXY_URL}${encodeURIComponent(url)}`;
    const pRes = await fetch(proxyUrl, {
      headers: DEFAULT_SCRAPER_HEADERS,
      next: { revalidate: 60 },
    });
    if (pRes.ok) {
      const text = await pRes.text();
      if (!is404Html(text)) return text;
    }
  } catch {
    // proxy fetch error
  }

  return null;
}

export async function scrapeDirectSeriesData(slug: string): Promise<ScrapedSeriesMeta | null> {
  const cleanId = cleanAnimeSlug(slug) || slug;
  if (!cleanId) return null;

  const cached = seriesScrapeCache.get(cleanId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const decodedSlug = normalizeSlug(cleanId);
    let html: string | null = null;
    let isMovie = false;

    // 1. Try series page
    const seriesUrl = `https://animesalt.cx/series/${encodeURIComponent(decodedSlug)}/`;
    html = await fetchHtmlWithWorkerFallback(seriesUrl);

    if (!html) {
      // 2. Try movie page
      const movieUrl = `https://animesalt.cx/movies/${encodeURIComponent(decodedSlug)}/`;
      html = await fetchHtmlWithWorkerFallback(movieUrl);
      if (html) isMovie = true;
    }

    // 3. Fallback: Search AnimeSalt by keyword if direct fetch failed
    if (!html) {
      const searchKw = decodedSlug.replace(/[【】\[\]]/g, " ").replace(/-/g, " ").trim();
      if (searchKw) {
        try {
          const sUrl = `https://animesalt.cx/?s=${encodeURIComponent(searchKw)}`;
          const sHtml = await fetchHtmlWithWorkerFallback(sUrl);
          if (sHtml) {
            const linkMatch = sHtml.match(/href=["'](https:\/\/animesalt\.cx\/(?:series|movies)\/[^"']+)["']/i);
            if (linkMatch) {
              const targetUrl = linkMatch[1];
              html = await fetchHtmlWithWorkerFallback(targetUrl);
              if (html) {
                isMovie = targetUrl.includes("/movies/");
              }
            }
          }
        } catch {
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

    // 1. og:image — if it's a real content image (not the site logo/icon)
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

    // 2. data-src or src on post-thumbnail, TPostImg, or TMDB image
    if (!poster) {
      const pDataMatch =
        html.match(/<div[^>]*class=["'][^"']*post-thumbnail[^"']*["'][^>]*>[\s\S]*?<img[^>]+data-src=["']([^"']+)["']/i) ||
        html.match(/<img[^>]+class=["'][^"']*TPostImg[^"']*["'][^>]+data-src=["']([^"']+)["']/i) ||
        html.match(/data-src=["']((?:https:)?\/\/image\.tmdb\.org\/t\/p\/w(?:342|500)\/[^"']+)["']/i) ||
        html.match(/data-src=["']((?:https:)?\/\/image\.tmdb\.org\/t\/p\/[^"']+)["']/i);

      if (pDataMatch) {
        let p = pDataMatch[1];
        if (p.startsWith("//")) p = "https:" + p;
        if (!p.startsWith("data:")) {
          poster = p.replace(/\/w(?:185|342|200|300)\//, "/w500/");
        }
      }
    }

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

    if (!backdrop && poster) {
      backdrop = poster;
    }

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
    };
    seriesScrapeCache.set(cleanId, { data: meta, timestamp: Date.now() });
    return meta;
  } catch (err) {
    console.error(`[Scraper] Error scraping series data for ${cleanId}:`, err);
    return null;
  }
}

async function scrapeDirectSeasonEpisodes(slug: string, season: number): Promise<EpisodeItem[]> {
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
    console.error(`[Scraper] Error fetching season ${season} for ${cleanId}:`, err);
    return [];
  }
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

  // 1. Try remote API first if configured and responsive
  try {
    const url = `${API_BASE_URL}/api/episode?id=${encodeURIComponent(cleanId)}&season=${seasonNum}`;
    const res = await fetch(url, {
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const data: EpisodeResponse = await res.json();
      if (data?.results?.episodes && data.results.episodes.length > 0) {
        return data;
      }
    }
  } catch {
    // remote API failed, fall back to direct upstream scraper
  }

  // 2. Direct upstream scraper (resilient, complete, zero truncation)
  try {
    const meta = await scrapeDirectSeriesData(cleanId);
    const episodes = await scrapeDirectSeasonEpisodes(cleanId, seasonNum);
    const seasonsList = meta?.seasons && meta.seasons.length > 0 ? meta.seasons : [seasonNum];

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
  } catch (err) {
    console.error(`[getEpisodes] Error fetching episodes for ${cleanId} s${seasonNum}:`, err);
    return null;
  }
}

/**
 * Fetches all available seasons for an anime series directly from the API.
 * Returns the exact season numbers (e.g. [1, 2, 3, ..., 22]).
 */
export async function getAvailableSeasons(
  animeId: string
): Promise<number[]> {
  if (!animeId) return [];
  const cleanId = cleanAnimeSlug(animeId) || animeId;

  // 1. Direct discovery: pulls all season buttons in a single request
  const meta = await scrapeDirectSeriesData(cleanId);
  if (meta && meta.seasons && meta.seasons.length > 0) {
    return meta.seasons;
  }

  // 2. Fallback: query remote API
  try {
    const res = await fetch(`${API_BASE_URL}/api/episode?id=${encodeURIComponent(cleanId)}&season=1`, {
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const data: EpisodeResponse = await res.json();
      if (Array.isArray(data?.results?.seasons) && data.results.seasons.length > 0) {
        const sNums = data.results.seasons
          .map((s) => parseInt(s.season, 10))
          .filter((n) => !isNaN(n) && n > 0);
        if (sNums.length > 0) return [...new Set(sNums)].sort((a, b) => a - b);
      }
      const total = parseInt(data?.results?.totalSeasons, 10);
      if (!isNaN(total) && total > 0) {
        return Array.from({ length: total }, (_, i) => i + 1);
      }
    }
  } catch {
    // ignore
  }

  return [1];
}

/**
 * Validates whether an embed string returned by the stream API is a real, usable URL.
 *
 * Invalid values returned by the backend:
 *   - "Not Found"
 *   - "Error loading"
 *   - empty string
 *   - null / undefined
 *   - data: URIs
 *   - anything not starting with http:// or https://
 */
export function isValidEmbedUrl(embed: string | null | undefined): boolean {
  if (!embed || typeof embed !== "string") return false;
  const trimmed = embed.trim();
  if (trimmed === "") return false;
  if (trimmed.toLowerCase() === "not found") return false;
  if (trimmed.toLowerCase() === "error loading") return false;
  if (trimmed.startsWith("data:")) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

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
  try {
    const url = `${API_BASE_URL}/api/stream?id=${encodeURIComponent(cleanId)}&season=${season}&ep=${episode}`;
    const res = await fetch(url, {
      // Do NOT cache stream responses — they are ephemeral
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data: StreamResponse = await res.json();
    return data;
  } catch (err) {
    console.error("getEpisodeStreams API error:", err);
    return null;
  }
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

/**
 * Maps the API's purpose-built homepage feed. It already contains the latest,
 * most-watched, movie, and on-air lists, so one request avoids duplicated
 * catalog calls and preserves the API's own ordering and ranks.
 */
export async function getHomepageData(): Promise<HomepageData> {
  const feed = await getHomepageFeed();
  const sections = feed?.data.results;

  if (!sections) {
    return {
      heroItems: [],
      latestEpisodes: [],
      trendingItems: [],
      popularItems: [],
      movieItems: [],
      seriesItems: [],
      upcomingItems: [],
    };
  }

  const latestEpisodes = deduplicateEpisodes(
    sections.fresh_drops.map(mapFreshDropToEpisode)
  );
  const latestMovies = uniqueBySlug(
    sections.latest_animeMovies.map((item) => mapHomepageItem(item, "Movie"))
  );
  const popularSeries = uniqueBySlug(
    sections.mostWatched_Series.map((item: HomepageRankedItem) =>
      mapHomepageItem(item, "TV", Number(item.rank) || undefined)
    )
  );
  const trendingItems = uniqueBySlug(
    [
      ...sections.mostWatched_Series.map((item) =>
        mapHomepageItem(item, "TV", Number(item.rank) || undefined)
      ),
      ...sections.mostWatched_Films.map((item) =>
        mapHomepageItem(item, "Movie", Number(item.rank) || undefined)
      ),
    ].sort((a, b) => (a.trendingRank ?? Infinity) - (b.trendingRank ?? Infinity))
  );
  const onAirSeries = uniqueBySlug(
    sections.on_air_series.map((item) => mapHomepageItem(item, "TV"))
  );
  const recentlyUpdated = new Set(latestEpisodes.map((episode) => episode.animeSlug));
  const upcomingItems = onAirSeries.filter((item) => !recentlyUpdated.has(item.slug));

  // The homepage feed intentionally contains lightweight card data only.
  // Hydrate just the six rotating spotlight items so `/api/info`'s `overview`
  // is available to the hero without issuing detail requests for every row.
  const heroItems = await enrichAnimeSynopses(trendingItems.slice(0, 6));

  return {
    heroItems,
    latestEpisodes,
    trendingItems,
    popularItems: popularSeries,
    movieItems: latestMovies,
    seriesItems: onAirSeries,
    upcomingItems,
  };
}
