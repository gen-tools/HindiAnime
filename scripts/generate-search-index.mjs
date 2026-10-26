import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "public", "search-index.json");
const backendToken = (process.env.KOYEB_AUTH_TOKEN || process.env.AUTH_TOKEN || "").trim();

function decodeHtml(value) {
  return value
    .replace(/&#x([\da-f]+);?/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function getCatalogEntries(html, kind) {
  const entries = [];
  const itemPattern = /<li\b([^>]*)>([\s\S]*?<article\b[^>]*\bclass=["'][^"']*\bpost\b[^"']*["'][^>]*>[\s\S]*?<\/article>[\s\S]*?)<\/li>/gi;
  const categoryGenreMap = new Map([
    ["action", ["action"]], ["adventure", ["adventure"]], ["comedy", ["comedy"]],
    ["drama", ["drama"]], ["fantasy", ["fantasy"]], ["horror", ["horror"]],
    ["isekai", ["isekai"]], ["mystery", ["mystery"]], ["psychological", ["psychological"]],
    ["romance", ["romance"]], ["school", ["school"]], ["sci-fi", ["sci-fi"]],
    ["shounen", ["shounen"]], ["slice-of-life", ["slice-of-life"]],
    ["sports", ["sports"]], ["super-natural", ["supernatural"]],
    ["supernatural", ["supernatural"]], ["super-power", ["super-power"]],
    ["thriller", ["thriller"]], ["action-adventure", ["action", "adventure"]],
    ["sci-fi-fantasy", ["sci-fi", "fantasy"]],
  ]);

  for (const [, listAttributes, listContent] of html.matchAll(itemPattern)) {
    const article = listContent.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
    if (!article) continue;
    const href = article.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;

    let url;
    try {
      url = new URL(decodeHtml(href), "https://animesalt.cx");
    } catch {
      continue;
    }
    let slug = url.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase();
    try {
      slug = slug ? decodeURIComponent(slug) : undefined;
    } catch {
      continue;
    }
    if (!slug || slug === "page") continue;

    const rawTitle =
      article.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ??
      article.match(/alt=["']([^"']+)["']/i)?.[1] ??
      slug.replace(/-/g, " ");
    const title = decodeHtml(rawTitle.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

    let poster =
      article.match(/data-src=["']([^"']+)["']/i)?.[1] ??
      article.match(/src=["']([^"']+)["']/i)?.[1] ??
      "";
    poster = decodeHtml(poster.trim());
    if (poster.startsWith("//")) poster = `https:${poster}`;
    if (!/^https?:\/\//i.test(poster) || poster.startsWith("data:")) poster = "";

    const year = Number(title.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? 0);
    const lower = `${title} ${slug}`.toLowerCase();
    const languages = ["hindi"];
    if (/\btamil\b/.test(lower)) languages.push("tamil");
    if (/\btelugu\b/.test(lower)) languages.push("telugu");
    if (/\benglish\b/.test(lower)) languages.push("english");
    if (/\bjapanese\b/.test(lower)) languages.push("japanese");
    const categoryClasses = [...(listAttributes.match(/\bclass=["']([^"']+)["']/i)?.[1] ?? "").matchAll(/\bcategory-([a-z0-9-]+)/gi)];
    const genres = [...new Set(categoryClasses.flatMap(([, category]) => categoryGenreMap.get(category) ?? []))];

    entries.push({
      id: slug,
      slug,
      title,
      synopsis: "",
      poster,
      backdrop: "",
      rating: 0,
      year,
      type: kind === "movies" ? "Movie" : "TV",
      status: "Completed",
      durationMinutes: 0,
      episodeCount: 0,
      genres,
      languages,
      seasons: 1,
      studio: "",
      updatedAt: "",
    });
  }

  return entries;
}

async function fetchPage(kind, page) {
  const target = page === 1
    ? `https://animesalt.cx/${kind}/`
    : `https://animesalt.cx/${kind}/page/${page}/`;
  if (!backendToken) throw new Error("KOYEB_AUTH_TOKEN is required to fetch the authenticated catalog");
  const proxy = new URL("https://api.hindi-anime.com/proxy");
  proxy.searchParams.set("url", target);

  const response = await fetch(proxy, {
    headers: {
      "User-Agent": "HindiAnime-SearchIndex/1.0",
      Accept: "text/html,application/xhtml+xml",
      Authorization: `Bearer ${backendToken}`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${kind} page ${page} returned HTTP ${response.status}`);

  const contentType = response.headers.get("content-type") ?? "";
  const html = await response.text();
  if (!contentType.toLowerCase().includes("text/html") || !/<html\b/i.test(html)) {
    throw new Error(`${kind} page ${page} did not return HTML`);
  }
  const entries = getCatalogEntries(html, kind);
  if (!entries.length) throw new Error(`${kind} page ${page} contained no catalog entries`);

  const pageNumbers = [...html.matchAll(/\/page\/(\d+)\//g)].map((match) => Number(match[1]));
  const totalPages = page === 1 ? Math.max(1, ...pageNumbers) : undefined;
  return { entries, totalPages };
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

const allEntries = [];
for (const kind of ["series", "movies"]) {
  const firstPage = await fetchPage(kind, 1);
  allEntries.push(...firstPage.entries);
  if (!firstPage.totalPages || firstPage.totalPages > 100) {
    throw new Error(`Could not validate ${kind} pagination (${firstPage.totalPages})`);
  }

  const pages = Array.from({ length: firstPage.totalPages - 1 }, (_, index) => index + 2);
  const results = await mapConcurrent(pages, 2, (page) => fetchPage(kind, page));
  for (const pageResult of results) allEntries.push(...pageResult.entries);
  console.log(`Fetched ${kind}: ${firstPage.totalPages} pages`);
}

const bySlug = new Map();
for (const entry of allEntries) {
  if (!bySlug.has(entry.slug)) bySlug.set(entry.slug, entry);
}

const index = [...bySlug.values()].sort((a, b) => a.title.localeCompare(b.title));
if (index.length < 100) {
  throw new Error(`Refusing to replace the search index with only ${index.length} entries`);
}

const existing = await readFile(outputPath, "utf8").catch(() => null);
const json = `${JSON.stringify(index)}\n`;
if (existing !== json) await writeFile(outputPath, json, "utf8");
console.log(`Wrote ${index.length} unique anime to public/search-index.json`);
