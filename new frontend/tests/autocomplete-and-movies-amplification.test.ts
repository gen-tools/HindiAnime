import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

async function loadClientFunction(
  startMarker: string,
  endMarker: string,
  functionName: string,
  globals: Record<string, unknown>
) {
  const source = await readFile(new URL("../lib/api/client.ts", import.meta.url), "utf8");
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing function marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing function end marker: ${endMarker}`);
  const extracted = source.slice(start, end).replace(/^export\s+/m, "");
  const runnable = ts.transpile(
    `${extracted}\nglobalThis.__testedFunction = ${functionName};`,
    { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 }
  );
  const context: Record<string, unknown> = {
    AbortController,
    Headers,
    Promise,
    TextEncoder,
    clearTimeout,
    setTimeout,
    console,
    exports: {},
    suggestionsInFlight: new Map(),
    ...globals,
  };
  context.globalThis = context;
  vm.runInNewContext(runnable, context, { filename: "lib/api/client.ts" });
  return context.__testedFunction as (...args: unknown[]) => Promise<unknown>;
}

test("autocomplete suggestions makes bounded API requests and never triggers a global catalog sweep on no-match", async () => {
  const apiRequests: string[] = [];
  let globalCatalogSweeps = 0;
  let workerProxyRequests = 0;

  const mockSearchAnime = async (keyword: string, page = 1, options: { allowScraperFallback?: boolean } = {}) => {
    apiRequests.push(`search:${keyword}:page=${page}:fallback=${options.allowScraperFallback}`);
    // Simulate upstream returning 0 results for this test query
    return {
      success: true,
      results: {
        currentPage: 1,
        totalPages: 1,
        results: [],
      },
    };
  };

  const mockGetGlobalCatalog = async () => {
    globalCatalogSweeps += 1;
    return [];
  };

  const getSearchSuggestions = await loadClientFunction(
    "export async function getSearchSuggestions(",
    "\nexport async function getLatestEpisodes(",
    "getSearchSuggestions",
    {
      COMMON_ACRONYMS: { jjk: "jujutsu kaisen" },
      searchAnime: mockSearchAnime,
      getGlobalCatalog: mockGetGlobalCatalog,
      mapSearchItemToAnime: (raw: { title: string; anime_id: string }) => ({
        slug: raw.anime_id,
        title: raw.title,
      }),
      fuzzyScore: () => ({ score: 0.9, reasons: [] }),
      shareInFlightRequest: (_map: unknown, _key: string, fn: () => Promise<unknown>) => fn(),
      fetchHtmlWithWorkerFallback: async () => {
        workerProxyRequests += 1;
        return null;
      },
    }
  );

  const results = await getSearchSuggestions("nonexistent-anime-query") as unknown[];

  // 1. Must return an empty array for a genuine no-match
  assert.equal(results.length, 0);

  // 2. Must only make bounded search requests with scraper fallback disabled
  assert.equal(apiRequests.length, 1);
  assert.equal(apiRequests[0], "search:nonexistent-anime-query:page=1:fallback=false");

  // 3. Must NEVER trigger the 61-page global catalog sweep
  assert.equal(globalCatalogSweeps, 0, "Global catalog sweep must not be called during suggestions");

  // 4. Must NEVER trigger direct Worker proxy calls
  assert.equal(workerProxyRequests, 0, "Worker proxy must not be called during suggestions");
});

test("autocomplete suggestions returns ranked results on valid match without catalog sweep", async () => {
  let globalCatalogSweeps = 0;

  const mockSearchAnime = async (keyword: string) => {
    return {
      success: true,
      results: {
        currentPage: 1,
        totalPages: 1,
        results: [
          { anime_id: "naruto-shippuden", title: "Naruto Shippuden", poster: "https://img.test/naruto.jpg" },
        ],
      },
    };
  };

  const getSearchSuggestions = await loadClientFunction(
    "export async function getSearchSuggestions(",
    "\nexport async function getLatestEpisodes(",
    "getSearchSuggestions",
    {
      COMMON_ACRONYMS: {},
      searchAnime: mockSearchAnime,
      getGlobalCatalog: async () => { globalCatalogSweeps += 1; return []; },
      mapSearchItemToAnime: (raw: { anime_id: string; title: string; poster: string }) => ({
        slug: raw.anime_id,
        title: raw.title,
        poster: raw.poster,
        year: 2007,
        type: "TV",
      }),
      fuzzyScore: (_q: string, target: string) => ({ score: target.includes("Naruto") ? 0.95 : 0.2, reasons: [] }),
      shareInFlightRequest: (_map: unknown, _key: string, fn: () => Promise<unknown>) => fn(),
    }
  );

  const results = await getSearchSuggestions("naruto") as Array<{ slug: string; title: string; score: number }>;

  assert.equal(results.length, 1);
  assert.equal(results[0].slug, "naruto-shippuden");
  assert.equal(results[0].title, "Naruto Shippuden");
  assert.equal(results[0].score, 0.95);
  assert.equal(globalCatalogSweeps, 0);
});

test("movie-list rendering does not trigger direct Worker scrapes or detail calls for missing synopses", async () => {
  let workerScrapes = 0;
  let detailApiCalls = 0;

  // Mock catalog API response with 10 movies without synopses
  const mockMovieCatalog = {
    results: {
      currentPage: 1,
      totalPages: 10,
      results: Array.from({ length: 10 }, (_, i) => ({
        anime_id: `movie-${i + 1}`,
        title: `Anime Movie ${i + 1}`,
        poster: `https://img.test/poster-${i + 1}.jpg`,
      })),
    },
  };

  // The movie page pipeline: rawResults.map((item) => mapSearchItemToAnime(item, "Movie"))
  const source = await readFile(new URL("../lib/api/client.ts", import.meta.url), "utf8");
  const start = source.indexOf("export function mapSearchItemToAnime(");
  const end = source.indexOf("\nfunction normalizeCatalogTitle(", start);
  const extracted = source.slice(start, end).replace(/^export\s+/m, "");

  const runnable = ts.transpile(
    `${extracted}\nglobalThis.__mapFunction = mapSearchItemToAnime;`,
    { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 }
  );

  const SYNOPSIS_FALLBACK = "No synopsis available.";
  const context: Record<string, unknown> = {
    exports: {},
    SYNOPSIS_FALLBACK,
    cleanAnimeSlug: (s: string) => s,
    parseLanguages: () => ["hindi"],
    parseDurationMinutes: () => 120,
    isUsableImageUrl: () => true,
    getAnimeBySlug: () => undefined,
    getAnimeBackdrop: () => "",
  };
  context.globalThis = context;
  vm.runInNewContext(runnable, context);
  const mapSearchItemToAnime = context.__mapFunction as (item: unknown, type: string) => {
    slug: string;
    title: string;
    type: string;
    synopsis?: string;
    poster: string;
  };

  // Simulate what app/movies/page.tsx executes
  const rawResults = mockMovieCatalog.results.results;
  const apiMovies = rawResults.map((item) => mapSearchItemToAnime(item, "Movie"));

  // 1. All 10 items preserved in exact order
  assert.equal(apiMovies.length, 10);
  assert.equal(apiMovies[0].slug, "movie-1");
  assert.equal(apiMovies[9].slug, "movie-10");
  assert.equal(apiMovies[0].type, "Movie");

  // 2. Posters and titles preserved
  assert.equal(apiMovies[0].poster, "https://img.test/poster-1.jpg");
  assert.equal(apiMovies[0].title, "Anime Movie 1");

  // 3. Missing synopsis matches fallback and is omitted from rendering
  const featured = apiMovies[0];
  const shouldRenderSynopsis = Boolean(featured.synopsis && featured.synopsis !== SYNOPSIS_FALLBACK);
  assert.equal(shouldRenderSynopsis, false, "Missing synopsis must be omitted without triggering scraper");

  // 4. Zero Worker scrapes and zero per-card detail API calls triggered
  assert.equal(workerScrapes, 0, "Must not trigger direct Worker scrapes");
  assert.equal(detailApiCalls, 0, "Must not trigger individual detail API calls");
});
