import { NextResponse } from "next/server";
import { BLOCKED_STREAM_DOMAINS, cleanAnimeSlug, formatDisplayTitle } from "@/lib/api/client";
import type { StreamItem, TokoSource, TokoStreamResponse } from "@/types/api";

// Stream links are dynamic and short-lived
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Toko streaming aggregator backend */
const TOKO_API_URL = (
  process.env.TOKO_API_URL || "https://api-delta-taupe-46.vercel.app"
).replace(/\/+$/, "");

const TOKO_TIMEOUT_MS = 12_000;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Accept: "application/json",
};

const rawCfProxy =
  process.env.CF_PROXY_URL ||
  process.env.NEXT_PUBLIC_CF_PROXY_URL ||
  "https://wispy-cherry-6934.shahazaibseo038.workers.dev/?url=";

const CF_PROXY_URL = rawCfProxy.includes("?url=")
  ? rawCfProxy
  : `${rawCfProxy.replace(/\/+$/, "")}/?url=`;

/** Base URL for the CF worker (without the /?url= suffix) */
const CF_WORKER_BASE = rawCfProxy
  .replace(/\/\?url=$/, "")
  .replace(/\?url=$/, "")
  .replace(/\/$/, "");

/**
 * Generate title search variants for Toko.
 * Toko does NOT use the ?season= param for content routing — it uses the title.
 * For Season 2+ we must include season-specific titles so Toko returns the right
 * content (e.g. "Jujutsu Kaisen Season 2" yields JJK S2 episodes, not S1).
 */
function slugToTitleVariants(slug: string, season: string): string[] {
  // Strip any season suffix already in the slug (e.g. attack-on-titan-season-2)
  const cleanSlug = slug
    .replace(/-season-\d+$/i, "")
    .replace(/-s\d+$/i, "")
    .replace(/-\d+(st|nd|rd|th)-season$/i, "");

  const base = formatDisplayTitle(cleanSlug) || formatDisplayTitle(slug);
  if (!base) return [];

  const sNum = parseInt(season, 10) || 1;

  if (sNum <= 1) {
    // Season 1: base title is sufficient; add Season 1 variant as fallback
    const variants = [base];
    const lower = base.toLowerCase();
    if (lower !== base) variants.push(lower);
    variants.push(base + " Season 1");
    return [...new Set(variants)];
  }

  // Season 2+: generate ordinal and numeric title variants
  const ord = sNum === 2 ? "2nd" : sNum === 3 ? "3rd" : sNum + "th";
  const variants: string[] = [];
  variants.push(base + " Season " + sNum);         // "Jujutsu Kaisen Season 2"
  variants.push(base + " " + ord + " Season");      // "Jujutsu Kaisen 2nd Season"
  variants.push(base + " S" + sNum);                // "Jujutsu Kaisen S2"
  variants.push(base + " " + sNum);                 // "Jujutsu Kaisen 2"
  variants.push(base);                              // bare title as last resort
  return [...new Set(variants)];
}

function isBlockedSource(s: TokoSource): boolean {
  const provider = (s.providerName || s.source || s.server || "").toLowerCase();
  if (provider.includes("hindmovie") || provider.includes("mvlink")) return true;

  const urlStr = s.url || "";
  if (/\.(mkv|zip|rar|7z|tar|gz|torrent|iso)(\?|$)/i.test(urlStr)) return true;

  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    if (BLOCKED_STREAM_DOMAINS.some((d) => host.includes(d))) return true;
  } catch {
    return true;
  }
  return false;
}

function isValidStreamUrl(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Fetch and prioritize stream sources from Toko aggregator.
 * Priority:
 *   1. Hindi Dub (Direct HLS/MP4 first -> Server 1 default)
 *   2. English Dub/Sub
 *   3. Japanese Audio
 *   4. Other languages
 */
async function fetchTokoSources(
  slug: string,
  season: string,
  episodeNumber: string
): Promise<{ results: StreamItem[]; byLanguage?: Record<string, unknown> }> {
  // Season-aware title variants: Toko uses the title (not ?season=) for content routing
  const titleVariants = slugToTitleVariants(slug, season);
  if (titleVariants.length === 0) return { results: [] };

  const params = new URLSearchParams();
  for (const t of titleVariants) params.append("titles[]", t);
  // Keep season + episode for any Toko backends that DO parse them
  params.set("season", season);
  params.set("episode", episodeNumber);
  params.set("stream", "0");

  const directUrl = `${TOKO_API_URL}/api/v3/toko/stream?${params.toString()}`;
  const proxyUrl = `${CF_PROXY_URL}${encodeURIComponent(directUrl)}`;

  let data: TokoStreamResponse | null = null;

  // 1. Try direct fetch
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TOKO_TIMEOUT_MS);
    const res = await fetch(directUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: DEFAULT_HEADERS,
    });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      if (!text.includes("<!DOCTYPE html") && !text.includes("challenge")) {
        data = JSON.parse(text) as TokoStreamResponse;
      }
    }
  } catch {
    // direct fetch error, fall back to worker proxy
  }

  // 2. Try proxy fetch if direct fetch failed
  if (!data) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TOKO_TIMEOUT_MS);
      const res = await fetch(proxyUrl, {
        signal: controller.signal,
        cache: "no-store",
        headers: DEFAULT_HEADERS,
      });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        if (!text.includes("<!DOCTYPE html") && !text.includes("challenge")) {
          data = JSON.parse(text) as TokoStreamResponse;
        }
      }
    } catch {
      // proxy error
    }
  }

  const rawSources: TokoSource[] = data?.sources || [];
  if (rawSources.length === 0) return { results: [] };

  // Language priority weighting:
  // 1 = Hindi (Highest Priority -> Server 1)
  // 2 = English
  // 3 = Japanese
  // 4 = Other languages
  function getLangPriority(s: TokoSource): number {
    const audio = (s.audioLanguage || "").toLowerCase();
    const lang = (s.language || "").toLowerCase();
    const label = (s.languageLabel || "").toLowerCase();

    if (audio === "hi" || lang.includes("hindi") || label.includes("hindi")) return 1;
    if (audio === "en" || lang.includes("english") || label.includes("english")) return 2;
    if (audio === "ja" || lang.includes("japanese") || label.includes("japanese")) return 3;
    return 4;
  }

  // Type priority within same language:
  // 1 = Direct HLS (ad-free, best quality)
  // 2 = Direct MP4 (ad-free)
  // 3 = Embed player (fallback)
  function getTypePriority(s: TokoSource): number {
    if (s.type === "hls" || s.isM3U8) return 1;
    if (s.type === "mp4") return 2;
    if (s.type === "embed" || s.isEmbed) return 3;
    return 4;
  }

  const sorted = [...rawSources].sort((a, b) => {
    const lpA = getLangPriority(a);
    const lpB = getLangPriority(b);
    if (lpA !== lpB) return lpA - lpB;
    const tpA = getTypePriority(a);
    const tpB = getTypePriority(b);
    if (tpA !== tpB) return tpA - tpB;
    return 0;
  });

  const merged: StreamItem[] = [];
  const seen = new Set<string>();

  for (const s of sorted) {
    if (merged.length >= 8) break;
    if (isBlockedSource(s)) continue;
    const streamUrl = s.url;
    if (!streamUrl) continue;
    // Embed types only need a valid http(s) URL — no path-depth requirement
    const isEmbedType = s.type === "embed" || s.isEmbed;
    if (!isEmbedType && !isValidStreamUrl(streamUrl)) continue;
    if (isEmbedType && !isValidStreamUrl(streamUrl)) continue;
    if (seen.has(streamUrl)) continue;
    seen.add(streamUrl);

    const idx = merged.length + 1;
    const isDirect = (s.type === "hls" || s.type === "mp4" || s.isM3U8);
    const flag =
      s.audioLanguage === "hi" || /hindi/i.test(s.language || s.languageLabel || "")
        ? "🇮🇳"
        : s.audioLanguage === "en" || /english/i.test(s.language || s.languageLabel || "")
        ? "🇬🇧"
        : s.audioLanguage === "ja" || /japanese/i.test(s.language || s.languageLabel || "")
        ? "🇯🇵"
        : "🌐";

    const langName =
      s.audioLanguage === "hi" || /hindi/i.test(s.language || "")
        ? "Hindi Dub"
        : s.audioLanguage === "en" || /english/i.test(s.language || "")
        ? "English Dub"
        : s.audioLanguage === "ja" || /japanese/i.test(s.language || "")
        ? "Japanese"
        : (s.language || "Multi");

    const qualityLabel = s.quality && s.quality !== "unknown" ? ` · ${s.quality}` : "";
    const typeLabel = isDirect ? (s.type === "hls" || s.isM3U8 ? " · HLS" : " · MP4") : "";
    const providerHint = s.server || s.providerName ? ` (${s.server || s.providerName})` : "";

    // Build a proxied HLS URL when the stream requires custom Referer/Origin headers.
    // Browsers cannot send custom headers from <video> elements, so we route HLS
    // streams through the Cloudflare Worker /hls-proxy which injects the right headers.
    let hlsProxyUrl: string | undefined;
    if (isDirect && (s.type === "hls" || s.isM3U8) && s.headers) {
      const hdrs = s.headers as Record<string, string>;
      const referer = hdrs.Referer || hdrs.referer || "";
      const origin = hdrs.Origin || hdrs.origin || "";
      if (referer || origin) {
        const params = new URLSearchParams({ url: streamUrl });
        if (referer) params.set("referer", referer);
        if (origin) params.set("origin", origin);
        hlsProxyUrl = `${CF_WORKER_BASE}/hls-proxy?${params.toString()}`;
      }
    }

    merged.push({
      server: `Server ${idx}`,
      embed: streamUrl,
      // Use the proxied URL so the browser can play with correct CDN headers
      url: isDirect ? (hlsProxyUrl || streamUrl) : undefined,
      hlsProxyUrl,
      type: isDirect ? (s.type === "mp4" ? "mp4" : "hls") : "embed",
      audioLanguage: s.audioLanguage || (flag === "🇮🇳" ? "hi" : flag === "🇬🇧" ? "en" : "ja"),
      languageLabel: s.languageLabel || `${flag} ${langName}${typeLabel}${qualityLabel}${providerHint}`,
      adFree: isDirect,
      headers: s.headers,
    });
  }

  return { results: merged, byLanguage: data?.byLanguage };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const season = searchParams.get("season") || "1";
  const ep = searchParams.get("ep") || "1";

  if (!id) {
    return NextResponse.json(
      { success: false, message: "Missing required parameter: id" },
      { status: 400 }
    );
  }

  let decodedId = id;
  try {
    if (id.includes("%")) {
      decodedId = decodeURIComponent(id);
    }
  } catch {
    // ignore
  }

  const cleanId = cleanAnimeSlug(decodedId) || decodedId;

  // Fetch exclusively from Toko backend:
  // Server 1 & Server 2 = Toko's Hindi Dub embed sources (toonstream & toonstream-cloudy)
  // Server 3+ = Direct HLS/MP4 streams (⚡ Ad-free) and additional Toko sources
  const { results: tokoResults, byLanguage } = await fetchTokoSources(cleanId, season, ep);

  if (tokoResults.length > 0) {
    return NextResponse.json(
      { success: true, message: "Stream Found!!", results: tokoResults, byLanguage },
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
