import { NextResponse } from "next/server";
import { isValidEmbedUrl, cleanAnimeSlug, formatDisplayTitle } from "@/lib/api/client";
import type { StreamItem, StreamResponse, TokoSource, TokoStreamResponse } from "@/types/api";

// Stream links are short-lived. Always resolve them at request time rather
// than letting an upstream block or empty response become a cached failure.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://anime-api-gilt-beta.vercel.app";

/** Toko streaming aggregator — server-side only, never exposed to client */
const TOKO_API_URL =
  process.env.TOKO_API_URL || "https://api-delta-taupe-46.vercel.app";

/** How long to wait for the Toko API before falling back to existing scrapers.
 *  Toko fans out across 15+ providers; 20s gives a reasonable chance of results
 *  while staying safely inside Vercel's 30s function limit. */
const TOKO_TIMEOUT_MS = 20_000;


const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://animesalt.cx/",
};

const CF_PROXY_URL =
  process.env.CF_PROXY_URL ||
  process.env.NEXT_PUBLIC_CF_PROXY_URL ||
  "https://wispy-cherry-6934.shahazaibseo038.workers.dev/?url=";

async function scrapeAnimeSaltEpisodeStreams(
  animeId: string,
  season: string,
  ep: string
): Promise<StreamItem[]> {
  const cleanId = cleanAnimeSlug(animeId) || animeId;
  const urlFormats = [
    `https://animesalt.cx/episode/${encodeURIComponent(cleanId)}-${season}x${ep}/`,
    `https://animesalt.cx/episode/${encodeURIComponent(cleanId)}-${season}x${ep.padStart(2, "0")}/`,
  ];

  let html: string | null = null;

  for (const episodeUrl of urlFormats) {
    if (html) break;
    // 1. Try direct fetch
    try {
      const res = await fetch(episodeUrl, {
        headers: DEFAULT_HEADERS,
        cache: "no-store",
      });
      if (res.ok) {
        const text = await res.text();
        if (text.length > 5000) {
          html = text;
        }
      }
    } catch {
      // direct fetch failed
    }

    // 2. Try Cloudflare Worker proxy if direct fetch failed
    if (!html) {
      try {
        const pRes = await fetch(`${CF_PROXY_URL}${encodeURIComponent(episodeUrl)}`, {
          headers: DEFAULT_HEADERS,
          cache: "no-store",
        });
        if (pRes.ok) {
          const text = await pRes.text();
          if (text.length > 5000) {
            html = text;
          }
        }
      } catch {
        // proxy failed
      }
    }
  }

  if (!html) return [];

  try {
    const results: StreamItem[] = [];
    const seen = new Set<string>();

    // --- Extract iframes (src or data-src) ---
    const iframeRegex = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = iframeRegex.exec(html)) !== null) {
      let src = match[1].replace(/&#038;/g, "&");
      if (src.startsWith("//")) src = "https:" + src;
      else if (src.startsWith("/")) src = "https://animesalt.cx" + src;

      // Filter out self-domain plyr and homepages
      if (src.includes("animesalt.cx/multi-lang-plyr")) continue;
      if (src.replace(/\/+$/, "") === "https://animesalt.cx") continue;
      if (!src.includes("/video/") && !src.includes(".m3u8") && !src.includes("embed") && !src.includes("/v/")) continue;

      if (isValidEmbedUrl(src) && !src.includes("about:blank") && !seen.has(src)) {
        seen.add(src);
        results.push({
          server: "AnimeSalt Video",
          embed: src,
        });
      }
    }

    return results;
  } catch (err) {
    console.error("[stream-proxy] animesalt scrape error:", err);
    return [];
  }
}

async function scrapeDirectMovieStreams(
  animeId: string
): Promise<StreamItem[]> {
  const cleanId = cleanAnimeSlug(animeId) || animeId;

  // Try multiple URL formats — AnimeSalt uses different patterns for movies
  const urlsToTry = [
    `https://animesalt.cx/movies/${encodeURIComponent(cleanId)}/`,
    `https://animesalt.cx/episode/${encodeURIComponent(cleanId)}-1x1/`,
    `https://animesalt.cx/episode/${encodeURIComponent(cleanId)}-01/`,
    `https://animesalt.cx/${encodeURIComponent(cleanId)}/`,
  ];

  for (const movieUrl of urlsToTry) {
    let html: string | null = null;

    try {
      const res = await fetch(movieUrl, {
        headers: DEFAULT_HEADERS,
        cache: "no-store",
      });
      if (res.ok) {
        const text = await res.text();
        if (text.length > 3000) html = text;
      }
    } catch {
      // direct fetch failed
    }

    if (!html) {
      try {
        const pRes = await fetch(`${CF_PROXY_URL}${encodeURIComponent(movieUrl)}`, {
          headers: DEFAULT_HEADERS,
          cache: "no-store",
        });
        if (pRes.ok) {
          const text = await pRes.text();
          if (text.length > 3000) html = text;
        }
      } catch {
        // proxy failed
      }
    }

    if (!html) continue;

    try {
      const results: StreamItem[] = [];
      const seen = new Set<string>();

      const iframeRegex = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
      let match: RegExpExecArray | null;

      while ((match = iframeRegex.exec(html)) !== null) {
        let src = match[1].replace(/&#038;/g, "&");
        if (src.startsWith("//")) src = "https:" + src;
        else if (src.startsWith("/")) src = "https://animesalt.cx" + src;

        if (src.includes("animesalt.cx/multi-lang-plyr")) continue;

        if (isValidEmbedUrl(src) && !src.includes("about:blank") && !seen.has(src)) {
          seen.add(src);
          results.push({
            server: "AnimeSalt Video",
            embed: src,
          });
        }
      }

      if (results.length > 0) return results;
    } catch (err) {
      console.error("[stream-proxy] direct movie scrape error:", err);
    }
  }

  return [];
}

async function scrapeMultiShowsStreams(
  animeId: string,
  season: string,
  ep: string
): Promise<StreamItem[]> {
  const cleanId = cleanAnimeSlug(animeId) || animeId;
  const urls = [
    `https://multishows.top/episode/${encodeURIComponent(cleanId)}/${season}-${ep}`,
    `https://multishows.top/episode/${encodeURIComponent(cleanId)}-${season}x${ep}/`,
    `https://multishows.top/episode/${encodeURIComponent(cleanId)}-season-${season}-episode-${ep}/`,
  ];
  if (String(season) === "1" && String(ep) === "1") {
    urls.push(`https://multishows.top/movie/${encodeURIComponent(cleanId)}/`);
    urls.push(`https://multishows.top/movies/${encodeURIComponent(cleanId)}/`);
  }

  const msHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://multishows.top/",
  };

  async function fetchMs(url: string): Promise<string | null> {
    // 1. Direct fetch
    try {
      const r = await fetch(url, { headers: msHeaders, cache: "no-store" });
      if (r.ok) {
        const text = await r.text();
        if (text.length > 3000) return text;
      }
    } catch { /* direct failed */ }

    // 2. Route through CF Worker proxy (bypasses IP blocks on Vercel)
    try {
      const proxyUrl = `${CF_PROXY_URL}${encodeURIComponent(url)}`;
      const r = await fetch(proxyUrl, { headers: msHeaders, cache: "no-store" });
      if (r.ok) {
        const text = await r.text();
        if (text.length > 3000) return text;
      }
    } catch { /* proxy failed */ }

    return null;
  }

  for (const pageUrl of urls) {
    const html = await fetchMs(pageUrl);
    if (!html) continue;

    const results: StreamItem[] = [];
    const seen = new Set<string>();

    // MultiShows currently exposes its primary player as an /embed/ URL.
    // Capture it directly as well as through iframe attributes: some pages
    // include a placeholder iframe `src` after the real embed URL.
    const directEmbedMatches = html.matchAll(
      /https?:\/\/(?:www\.)?multishows\.top\/embed\/[^\s"'<>\\]+/gi
    );
    for (const directMatch of directEmbedMatches) {
      const embed = directMatch[0].replace(/&#038;/g, "&").trim();
      if (isValidEmbedUrl(embed) && !seen.has(embed)) {
        seen.add(embed);
        results.push({ server: `Server ${results.length + 1}`, embed });
      }
    }

    // 1. selectServer onclick handlers (Hindi dub servers like Sony Yay, etc.)
    const selectMatches = [...html.matchAll(/selectServer\('([^']+)',\s*'([^']+)'\)/g)];
    for (const match of selectMatches) {
      const embed = match[1]?.replace(/&#038;/g, "&").trim();
      const name = match[2]?.replace(/&amp;/g, "&").trim();
      if (embed && isValidEmbedUrl(embed) && !seen.has(embed)) {
        seen.add(embed);
        results.push({ server: name || `Server ${results.length + 1}`, embed });
      }
    }

    // 2. Iframes in page
    const iframeRegex = /<iframe[^\>]+(?:src|data-src)=["']([^"']+)["'][^\>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = iframeRegex.exec(html)) !== null) {
      let src = match[1]?.replace(/&#038;/g, "&").trim();
      if (!src || src.includes("about:blank")) continue;
      if (src.startsWith("//")) src = "https:" + src;
      if (isValidEmbedUrl(src) && !seen.has(src)) {
        seen.add(src);
        results.push({ server: `Server ${results.length + 1}`, embed: src });
      }
    }

    if (results.length > 0) return results;
  }

  return [];
}


// ─── Toko Streaming Aggregator ───────────────────────────────────────────────

/**
 * Build a human-readable title list from an anime slug.
 * Converts "naruto-shippuden" → ["Naruto Shippuden", "naruto shippuden"]
 * so Toko's internal AniList lookup has something to match against.
 */
function slugToTitleVariants(slug: string): string[] {
  const base = formatDisplayTitle(slug); // e.g. "Naruto Shippuden"
  if (!base) return [];
  const lower = base.toLowerCase();
  const variants = [base];
  if (lower !== base) variants.push(lower);
  return variants;
}

/**
 * Converts a Toko source to the existing StreamItem shape.
 * - HLS / MP4 → `url` (direct playback) + `embed` set to the same URL
 *   so legacy players that only read `embed` still work.
 * - embed → `embed` only, `url` left undefined.
 */
function tokoSourceToStreamItem(src: TokoSource, index: number): StreamItem | null {
  const rawUrl = (src.url || "").trim();
  if (!rawUrl) return null;

  const label = src.languageLabel || src.language || src.audioLanguage || "";
  const serverName = [
    src.providerName || src.providerKey || "Toko",
    label,
    src.quality,
  ]
    .filter(Boolean)
    .join(" · ");

  if (src.type === "hls" || src.isM3U8) {
    return {
      server: serverName || `Toko HLS ${index + 1}`,
      embed: rawUrl,
      url: rawUrl,
      type: "hls",
      languageLabel: label || undefined,
      audioLanguage: src.audioLanguage || undefined,
    };
  }

  if (src.type === "mp4") {
    return {
      server: serverName || `Toko MP4 ${index + 1}`,
      embed: rawUrl,
      url: rawUrl,
      type: "mp4",
      languageLabel: label || undefined,
      audioLanguage: src.audioLanguage || undefined,
    };
  }

  // embed — validate before accepting
  if (!isValidEmbedUrl(rawUrl)) return null;
  return {
    server: serverName || `Toko Embed ${index + 1}`,
    embed: rawUrl,
    type: "embed",
    languageLabel: label || undefined,
    audioLanguage: src.audioLanguage || undefined,
  };
}

/**
 * Calls the Toko /api/v3/toko/stream endpoint with a bounded timeout.
 * Returns an empty array if Toko is unavailable, times out, or returns
 * no usable sources — the existing scraper pipeline then runs normally.
 */
async function fetchTokoSources(
  slug: string,
  episodeNumber: string
): Promise<StreamItem[]> {
  const tokoBase = TOKO_API_URL;
  if (!tokoBase) return [];

  // Build query params: prefer titles[] since we don't have an anilistId here.
  // The Toko server will use these titles to query AniList internally.
  const titleVariants = slugToTitleVariants(slug);
  if (titleVariants.length === 0) return [];

  const params = new URLSearchParams();
  for (const t of titleVariants) params.append("titles[]", t);
  params.set("episode", episodeNumber);
  params.set("stream", "0"); // plain JSON, not SSE

  const url = `${tokoBase}/api/v3/toko/stream?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TOKO_TIMEOUT_MS);

    let data: TokoStreamResponse | null = null;
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        data = (await res.json()) as TokoStreamResponse;
      }
    } finally {
      clearTimeout(timer);
    }

    if (!data || !Array.isArray(data.sources) || data.sources.length === 0) {
      return [];
    }

    // Convert and filter, keeping direct streams (HLS/MP4) ahead of embeds
    // while preserving Toko's language-tier priority (Hindi > Indic > English > Japanese)
    const direct: StreamItem[] = [];
    const embeds: StreamItem[] = [];

    data.sources.forEach((src, i) => {
      // Skip torrents — they're not playable in the browser player
      if (src.type === "torrent") return;
      const item = tokoSourceToStreamItem(src, i);
      if (!item) return;
      if (item.type === "hls" || item.type === "mp4") {
        direct.push(item);
      } else {
        embeds.push(item);
      }
    });

    return [...direct, ...embeds];
  } catch (err: unknown) {
    // AbortError = timeout; any other fetch error = network issue
    const name = err instanceof Error ? err.name : "";
    if (name !== "AbortError") {
      console.error("[stream-proxy] Toko fetch error:", err);
    }
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Proxy route: GET /api/stream-proxy?id=naruto-shippuden&season=1&ep=1
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const season = searchParams.get("season") || "1";
  const ep = searchParams.get("ep") || "1";

  if (!id) {
    return NextResponse.json(
      { success: false, message: "Missing required param: id" },
      { status: 400 }
    );
  }

  // Validate that season and ep are numeric to prevent path traversal / injection
  if (!/^\d{1,4}$/.test(season) || !/^\d{1,5}$/.test(ep)) {
    return NextResponse.json(
      { success: false, message: "Invalid season or episode format." },
      { status: 400 }
    );
  }

  // Decode once: if the client sent an already-encoded slug (e.g. %E3%80%90oshi-no-ko%E3%80%91),
  // searchParams.get() may return it still partially encoded. Normalize to a plain string.
  let decodedId = id;
  try {
    if (id.includes("%")) {
      decodedId = decodeURIComponent(id);
    }
  } catch {
    // If decoding fails (malformed), fall through with raw id
  }

  const cleanId = cleanAnimeSlug(decodedId) || decodedId;
  if (cleanId.length > 200) {
    return NextResponse.json(
      { success: false, message: "Invalid anime identifier." },
      { status: 400 }
    );
  }

  // Run Toko + existing scrapers in parallel.
  // Toko has its own bounded timeout (TOKO_TIMEOUT_MS) so it cannot stall
  // the route; existing scrapers proceed independently.
  const [tokoResults, initialAnimeSaltResults, msResults] = await Promise.all([
    fetchTokoSources(cleanId, ep),
    scrapeAnimeSaltEpisodeStreams(cleanId, season, ep),
    scrapeMultiShowsStreams(cleanId, season, ep),
  ]);
  let animeSaltResults = initialAnimeSaltResults;

  // Fallback to direct movie scrape if AnimeSalt episode scraper found nothing
  // (movies don't have /episode/ pages so this is the primary path for movies)
  if (animeSaltResults.length === 0) {
    animeSaltResults = await scrapeDirectMovieStreams(cleanId);
  }

  // Build merged list — priority order:
  //   Server 1 = Toko HLS/MP4 direct stream (no Cloudflare iframe issues)
  //   Server 2 = Toko HLS/MP4 direct stream
  //   Server 3 = AnimeSalt embed (multi-language, falls back if Toko unavailable)
  //   MultiShows = emergency fallback if both above unavailable
  // NOTE: Toko embed sources are intentionally excluded — they contain
  //       in-player ad overlays ("Choose Security Mode" etc.).
  const mergedResults: StreamItem[] = [];
  const seen = new Set<string>();

  // 1 & 2. Toko DIRECT streams (HLS/MP4) → Server 1, Server 2
  for (const r of tokoResults) {
    if (mergedResults.length >= 2) break;
    if ((r.type === "hls" || r.type === "mp4") && r.embed && !seen.has(r.embed)) {
      seen.add(r.embed);
      mergedResults.push({
        ...r,
        server: `Server ${mergedResults.length + 1}`,
      });
    }
  }

  // 3. AnimeSalt embed → Server 3 (or Server 1 if Toko had no results)
  if (animeSaltResults.length > 0) {
    const firstAs = animeSaltResults[0];
    if (!seen.has(firstAs.embed)) {
      seen.add(firstAs.embed);
      mergedResults.push({
        server: `Server ${mergedResults.length + 1}`,
        embed: firstAs.embed,
        type: "embed",
      });
    }
  }

  // Fallback: if AnimeSalt + Toko both empty, use MultiShows
  if (mergedResults.length === 0 && msResults.length > 0) {
    const firstMs = msResults[0];
    if (!seen.has(firstMs.embed)) {
      seen.add(firstMs.embed);
      mergedResults.push({
        server: "Server 1",
        embed: firstMs.embed,
        type: "embed",
      });
    }
  }

  // Extra AnimeSalt embeds if we still have room
  for (let i = 1; i < animeSaltResults.length && mergedResults.length < 3; i++) {
    const r = animeSaltResults[i];
    if (!seen.has(r.embed)) {
      seen.add(r.embed);
      mergedResults.push({
        server: `Server ${mergedResults.length + 1}`,
        embed: r.embed,
        type: "embed",
      });
    }
  }

  if (mergedResults.length > 0) {
    return NextResponse.json(
      { success: true, message: "Stream Found!!", results: mergedResults },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  // Fallback 1: upstream API /api/stream endpoint
  try {
    const upstreamUrl = `${API_BASE_URL}/api/stream?id=${encodeURIComponent(cleanId)}&season=${encodeURIComponent(season)}&ep=${encodeURIComponent(ep)}`;
    const res = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data: StreamResponse = await res.json();
      const validResults = (data.results || []).filter((r) =>
        isValidEmbedUrl(r.embed)
      );
      if (validResults.length > 0) {
        return NextResponse.json(
          { success: true, message: "Stream Found!!", results: validResults },
          { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
        );
      }
    }
  } catch {
    // upstream failed
  }

  // Fallback 2: upstream /api/movie endpoint (for movies)
  try {
    const movieUpstreamUrl = `${API_BASE_URL}/api/movie?id=${encodeURIComponent(cleanId)}`;
    const mRes = await fetch(movieUpstreamUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (mRes.ok) {
      const mData = await mRes.json();
      const streamCandidates: StreamItem[] = mData?.results?.stream || [];
      const validMovieResults = streamCandidates.filter((r) =>
        isValidEmbedUrl(r.embed)
      );
      if (validMovieResults.length > 0) {
        return NextResponse.json(
          { success: true, message: "Stream Found!!", results: validMovieResults },
          { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
        );
      }
    }
  } catch {
    // upstream movie endpoint failed
  }

  // Fallback 3: direct movie page scrape
  const movieDirectResults = await scrapeDirectMovieStreams(cleanId);
  if (movieDirectResults.length > 0) {
    return NextResponse.json(
      { success: true, message: "Stream Found!!", results: movieDirectResults },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  return NextResponse.json(
    { success: false, message: "No valid streams found", results: [] },
    {
      status: 404,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    }
  );
}
