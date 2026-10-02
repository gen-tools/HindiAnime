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

const rawCfProxy = (
  process.env.CF_PROXY_URL ||
  process.env.NEXT_PUBLIC_CF_PROXY_URL ||
  "https://wispy-cherry-6934.shahazaibseo038.workers.dev/?url="
).trim(); // trim trailing newlines/spaces common in .env files

const CF_PROXY_URL = rawCfProxy.includes("?url=")
  ? rawCfProxy
  : `${rawCfProxy.replace(/\/+$/, "")}/?url=`;

/**
 * Base URL for the CF worker (e.g. "https://...workers.dev").
 * Robustly extracted using URL().origin so trailing /?url=, newlines,
 * or slash variants in the env var never produce a malformed proxy URL.
 */
function getCfWorkerBase(): string {
  try {
    // The env var may be the full proxy URL like:
    //   https://wispy-cherry-6934.shahazaibseo038.workers.dev/?url=
    // or just the base:
    //   https://wispy-cherry-6934.shahazaibseo038.workers.dev
    const parsed = new URL(rawCfProxy.split("?")[0].replace(/\/+$/, ""));
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    // Absolute fallback
    return "https://wispy-cherry-6934.shahazaibseo038.workers.dev";
  }
}
const CF_WORKER_BASE = getCfWorkerBase();

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
    return [base];
  }

  // Season 2+: Include base title AND season-qualified title.
  // Some providers (ToonStream, DesiDub) use the base title + season/ep params.
  // Others (Toko) index seasons separately by title (e.g. "Attack on Titan Season 2").
  // Providing both ensures maximum coverage across all providers.
  return [base, base + " Season " + sNum, base + " S" + sNum];
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

  function isHindi(s: TokoSource): boolean {
    const a = (s.audioLanguage || "").toLowerCase();
    const l = (s.language || "").toLowerCase();
    const lb = (s.languageLabel || "").toLowerCase();
    return a === "hi" || l.includes("hindi") || lb.includes("hindi");
  }

  function isJapanese(s: TokoSource): boolean {
    const a = (s.audioLanguage || "").toLowerCase();
    const l = (s.language || "").toLowerCase();
    const lb = (s.languageLabel || "").toLowerCase();
    return a === "ja" || l.includes("japanese") || lb.includes("japanese");
  }

  function isMultiSub(s: TokoSource): boolean {
    const l = (s.language || "").toLowerCase();
    return l.includes("sub") || l.includes("french") || l.includes("multi");
  }

  function isDirect(s: TokoSource): boolean {
    return s.type === "hls" || s.type === "mp4" || Boolean(s.isM3U8);
  }

  function matchKeyword(s: TokoSource, ...keywords: string[]): boolean {
    const str = `${s.providerName || ""} ${s.source || ""} ${s.server || ""} ${s.url || ""}`.toLowerCase();
    return keywords.some((k) => str.includes(k.toLowerCase()));
  }

  function buildMergedItem(s: TokoSource, serverNum: number, customLabel?: string): StreamItem {
    const isDirectStream = s.type === "hls" || s.type === "mp4" || Boolean(s.isM3U8);
    const flag = isHindi(s) ? "🇮🇳" : isJapanese(s) ? "🇯🇵" : /english/i.test(s.language || "") ? "🇬🇧" : "🌐";
    const langName = isHindi(s) ? "Hindi Dub" : isJapanese(s) ? "Japanese" : (s.language || "Multi");
    const streamUrl = s.url!;

    let hlsProxyUrl: string | undefined;
    if (isDirectStream) {
      const hdrs = (s.headers as Record<string, string>) || {};
      const referer = hdrs.Referer || hdrs.referer || "";
      const origin  = hdrs.Origin  || hdrs.origin  || "";
      const params = new URLSearchParams({ url: streamUrl });
      if (referer) params.set("referer", referer);
      if (origin)  params.set("origin",  origin);
      hlsProxyUrl = `${CF_WORKER_BASE}/hls-proxy?${params.toString()}`;
    }

    const itemLabel = customLabel || `Server ${serverNum} · ${flag} ${langName}`;
    return {
      server: `Server ${serverNum}`,
      label: itemLabel,
      embed: streamUrl,
      url: isDirectStream ? (hlsProxyUrl || streamUrl) : undefined,
      hlsProxyUrl,
      type: isDirectStream ? (s.type === "mp4" ? "mp4" : "hls") : "embed",
      audioLanguage: s.audioLanguage || (flag === "🇮🇳" ? "hi" : flag === "🇬🇧" ? "en" : "ja"),
      languageLabel: s.languageLabel || `${flag} ${langName}`,
      adFree: isDirectStream,
      headers: s.headers,
    };
  }

  // Predefined target server slots:
  // Server 1: Hindi Dub — any direct HLS/MP4 stream (highest priority, ad-free)
  // Server 2: Hindi Dub — embed (toonstream/rubystm primary, any Hindi embed fallback)
  // Server 3: Hindi Dub — secondary embed (cloudy variant)
  // Server 4: Hindi Dub — tertiary embed (vidmoly variant)
  // Server 5: Hindi Dub — quaternary embed (abyssplayer)
  // Server 6: Japanese — direct HLS (smoothpre/ansembed)
  // Server 7: Japanese — direct HLS (vidzy)
  // Server 8: Japanese — direct HLS (vidmoly/nekosama)
  const TARGET_SLOTS = [
    {
      serverNum: 1,
      label: "Server 1 · 🇮🇳 Hindi Dub HLS",
      // Any Hindi direct HLS or MP4 — no keyword restriction so all providers are covered
      matcher: (s: TokoSource) => isHindi(s) && isDirect(s),
    },
    {
      serverNum: 2,
      label: "Server 2 · 🇮🇳 Hindi Dub",
      // Any Hindi embed: toonstream, rubystm, or any other Hindi embed provider
      matcher: (s: TokoSource) => isHindi(s) && !isDirect(s),
    },
    {
      serverNum: 3,
      label: "Server 3 · 🇮🇳 Hindi Dub (Alt)",
      // Second Hindi embed (different provider from slot 2, dedup via usedUrls)
      matcher: (s: TokoSource) => isHindi(s) && !isDirect(s),
    },
    {
      serverNum: 4,
      label: "Server 4 · 🇮🇳 Hindi Dub (Alt 2)",
      matcher: (s: TokoSource) => isHindi(s) && !isDirect(s),
    },
    {
      serverNum: 5,
      label: "Server 5 · 🇮🇳 Hindi Dub (Alt 3)",
      matcher: (s: TokoSource) => isHindi(s),
    },
    {
      serverNum: 6,
      label: "Server 6 · 🇯🇵 Japanese HLS",
      matcher: (s: TokoSource) => (isJapanese(s) || isMultiSub(s)) && isDirect(s),
    },
    {
      serverNum: 7,
      label: "Server 7 · 🇯🇵 Japanese HLS (Alt)",
      matcher: (s: TokoSource) => (isJapanese(s) || isMultiSub(s)) && isDirect(s),
    },
    {
      serverNum: 8,
      label: "Server 8 · 🇯🇵 Japanese",
      matcher: (s: TokoSource) => isJapanese(s) || isMultiSub(s),
    },
  ];

  const merged: StreamItem[] = [];
  const usedUrls = new Set<string>();

  // Pass 1: Fill defined target slots
  for (const slot of TARGET_SLOTS) {
    const candidate = rawSources.find(
      (s) => !isBlockedSource(s) && s.url && !usedUrls.has(s.url) && slot.matcher(s)
    );
    if (candidate && candidate.url) {
      usedUrls.add(candidate.url);
      merged.push(buildMergedItem(candidate, slot.serverNum, slot.label));
    }
  }

  // Pass 2: If we have room (< 8) and other valid sources exist (e.g. English, additional providers),
  // append them to provide maximum playback choices
  if (merged.length < 8) {
    const usedServerNums = new Set(
      merged.map((m) => {
        const match = m.server.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      })
    );
    let nextAvailableNum = 1;

    for (const s of rawSources) {
      if (merged.length >= 8) break;
      if (isBlockedSource(s)) continue;
      if (!s.url || usedUrls.has(s.url)) continue;
      if (!isValidStreamUrl(s.url)) continue;

      while (usedServerNums.has(nextAvailableNum)) {
        nextAvailableNum++;
      }

      usedUrls.add(s.url);
      usedServerNums.add(nextAvailableNum);
      merged.push(buildMergedItem(s, nextAvailableNum));
      nextAvailableNum++;
    }
  }

  // Ensure servers are sorted by server number (Server 1, Server 2, ...)
  merged.sort((a, b) => {
    const numA = parseInt(a.server.replace(/\D/g, ""), 10) || 0;
    const numB = parseInt(b.server.replace(/\D/g, ""), 10) || 0;
    return numA - numB;
  });

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
