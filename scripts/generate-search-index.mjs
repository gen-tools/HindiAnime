import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "public", "search-index.json");
const workerOrigin = (() => {
  const configured = process.env.CF_PROXY_URL?.trim();
  if (!configured) return "https://cloud.hindi-anime.com";
  try {
    return new URL(configured).origin;
  } catch {
    throw new Error("CF_PROXY_URL is not a valid URL");
  }
})();

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
  const articlePattern = /<article\b[^>]*\bclass=["'][^"']*\bpost\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;

  for (const [, article] of html.matchAll(articlePattern)) {
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
    const genreKeywords = [
      "action", "adventure", "fantasy", "romance", "comedy", "horror",
      "thriller", "sports", "mystery", "sci-fi", "isekai", "slice-of-life",
      "psychological", "supernatural", "drama", "shounen", "school",
    ];
    const genres = genreKeywords.filter((genre) => lower.includes(genre));

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
  const proxy = new URL("/", workerOrigin);
  proxy.searchParams.set("url", target);

  const response = await fetch(proxy, {
    headers: {
      "User-Agent": "HindiAnime-SearchIndex/1.0",
      Accept: "text/html,application/xhtml+xml",
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
