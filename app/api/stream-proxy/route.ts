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

/**
 * Direct scraper fallback: extracts real <iframe> embed URLs directly from the episode page
 * if the upstream remote API is unavailable, failing, or returns invalid "Not Found" embeds.
 */
async function scrapeDirectEpisodeStreams(
  animeId: string,
  season: string,
  ep: string
): Promise<StreamItem[]> {
  const cleanId = cleanAnimeSlug(animeId) || animeId;
  const episodeUrl = `https://animesalt.cx/episode/${encodeURIComponent(cleanId)}-${season}x${ep}/`;

  try {
    const res = await fetch(episodeUrl, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) return [];

    const html = await res.text();
    const results: StreamItem[] = [];

    // Extract all iframe src or data-src URLs from the episode page
    const iframeRegex =
      /<iframe[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = iframeRegex.exec(html)) !== null) {
      let src = match[1].replace(/&#038;/g, "&");
      if (src.startsWith("//")) {
        src = "https:" + src;
      } else if (src.startsWith("/")) {
        src = "https://animesalt.cx" + src;
      }

      if (isValidEmbedUrl(src)) {
        results.push({
          server: `options-${idx}`,
          embed: src,
        });
        idx++;
      }
    }

    return results;
  } catch (err) {
    console.error("[stream-proxy] direct scrape error:", err);
    return [];
  }
}

async function scrapeDirectMovieStreams(
  animeId: string
): Promise<StreamItem[]> {
  const cleanId = cleanAnimeSlug(animeId) || animeId;
  const movieUrl = `https://animesalt.cx/movies/${encodeURIComponent(cleanId)}/`;

  try {
    const res = await fetch(movieUrl, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) return [];

    const html = await res.text();
    const results: StreamItem[] = [];

    const iframeRegex =
      /<iframe[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = iframeRegex.exec(html)) !== null) {
      let src = match[1].replace(/&#038;/g, "&");
      if (src.startsWith("//")) {
        src = "https:" + src;
      } else if (src.startsWith("/")) {
        src = "https://animesalt.cx" + src;
      }

      if (isValidEmbedUrl(src)) {
        results.push({
          server: `options-${idx}`,
          embed: src,
        });
        idx++;
      }
    }

    return results;
  } catch (err) {
    console.error("[stream-proxy] direct movie scrape error:", err);
    return [];
  }
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
    // Only decode if the string contains percent-encoded sequences
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

  // 1. Try fetching from the upstream API endpoint (series episode stream)
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
          {
            success: true,
            message: "Stream Found!!",
            results: validResults,
          },
          {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate",
            },
          }
        );
      }
    }
  } catch {
    // Upstream failed or timed out — proceed to direct scrape fallback
  }

  // 2. Direct scrape fallback for series episode page
  const directResults = await scrapeDirectEpisodeStreams(cleanId, season, ep);

  if (directResults.length > 0) {
    return NextResponse.json(
      {
        success: true,
        message: "Stream Found!!",
        results: directResults,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  }

  // 3. Fallback for Movies: upstream /api/movie endpoint
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
          {
            success: true,
            message: "Stream Found!!",
            results: validMovieResults,
          },
          {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate",
            },
          }
        );
      }
    }
  } catch {
    // Upstream movie endpoint failed — try direct movie scrape
  }

  // 4. Fallback for Movies: direct scrape from https://animesalt.cx/movies/${cleanId}/
  const movieDirectResults = await scrapeDirectMovieStreams(cleanId);
  if (movieDirectResults.length > 0) {
    return NextResponse.json(
      {
        success: true,
        message: "Stream Found!!",
        results: movieDirectResults,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  }

  return NextResponse.json(
    {
      success: false,
      message: "No valid streams found",
      results: [],
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
