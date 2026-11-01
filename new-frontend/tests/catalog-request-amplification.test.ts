import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

async function loadGetCatalog(globals: Record<string, unknown>) {
  const source = await readFile(new URL("../lib/api/client.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function getCatalog(");
  const end = source.indexOf("\nasync function getFullCatalog(", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const extracted = source.slice(start, end).replace(/^export\s+/m, "");
  const runnable = ts.transpile(
    `${extracted}\nglobalThis.__testedFunction = getCatalog;`,
    { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 }
  );
  const context: Record<string, unknown> = {
    console,
    fetch,
    ...globals,
  };
  context.globalThis = context;
  vm.runInNewContext(runnable, context, { filename: "lib/api/client.ts" });
  return context.__testedFunction as (...args: unknown[]) => Promise<unknown>;
}

const apiData = {
  success: true,
  results: {
    currentPage: 2,
    totalPages: 38,
    results: [
      { anime_id: "https://animesalt.cx/series/second-title/", title: "Second", poster: null },
      { anime_id: "https://animesalt.cx/series/first-title/", title: "First", poster: "https://img.test/first.jpg" },
    ],
  },
};

test("successful API catalog response does not trigger frontend Worker requests", async () => {
  const apiRequests: string[] = [];
  const htmlRequests: string[] = [];
  let catalogScrapes = 0;
  const getCatalog = await loadGetCatalog({
    API_BASE_URL: "https://api.test",
    isUsableImageUrl: (value?: string | null) => Boolean(value?.startsWith("https://img.test/")),
    cleanAnimeSlug: (value: string) => new URL(value).pathname.split("/").filter(Boolean).at(-1),
    fetch: async (url: string) => {
      apiRequests.push(url);
      return new Response(JSON.stringify(apiData), { headers: { "content-type": "application/json" } });
    },
    fetchHtmlWithWorkerFallback: async (url: string) => {
      htmlRequests.push(url);
      return "<html>real AnimeSalt catalog markup</html>";
    },
    parseAnimeSaltArticles: () => ({
      results: [
        { anime_id: "https://animesalt.cx/series/second-title/", title: "Second", poster: "https://img.test/second.jpg" },
      ],
    }),
    scrapeAnimeSaltCatalog: async () => { catalogScrapes += 1; return null; },
    getHomepageFeed: async () => null,
  });

  const result = await getCatalog("series", 2) as typeof apiData;
  assert.deepEqual(apiRequests, ["https://api.test/api/series?page=2"]);
  assert.deepEqual(htmlRequests, []);
  assert.equal(catalogScrapes, 0);
  assert.equal(result.results.currentPage, 2);
  assert.equal(result.results.totalPages, 38);
  assert.deepEqual(result.results.results.map((item) => item.title), ["Second", "First"]);
  assert.equal(result.results.results[0].poster, null);
  assert.equal(result.results.results[1].poster, "https://img.test/first.jpg");
});

test("failed API catalog response does not fall back to frontend Worker scraping", async () => {
  let catalogScrapes = 0;
  const htmlRequests: string[] = [];
  const getCatalog = await loadGetCatalog({
    API_BASE_URL: "https://api.test",
    isUsableImageUrl: (value?: string | null) => Boolean(value?.startsWith("https://img.test/")),
    fetch: async () => new Response("unavailable", { status: 502 }),
    fetchHtmlWithWorkerFallback: async (url: string) => { htmlRequests.push(url); return null; },
    scrapeAnimeSaltCatalog: async () => { catalogScrapes += 1; return null; },
    getHomepageFeed: async () => null,
  });

  const result = await getCatalog("series", 2) as typeof apiData;
  assert.equal(result, null);
  assert.deepEqual(htmlRequests, []);
  assert.equal(catalogScrapes, 0);
});
