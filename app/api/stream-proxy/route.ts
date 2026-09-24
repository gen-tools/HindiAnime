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

/** How long to wait for the Toko API before falling back to existing scrapers.
 *  Toko fans out across 15+ providers; 45s gives enough time for cold cache
 *  resolution while staying safely inside Vercel's 60s maxDuration. */
const TOKO_TIMEOUT_MS = 45_000;


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
  // 1. Direct fetch with short 2000ms timeout
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      if (isValidAnimeSaltHtml(text)) return text;
    }
    // Origin is unreachable (Cloudflare 520-525 error): CF worker won't reach it either
    if (res.status >= 520 && res.status <= 525) return null;
  } catch {
    // direct fetch failed
  }

  // 2. Fallback to Cloudflare Worker proxy if direct fetch was challenged or blocked
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const pRes = await fetch(`${CF_PROXY_URL}${encodeURIComponent(url)}`, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (pRes.ok) {
      const text = await pRes.text();
      if (isValidAnimeSaltHtml(text)) return text;
    }
  } catch {
    // proxy failed
  }

  return null;
}

function extractAnimeSaltIframes(html: string): StreamItem[] {
  try {
    const results: StreamItem[] = [];
    const seen = new Set<string>();

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

  const htmlResults = await Promise.all(urlFormats.map(fetchAnimeSaltHtml));
  const html = htmlResults.find(Boolean);
  if (!html) return [];
  return extractAnimeSaltIframes(html);
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
  if (!url || !url.startsWith("http")) return false;
  if (!url.includes(".m3u8")) return false;

  const probeHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    ...(headers || {}),
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(url, {
      method: "HEAD",
      headers: probeHeaders,
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    // Hard reject: definitively dead
    if (res.status === 404 || res.status === 410 || res.status === 451) return false;

    // Hard reject: HTML challenge/error page returned as HTTP 200
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html") && !ct.includes("mpegurl")) return false;

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

  // 1. Try direct fetch (works locally and server-to-server on Vercel)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    const res = await fetch(directUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
      },
    });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      if (!text.includes("Vercel Security Checkpoint") && !text.includes("<!DOCTYPE html>")) {
        data = JSON.parse(text) as TokoStreamResponse;
      }
    }
  } catch {
    // Direct fetch failed or timed out
  }

  // 2. Fallback to Cloudflare Worker proxy if direct fetch was challenged or failed
  if (!data) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(proxyUrl, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (res.ok) {
        data = (await res.json()) as TokoStreamResponse;
      }
    } catch (err) {
      console.warn("[stream-proxy] Toko fetch via CF proxy failed:", err);
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
  // Toko CDN hosts geo-block Vercel US IPs and need provider Referer headers
  // we do not have server-side, so the strict HEAD/GET validation creates false
  // negatives.  isTokoHlsReachable only hard-rejects 404/410/HTML challenge
  // pages; it accepts 403/timeout as "probably valid" for the browser client.
  const validDirectHls: StreamItem[] = [];
  const hlsProbeResults = await Promise.all(
    hlsCandidates.slice(0, 8).map(async ({ item, headers }) => {
      const streamUrl = item.url || item.embed;
      if (!streamUrl) return null;
      const ok = await isTokoHlsReachable(streamUrl, headers);
      return ok ? item : null;
    })
  );
  for (const item of hlsProbeResults) {
    if (item) validDirectHls.push(item);
  }

  // MP4 and embeds are never surfaced as HLS server buttons; skip probing them.
  return validDirectHls;
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
  const [tokoResults, initialAnimeSaltResults] = await Promise.all([
    fetchTokoSources(cleanId, ep),
    scrapeAnimeSaltEpisodeStreams(cleanId, season, ep),
  ]);
  let animeSaltResults = initialAnimeSaltResults;

  // Fallback to direct movie scrape if AnimeSalt episode scraper found nothing
  // (only applies to season 1 episode 1 since movies don't have season/episode numbering)
  if (animeSaltResults.length === 0 && season === "1" && ep === "1") {
    animeSaltResults = await scrapeDirectMovieStreams(cleanId);
  }

  // ── Build merged server list ─────────────────────────────────────────────────
  // Priority (strict):
  //   1. AnimeSalt embed → existing sandboxed, ad-blocked iframe Server 1
  //   2. Validated Toko HLS sources → native HLS.js Server 2+
  //
  // Strict server numbering:
  //   - If AnimeSalt exists → Server 1.
  //   - HLS sources ALWAYS start at Server 2 (Server 2, Server 3, Server 4...).
  //   - If AnimeSalt is unavailable → do NOT rename HLS to Server 1;
  //     keep Server 1 reserved for AnimeSalt and show available HLS as Server 2+.
  //   - If no HLS exists, do not create fake buttons.
  const mergedResults: StreamItem[] = [];
  const seen = new Set<string>();

  // Phase 1: the established AnimeSalt embed is always Server 1.
  if (animeSaltResults.length > 0) {
    const saltItem = animeSaltResults[0];
    const key = saltItem.url || saltItem.embed;
    if (key && !seen.has(key)) {
      seen.add(key);
      mergedResults.push({
        ...saltItem,
        type: "embed",
        server: "Server 1",
      });
    }
  }

  // Phase 2: validated Toko HLS sources ALWAYS start at Server 2+.
  let hlsServerIndex = 2;
  for (const r of tokoResults) {
    if (mergedResults.length >= 4) break;
    if (r.type !== "hls") continue;
    const key = r.url || r.embed;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    mergedResults.push({
      ...r,
      type: "hls",
      server: `Server ${hlsServerIndex}`,
      adFree: true,
      headers: r.headers,
    });
    hlsServerIndex++;
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
