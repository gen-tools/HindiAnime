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
    ...globals,
  };
  context.globalThis = context;
  vm.runInNewContext(runnable, context, { filename: "lib/api/client.ts" });
  return context.__testedFunction as (...args: unknown[]) => Promise<unknown>;
}

const workerUrl = (target: string) => `https://worker.test/?url=${encodeURIComponent(target)}`;
const workerHeaders = (headers: HeadersInit) => headers;

test("failed scrape makes one Worker attempt and preserves one direct fallback", async () => {
  const requests: string[] = [];
  const fetchFallback = await loadClientFunction(
    "async function fetchHtmlWithWorkerFallback(",
    "\nexport function scrapeDirectSeriesData(",
    "fetchHtmlWithWorkerFallback",
    {
      DEFAULT_SCRAPER_HEADERS: { Accept: "text/html" },
      buildServerWorkerProxyUrl: workerUrl,
      getServerWorkerHeaders: workerHeaders,
      is404Html: () => false,
      logHomepageSsr() {},
      fetch: async (url: string) => {
        requests.push(url);
        return new Response("unavailable", { status: 403 });
      },
    }
  );

  const result = await fetchFallback("https://animesalt.cx/series/test-title/");
  assert.equal(result, null);
  assert.equal(requests.length, 2);
  assert.equal(requests.filter((url) => url.startsWith("https://worker.test/" )).length, 1);
  assert.equal(requests[1], "https://animesalt.cx/series/test-title/");
});

test("diagnostic scrape retains direct fallback without repeating the Worker request", async () => {
  const requests: string[] = [];
  const outcomes: string[] = [];
  const fetchFallback = await loadClientFunction(
    "async function fetchHtmlWithWorkerFallback(",
    "\nexport function scrapeDirectSeriesData(",
    "fetchHtmlWithWorkerFallback",
    {
      DEFAULT_SCRAPER_HEADERS: { Accept: "text/html" },
      buildServerWorkerProxyUrl: workerUrl,
      getServerWorkerHeaders: workerHeaders,
      is404Html: () => false,
      logHomepageSsr(_enabled: boolean, event: { source: string }) { outcomes.push(event.source); },
      fetch: async (url: string) => {
        requests.push(url);
        return new Response("upstream denied", { status: 403, headers: { "content-type": "text/html" } });
      },
    }
  );

  const result = await fetchFallback("https://animesalt.cx/series/test-title/", true);
  assert.equal(result, null);
  assert.equal(requests.filter((url) => url.startsWith("https://worker.test/")).length, 1);
  assert.deepEqual(outcomes, ["worker-primary", "direct-animesalt"]);
});

test("movie enrichment skips all per-item lookups when mapped metadata already has a synopsis", async () => {
  let apiCalls = 0;
  let scrapeCalls = 0;
  const enrich = await loadClientFunction(
    "export async function enrichAnimeSynopses(",
    "\n// ─── Direct Upstream Scraper",
    "enrichAnimeSynopses",
    {
      SYNOPSIS_FALLBACK: "No synopsis available.",
      getMovieInfo: async () => { apiCalls += 1; return null; },
      getAnimeInfo: async () => { apiCalls += 1; return null; },
      getApiSynopsis: () => "No synopsis available.",
      scrapeDirectSeriesData: async () => { scrapeCalls += 1; return null; },
      getAnimeBySlug: () => undefined,
    }
  );
  const item = { type: "Movie", slug: "known-movie", synopsis: "Existing verified synopsis" };
  const result = await enrich([item]);

  assert.deepEqual(result, [item]);
  assert.equal(apiCalls, 0);
  assert.equal(scrapeCalls, 0);
});

test("movie enrichment retains API and scrape fallbacks when synopsis is missing", async () => {
  let apiCalls = 0;
  let scrapeCalls = 0;
  const enrich = await loadClientFunction(
    "export async function enrichAnimeSynopses(",
    "\n// ─── Direct Upstream Scraper",
    "enrichAnimeSynopses",
    {
      SYNOPSIS_FALLBACK: "No synopsis available.",
      getMovieInfo: async () => { apiCalls += 1; return { results: {} }; },
      getAnimeInfo: async () => { apiCalls += 1; return { data: {} }; },
      getApiSynopsis: () => "No synopsis available.",
      scrapeDirectSeriesData: async () => { scrapeCalls += 1; return { synopsis: "Scraped synopsis" }; },
      getAnimeBySlug: () => undefined,
    }
  );
  const result = await enrich([{ type: "Movie", slug: "unmatched-movie", synopsis: "No synopsis available." }]);

  assert.equal(apiCalls, 1);
  assert.equal(scrapeCalls, 1);
  assert.equal((result as Array<{ synopsis: string }>)[0].synopsis, "Scraped synopsis");
});
