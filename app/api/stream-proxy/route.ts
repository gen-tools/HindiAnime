import { NextResponse } from "next/server";
import { isValidEmbedUrl, cleanAnimeSlug, formatDisplayTitle } from "@/lib/api/client";
import type { StreamItem, TokoSource, TokoStreamResponse } from "@/types/api";

// Stream links are short-lived. Always resolve them at request time rather
// than letting an upstream block or empty response become a cached failure.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;


/** Toko streaming aggregator — server-side only, never exposed to client */
const TOKO_API_URL = (
  process.env.TOKO_API_URL || "https://api-delta-taupe-46.vercel.app"
).replace(/\/+$/, "");

/** Maximum overall duration to wait for Toko source resolution and validation.
 *  Allows direct fetch (7s) + worker fallback (8s) + validation without premature cutoff. */
const TOKO_TIMEOUT_MS = 25_000;


const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://animesalt.cx/",
};

const rawCfProxy =
  process.env.CF_PROXY_URL ||
  process.env.NEXT_PUBLIC_CF_PROXY_URL ||
  "https://wispy-cherry-6934.shahazaibseo038.workers.dev/?url=";

const CF_PROXY_URL = rawCfProxy.includes("?url=")
  ? rawCfProxy
  : `${rawCfProxy.replace(/\/+$/, "")}/?url=`;

function isValidAnimeSaltHtml(text: string): boolean {
  if (!text || text.length < 1500) return false;
  if (
    text.includes("Just a moment...") ||
    text.includes("cf-chl-widget") ||
    text.includes("challenge-platform") ||
    text.includes("enable-javascript") ||
    text.includes("cf-browser-verification")
  ) {
    return false;
  }
  return text.includes("<iframe") || text.includes("data-src=");
}

async function fetchAnimeSaltHtml(url: string): Promise<string | null> {
  const proxyUrl = `${CF_PROXY_URL}${encodeURIComponent(url)}`;

  async function attempt(fetchUrl: string, timeoutMs: number, fetchType: "Worker" | "Direct"): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(fetchUrl, {
        headers: DEFAULT_HEADERS,
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timer);
      const contentType = res.headers.get("content-type") || "";
      const text = await res.text();
      const preview = text.slice(0, 100).replace(/\s+/g, " ");
      console.log(`[stream-proxy-debug][AnimeSalt] ${fetchType} fetch: status=${res.status}, ok=${res.ok}, content-type="${contentType}", length=${text.length}, preview="${preview}"`);
      if (res.ok) {
        return isValidAnimeSaltHtml(text) ? text : null;
      }
    } catch (err) {
      console.warn(`[stream-proxy-debug][AnimeSalt] ${fetchType} fetch error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }

  // 1. Primary: Cloudflare Worker proxy (Vercel -> existing CF Worker -> AnimeSalt)
  // Ensures production does not depend on Vercel's direct AnimeSalt connection.
  const proxyResult = await attempt(proxyUrl, 8000, "Worker");
  if (proxyResult) return proxyResult;

  // 2. Fallback: Direct AnimeSalt connection if the CF Worker proxy is unavailable
  return attempt(url, 4000, "Direct");
}

interface AnimeSaltDiag {
  receivedValidHtml: boolean;
  htmlLength: number;
  hasMultiLangPlyr: boolean;
  rejectionReason: string | null;
}

function extractAnimeSaltIframes(html: string, diag?: AnimeSaltDiag): StreamItem[] {
  try {
    const results: StreamItem[] = [];
    const seen = new Set<string>();

    // 1. Primary: Extract AnimeSalt multi-language Plyr iframe (Multi-audio player)
    const multiLangRegex =
      /<iframe[^>]+(?:src|data-src)\s*=\s*["']([^"']*multi-lang-plyr[^"']+)["'][^>]*>/i;
    const multiMatch = multiLangRegex.exec(html);

    if (multiMatch) {
      let src = multiMatch[1]
        .replace(/&amp;/gi, "&")
        .replace(/&#038;/gi, "&")
        .trim();
      if (src.startsWith("//")) src = "https:" + src;
      else if (src.startsWith("/")) src = "https://animesalt.cx" + src;

      if (isValidEmbedUrl(src)) {
        seen.add(src);
        results.push({
          server: "Server 1",
          embed: src,
        });
        return results;
      } else if (diag) {
        let reason = "isValidEmbedUrl(src) returned false";
        try {
          const parsed = new URL(src);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            reason = `Protocol '${parsed.protocol}' is not http/https`;
          } else if (
            parsed.hostname.includes("animesalt.cx") &&
            !parsed.pathname.includes("/video/") &&
            !parsed.pathname.includes("/embed/") &&
            !parsed.pathname.includes("multi-lang-plyr")
          ) {
            reason = `Hostname animesalt.cx pathname '${parsed.pathname}' rejected by isValidEmbedUrl`;
          }
        } catch {
          reason = "URL parsing failed for extracted iframe src";
        }
        diag.rejectionReason = reason;
      }
    } else if (diag) {
      if (html.includes("multi-lang-plyr")) {
        diag.rejectionReason = "HTML contains 'multi-lang-plyr' text but multiLangRegex did not match any <iframe (src|data-src) attribute";
      } else {
        diag.rejectionReason = "HTML does not contain 'multi-lang-plyr'";
      }
    }

    // 2. Fallback: Extract any other valid iframe (e.g. for movies or single-source episodes)
    // NEVER accept as-cdn26.top/video URLs; multi-lang-plyr.php is the preferred Server 1 source.
    const iframeRegex = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = iframeRegex.exec(html)) !== null) {
      let src = match[1].replace(/&#038;/g, "&");
      if (src.startsWith("//")) src = "https:" + src;
      else if (src.startsWith("/")) src = "https://animesalt.cx" + src;

      if (src.replace(/\/+$/, "") === "https://animesalt.cx") continue;
      if (src.includes("as-cdn26.top")) continue;
      if (!src.includes(".m3u8") && !src.includes("embed") && !src.includes("/v/")) continue;

      if (isValidEmbedUrl(src) && !src.includes("about:blank") && !seen.has(src)) {
        seen.add(src);
        results.push({
          server: "Server 1",
          embed: src,
        });
      }
    }

    return results;
  } catch (err) {
    if (diag) diag.rejectionReason = `Extraction error: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[stream-proxy] animesalt scrape error:", err);
    return [];
  }
}

async function scrapeAnimeSaltEpisodeStreams(
  animeId: string,
  season: string,
  ep: string,
  diag?: AnimeSaltDiag
): Promise<StreamItem[]> {
  const cleanId = cleanAnimeSlug(animeId) || animeId;
  const urlFormats = [
    `https://animesalt.cx/episode/${encodeURIComponent(cleanId)}-${season}x${ep}/`,
    `https://animesalt.cx/episode/${encodeURIComponent(cleanId)}-${season}x${ep.padStart(2, "0")}/`,
  ];

  const htmlResults = await Promise.all(urlFormats.map(fetchAnimeSaltHtml));
  const html = htmlResults.find(Boolean);

  if (diag) {
    if (html) {
      diag.receivedValidHtml = true;
      diag.htmlLength = html.length;
      diag.hasMultiLangPlyr = html.includes("multi-lang-plyr");
    } else {
      diag.receivedValidHtml = false;
      diag.htmlLength = 0;
      diag.hasMultiLangPlyr = false;
    }
  }

  if (!html) return [];
  return extractAnimeSaltIframes(html, diag);
}

async function scrapeDirectMovieStreams(
  animeId: string
): Promise<StreamItem[]> {
  const cleanId = cleanAnimeSlug(animeId) || animeId;
  const urlsToTry = [
    `https://animesalt.cx/movies/${encodeURIComponent(cleanId)}/`,
    `https://animesalt.cx/${encodeURIComponent(cleanId)}/`,
  ];

  const htmlResults = await Promise.all(urlsToTry.map(fetchAnimeSaltHtml));
  const html = htmlResults.find(Boolean);
  if (!html) return [];
  return extractAnimeSaltIframes(html);
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
      adFree: true,
      headers: src.headers || undefined,
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
      adFree: true,
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
 * Fast probe to verify if a direct HLS or MP4 stream is alive and playable.
 * Rejects 403s, 404s, 5xxs, Cloudflare challenge pages, and dead endpoints.
 */
async function validateDirectStream(
  url: string,
  headers?: Record<string, string>
): Promise<boolean> {
  if (!url || !url.startsWith("http")) return false;

  const probeHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    ...(headers || {}),
  };

  // 1. Try lightweight HEAD request
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const res = await fetch(url, {
      method: "HEAD",
      headers: probeHeaders,
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (res.ok || res.status === 206) {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("html") && !ct.includes("text/plain")) return true;
      if (ct.includes("mpegurl") || ct.includes("mp4") || ct.includes("octet-stream")) return true;
    }
  } catch {
    // HEAD failed or not supported
  }

  // 2. Fallback to Range GET
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const res = await fetch(url, {
      method: "GET",
      headers: { ...probeHeaders, Range: "bytes=0-1024" },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (res.ok || res.status === 206) {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("html")) return true;
      const text = await res.text();
      // If response text has #EXTM3U, it is a valid HLS playlist even if returned with text/html or text/plain
      if (text.includes("#EXTM3U")) return true;
    }
  } catch {
    // Range GET failed or timed out
  }

  // 3. Fallback to CF Worker probe if direct was blocked by datacenter IP firewalls.
  // A Worker may return a 200 response while forwarding a source 403/challenge
  // HTML page, so status alone is not evidence that the media is playable.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const proxyUrl = `${CF_PROXY_URL}${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, {
      method: "GET",
      headers: { ...probeHeaders, Range: "bytes=0-1024" },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (res.ok || res.status === 206) {
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("html")) return false;
      const body = await res.text();
      if (body.includes("#EXTM3U")) return true;
      // MP4/octet-stream responses are binary; the Worker must not have
      // converted them into an HTML error page before accepting them.
      return contentType.includes("mp4") || contentType.includes("octet-stream");
    }
  } catch {
    // Proxy probe failed
  }

  return false;
}

/**
 * Lenient reachability check for Toko/provider HLS sources.
 *
 * Unlike validateDirectStream, this accepts 403/timeout as "probably valid".
 * CDN hosts (vmpx.online, vidzy.cc, fastream.to) geo-block Vercel's US IPs
 * and require provider-specific Referer headers that we do not have server-side.
 * A geo-block or timeout does NOT prove the stream is dead for a browser client.
 * Only definitively dead responses (404/410) or explicit HTML challenge pages
 * (served as HTTP 200) are hard-rejected.
 */
async function isTokoHlsReachable(
  url: string,
  headers?: Record<string, string>
): Promise<boolean> {
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) return false;

  // Reject obvious placeholders / dead link indicators
  const lower = url.toLowerCase();
  if (
    lower.includes("about:blank") ||
    lower.includes("not-found") ||
    lower.includes("error.m3u8") ||
    lower.includes("placeholder")
  ) {
    return false;
  }

  const probeHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    ...(headers || {}),
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, {
      method: "HEAD",
      headers: probeHeaders,
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    // Hard reject only if definitively dead
    if (res.status === 404 || res.status === 410 || res.status === 451) return false;

    // 2xx, 206, 403, 429, 5xx — cannot prove dead; keep
    return true;
  } catch {
    // Timeout or network error — cannot prove the stream is dead.
    // Trust the Toko backend's own provider health audit.
    return true;
  }
}

/**
 * Calls the Toko /api/v3/toko/stream endpoint with a bounded timeout.
 * Employs direct fetch with immediate Cloudflare Worker proxy fallback
 * so production Vercel bot challenges never block source discovery.
 * HLS candidates are validated with isTokoHlsReachable (lenient probe).
 */
async function fetchTokoSources(
  slug: string,
  episodeNumber: string
): Promise<StreamItem[]> {
  const resolveSources = async (): Promise<StreamItem[]> => {
    const tokoBase = TOKO_API_URL;
    if (!tokoBase) return [];

    const titleVariants = slugToTitleVariants(slug);
    if (titleVariants.length === 0) return [];

    const params = new URLSearchParams();
    for (const t of titleVariants) params.append("titles[]", t);
    params.set("episode", episodeNumber);
    params.set("stream", "0"); // plain JSON, not SSE

    const directUrl = `${tokoBase}/api/v3/toko/stream?${params.toString()}`;
    const proxyUrl = `${CF_PROXY_URL}${encodeURIComponent(directUrl)}`;

    let data: TokoStreamResponse | null = null;

    // 1. Try direct fetch (7s timeout)
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(directUrl, {
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": DEFAULT_HEADERS["User-Agent"],
        },
      });
      clearTimeout(timer);
      const contentType = res.headers.get("content-type") || "";
      const text = await res.text();
      const preview = text.slice(0, 100).replace(/\s+/g, " ");
      console.log(`[stream-proxy-debug][Toko] Direct fetch: status=${res.status}, ok=${res.ok}, content-type="${contentType}", length=${text.length}, preview="${preview}"`);
      if (res.ok) {
        if (!text.includes("Vercel Security Checkpoint") && !text.includes("<!DOCTYPE html>")) {
          try {
            data = JSON.parse(text) as TokoStreamResponse;
          } catch (jsonErr) {
            console.warn(`[stream-proxy-debug][Toko] Direct JSON parse error: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`);
          }
        }
      }
    } catch (err) {
      console.warn(`[stream-proxy-debug][Toko] Direct fetch error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Fallback to Cloudflare Worker proxy if direct fetch was challenged or failed (8s timeout)
    if (!data) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(proxyUrl, {
          signal: controller.signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        clearTimeout(timer);
        const contentType = res.headers.get("content-type") || "";
        const text = await res.text();
        const preview = text.slice(0, 100).replace(/\s+/g, " ");
        console.log(`[stream-proxy-debug][Toko] Worker fetch: status=${res.status}, ok=${res.ok}, content-type="${contentType}", length=${text.length}, preview="${preview}"`);
        if (res.ok) {
          if (!text.includes("Vercel Security Checkpoint") && !text.includes("<!DOCTYPE html>")) {
            try {
              data = JSON.parse(text) as TokoStreamResponse;
            } catch (jsonErr) {
              console.warn(`[stream-proxy-debug][Toko] Worker JSON parse error: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`);
            }
          }
        }
      } catch (err) {
        console.warn(`[stream-proxy-debug][Toko] Worker fetch error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!data || !Array.isArray(data.sources) || data.sources.length === 0) {
      return [];
    }

    // Convert and filter candidates, keeping HLS direct streams strictly ahead of MP4
    const hlsCandidates: { item: StreamItem; headers?: Record<string, string> }[] = [];
    const mp4Candidates: { item: StreamItem; headers?: Record<string, string> }[] = [];
    const embeds: StreamItem[] = [];

    data.sources.forEach((src, i) => {
      // Skip torrents — they're not playable in the browser player
      if (src.type === "torrent") return;
      const item = tokoSourceToStreamItem(src, i);
      if (!item) return;
      if (item.type === "hls") {
        hlsCandidates.push({ item, headers: src.headers });
      } else if (item.type === "mp4") {
        mp4Candidates.push({ item, headers: src.headers });
      } else if (isValidEmbedUrl(item.embed)) {
        embeds.push(item);
      }
    });

    // Validate HLS candidates with the lenient isTokoHlsReachable probe.
    const validDirectHls: StreamItem[] = [];
    const hlsProbeResults = await Promise.all(
      hlsCandidates.slice(0, 8).map(async ({ item, headers }) => {
        const streamUrl = item.url || item.embed;
        if (!streamUrl) return null;
        try {
          const ok = await isTokoHlsReachable(streamUrl, headers);
          return ok ? item : null;
        } catch {
          return item; // Keep source on probe network error
        }
      })
    );
    for (const item of hlsProbeResults) {
      if (item) validDirectHls.push(item);
    }

    // Never drop valid Toko candidates if probing encounters network errors or strict firewalls
    return validDirectHls.length > 0
      ? validDirectHls
      : hlsCandidates.slice(0, 8).map((c) => c.item);
  };

  // Enforce total Toko timeout of ~25s so it never prematurely cuts off worker fallback
  const timeoutPromise = new Promise<StreamItem[]>((resolve) =>
    setTimeout(() => resolve([]), TOKO_TIMEOUT_MS)
  );

  return Promise.race([resolveSources(), timeoutPromise]);
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

  // 1. cleanId, season, ep
  console.log(`[stream-proxy-diag] 1. cleanId: "${cleanId}", season: "${season}", ep: "${ep}"`);


  // Run MultiShows (Server 1) and Toko (Server 2+) in parallel and completely independently.
  // MultiShows failure NEVER affects Toko results.
  const [multiShowsResults, tokoResults] = await Promise.all([
    scrapeMultiShowsStreams(cleanId, season, ep).catch((err) => {
      console.warn("[stream-proxy] MultiShows scrape error:", err);
      return [];
    }),
    fetchTokoSources(cleanId, ep).catch((err) => {
      console.warn("[stream-proxy] Toko source discovery error:", err);
      return [];
    }),
  ]);

  console.log(`[stream-proxy-diag] MultiShows result count: ${multiShowsResults.length}`);
  console.log(`[stream-proxy-diag] Toko result count: ${tokoResults.length}`);

  // ── Build merged server list ─────────────────────────────────────────────────
  // Priority:
  //   Server 1  = MultiShows embed (if available)
  //   Server 2+ = Toko HLS sources (always fetched independently)
  //   Server N+  = Toko embed sources (fill remaining slots)
  const mergedResults: StreamItem[] = [];
  const seen = new Set<string>();

  // Phase 1: MultiShows is always Server 1.
  if (multiShowsResults.length > 0) {
    const msItem = multiShowsResults[0];
    const key = msItem.url || msItem.embed;
    if (key && !seen.has(key)) {
      seen.add(key);
      mergedResults.push({
        ...msItem,
        server: "Server 1",
      });
    }
  }

  // Phase 2: Toko sources start at Server 2+.
  // 2a. HLS sources first (direct, ad-free streams)
  let tokoServerIndex = 2;
  for (const r of tokoResults) {
    if (mergedResults.length >= 4) break;
    if (r.type !== "hls") continue;
    const key = r.url || r.embed;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    mergedResults.push({
      ...r,
      type: "hls",
      server: `Server ${tokoServerIndex}`,
      adFree: true,
      headers: r.headers,
    });
    tokoServerIndex++;
  }

  // 2b. Toko embed sources fill remaining slots up to 4 total
  for (const r of tokoResults) {
    if (mergedResults.length >= 4) break;
    if (r.type === "hls") continue;
    const key = r.url || r.embed;
    if (!key || seen.has(key)) continue;
    if (!isValidEmbedUrl(key)) continue;
    seen.add(key);
    mergedResults.push({
      ...r,
      type: "embed",
      server: `Server ${tokoServerIndex}`,
    });
    tokoServerIndex++;
  }

  if (mergedResults.length > 0) {
    return NextResponse.json(
      { success: true, message: "Stream Found!!", results: mergedResults },
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
