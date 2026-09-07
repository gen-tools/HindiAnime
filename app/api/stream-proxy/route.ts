import { NextResponse } from "next/server";
import { isValidEmbedUrl, cleanAnimeSlug } from "@/lib/api/client";
import type { StreamItem, StreamResponse } from "@/types/api";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://anime-api-gilt-beta.vercel.app";

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
  if (String(season) === "1" && String(ep) === "1") {
    urlFormats.push(`https://animesalt.cx/movies/${encodeURIComponent(cleanId)}/`);
  }

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

    // --- Extract animesalt multi-lang Plyr player (data-src on lazy-loaded iframe) ---
    const dataSrcRegex = /data-src=["'](https:\/\/animesalt\.cx\/multi-lang-plyr[^"']+)["']/gi;
    let plyrMatch: RegExpExecArray | null;
    while ((plyrMatch = dataSrcRegex.exec(html)) !== null) {
      const src = plyrMatch[1].replace(/&#038;/g, "&");
      if (isValidEmbedUrl(src) && !seen.has(src)) {
        seen.add(src);
        results.push({
          server: "AnimeSalt Multi-Audio",
          embed: src,
        });
      }
    }

    // --- Extract any other iframes (src or data-src) ---
    const iframeRegex = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = iframeRegex.exec(html)) !== null) {
      let src = match[1].replace(/&#038;/g, "&");
      if (src.startsWith("//")) src = "https:" + src;
      else if (src.startsWith("/")) src = "https://animesalt.cx" + src;

      if (isValidEmbedUrl(src) && !src.includes("about:blank") && !seen.has(src)) {
        seen.add(src);
        results.push({
          server: "AnimeSalt Server",
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
  const movieUrl = `https://animesalt.cx/movies/${encodeURIComponent(cleanId)}/`;

  let html: string | null = null;

  try {
    const res = await fetch(movieUrl, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });
    if (res.ok) {
      html = await res.text();
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
        html = await pRes.text();
      }
    } catch {
      // proxy failed
    }
  }

  if (!html) return [];

  try {
    const results: StreamItem[] = [];
    const seen = new Set<string>();

    const dataSrcRegex = /data-src=["'](https:\/\/animesalt\.cx\/multi-lang-plyr[^"']+)["']/gi;
    let plyrMatch: RegExpExecArray | null;
    while ((plyrMatch = dataSrcRegex.exec(html)) !== null) {
      const src = plyrMatch[1].replace(/&#038;/g, "&");
      if (isValidEmbedUrl(src) && !seen.has(src)) {
        seen.add(src);
        results.push({
          server: "AnimeSalt Multi-Audio",
          embed: src,
        });
      }
    }

    const iframeRegex =
      /<iframe[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = iframeRegex.exec(html)) !== null) {
      let src = match[1].replace(/&#038;/g, "&");
      if (src.startsWith("//")) {
        src = "https:" + src;
      } else if (src.startsWith("/")) {
        src = "https://animesalt.cx" + src;
      }

      if (isValidEmbedUrl(src) && !src.includes("about:blank") && !seen.has(src)) {
        seen.add(src);
        results.push({
          server: "AnimeSalt Server",
          embed: src,
        });
      }
    }

    return results;
  } catch (err) {
    console.error("[stream-proxy] direct movie scrape error:", err);
    return [];
  }
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

  // Run all scrapers in parallel
  let [animeSaltResults, msResults] = await Promise.all([
    scrapeAnimeSaltEpisodeStreams(cleanId, season, ep),
    scrapeMultiShowsStreams(cleanId, season, ep),
  ]);

  // Fallback to direct movie scrape if no results found
  if (animeSaltResults.length === 0 && msResults.length === 0) {
    animeSaltResults = await scrapeDirectMovieStreams(cleanId);
  }

  // Build merged servers:
  // Server 1 = Primary MultiShows (Hindi Dub Sony Yay / Multi Server)
  // Server 2 = Primary AnimeSalt (Multi-Language Plyr / as-cdn)
  // Remaining servers = Additional alternates
  const mergedResults: StreamItem[] = [];
  const seen = new Set<string>();

  if (msResults.length > 0) {
    const firstMs = msResults[0];
    seen.add(firstMs.embed);
    mergedResults.push({ server: "Server 1", embed: firstMs.embed });
  }

  if (animeSaltResults.length > 0) {
    const firstAs = animeSaltResults[0];
    if (!seen.has(firstAs.embed)) {
      seen.add(firstAs.embed);
      mergedResults.push({ server: `Server ${mergedResults.length + 1}`, embed: firstAs.embed });
    }
  }

  // Append remaining MultiShows servers
  for (let i = 1; i < msResults.length; i++) {
    const r = msResults[i];
    if (!seen.has(r.embed)) {
      seen.add(r.embed);
      mergedResults.push({ server: `Server ${mergedResults.length + 1}`, embed: r.embed });
    }
  }

  // Append remaining AnimeSalt servers
  for (let i = 1; i < animeSaltResults.length; i++) {
    const r = animeSaltResults[i];
    if (!seen.has(r.embed)) {
      seen.add(r.embed);
      mergedResults.push({ server: `Server ${mergedResults.length + 1}`, embed: r.embed });
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
